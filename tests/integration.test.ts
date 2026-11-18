import {
  before as beforeAll,
  after as afterAll,
  beforeEach,
  describe,
  it,
} from "node:test";
import assert from "node:assert/strict";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { db } from "../src/lib/db";
import {
  Audit,
  Category,
  Product,
  Sale,
  Shift,
  Social,
  Stock,
  User,
  indexes,
  Reversal,
  Movement,
} from "../src/lib/models";
import { checkout, mutate } from "../src/lib/service";
import { getShiftReport } from "../src/lib/shift-report";
import { shiftReportRows, exportRows } from "../src/lib/report";
import ExcelJS from "exceljs";
let repl: MongoMemoryReplSet;
let u: { _id: mongoose.Types.ObjectId; role: string },
  p: mongoose.Document & { _id: mongoose.Types.ObjectId },
  shift: mongoose.Document & { _id: mongoose.Types.ObjectId };
beforeAll(
  async () => {
    repl = await MongoMemoryReplSet.create({
      binary: { version: "7.0.14" },
      replSet: { count: 1 },
    });
    process.env.MONGODB_URI = repl.getUri("cashier_integration_only");
    await db();
    await indexes();
  },
  { timeout: 180000 },
);
afterAll(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});
beforeEach(async () => {
  await Promise.all(
    [
      Audit,
      Category,
      Product,
      Sale,
      Shift,
      Social,
      Stock,
      User,
      Reversal,
      Movement,
    ].map((m) => m.deleteMany({})),
  );
  const user = await User.create({
    name: "Test cashier",
    email: "test@example.com",
    passwordHash: "not-real-password",
    role: "Cashier",
  });
  u = { _id: user._id, role: "Cashier" };
  await Category.create({ name: "Drinks" });
  p = await Product.create({
    name: "Revive Pro",
    category: "Drinks",
    kind: "bottle",
    variants: [
      { name: "Không đá", price: 15000 },
      { name: "Có đá", price: 20000 },
    ],
    defaultStock: 24,
  });
  shift = await mutate(u, "openShift", { openingCash: 100000 });
});
function order(quantity = 1, key = crypto.randomUUID()) {
  return {
    key,
    shift: String(shift._id),
    lines: [{ product: String(p._id), variant: "Không đá", quantity }],
    cash: quantity * 15000,
    transfer: 0,
  };
}
describe("real MongoDB transactions", () => {
  it("deducts three no-ice and two iced bottles from the same stock only on committed checkout", async () => {
    assert.equal((await Stock.findOne()).remaining, 24);
    await checkout(u, {
      ...order(),
      lines: [
        { product: String(p._id), variant: "Không đá", quantity: 3 },
        { product: String(p._id), variant: "Có đá", quantity: 2 },
      ],
      cash: 85000,
      transfer: 0,
    });
    const st = await Stock.findOne();
    assert.equal(st.remaining, 19);
    assert.equal(st.sold, 5);
    assert.equal(
      await Movement.countDocuments({ shift: shift._id, kind: "sale" }),
      2,
    );
  });
  it("returns only usable bottles, refunds original payment split, and deduplicates concurrent refunds", async () => {
    const sale = await checkout(u, {
      ...order(2),
      cash: 10000,
      transfer: 20000,
    });
    const b = {
      key: crypto.randomUUID(),
      shift: String(shift._id),
      sale: String(sale._id),
      kind: "refund",
      reason: "Một chai nguyên, một chai đã dùng",
      restock: [{ lineIndex: 0, quantity: 1 }],
    };
    const admin = { ...u, role: "Admin" };
    const [a, c] = await Promise.all([
      mutate(admin, "reverseSale", b),
      mutate(admin, "reverseSale", b),
    ]);
    assert.equal(String(a._id), String(c._id));
    assert.equal(await Reversal.countDocuments(), 1);
    const st = await Stock.findOne();
    assert.equal(st.remaining, 23);
    assert.equal(st.sold, 2);
    assert.equal(st.returned, 1);
    const s = await Shift.findById(shift._id);
    assert.equal(s.cashSales, 0);
    assert.equal(s.transferSales, 0);
    assert.equal(
      await Audit.countDocuments({ action: "sale.refund", shift: shift._id }),
      1,
    );
    const retry = await checkout(u, {
      ...order(2, sale.key),
      cash: 10000,
      transfer: 20000,
    });
    assert.equal(String(retry._id), String(sale._id));
    assert.equal((await Stock.findOne()).remaining, 23);
    await assert.rejects(
      mutate(admin, "reverseSale", { ...b, key: crypto.randomUUID() }),
    );
    await assert.rejects(
      mutate(admin, "reverseSale", { ...b, reason: "Different payload" }),
    );
  });
  it("cancellation restores explicitly returned bottles; prepared drinks never enter bottle stock", async () => {
    const tea = await Product.create({
      name: "Trà đá",
      category: "Drinks",
      kind: "prepared",
      variants: [{ name: "Ly", price: 10000 }],
    });
    const sale = await checkout(u, {
      ...order(),
      lines: [
        { product: String(p._id), variant: "Có đá", quantity: 3 },
        { product: String(tea._id), variant: "Ly", quantity: 2 },
      ],
      cash: 40000,
      transfer: 40000,
    });
    await mutate({ ...u, role: "Manager" }, "reverseSale", {
      key: crypto.randomUUID(),
      shift: String(shift._id),
      sale: String(sale._id),
      kind: "cancel",
      reason: "Khách hủy toàn bộ đơn",
      restock: [{ lineIndex: 0, quantity: 3 }],
    });
    assert.equal((await Stock.findOne()).remaining, 24);
    assert.equal(await Stock.countDocuments(), 1);
    assert.equal((await Sale.findById(sale._id)).status, "cancelled");
    assert.equal(await Movement.countDocuments({ kind: "return" }), 1);
  });
  it("validates refund ownership, permissions and stock quantities without partial writes", async () => {
    const sale = await checkout(u, order(2));
    const b = {
      key: crypto.randomUUID(),
      shift: String(shift._id),
      sale: String(sale._id),
      kind: "refund",
      reason: "Invalid test return",
      restock: [{ lineIndex: 0, quantity: 3 }],
    };
    await assert.rejects(mutate(u, "reverseSale", b), /quyền/);
    await assert.rejects(mutate({ ...u, role: "Admin" }, "reverseSale", b));
    await assert.rejects(
      mutate({ ...u, role: "Admin" }, "reverseSale", { ...b, restock: [] }),
    );
    await assert.rejects(
      mutate({ ...u, role: "Admin" }, "reverseSale", {
        ...b,
        sale: String(new mongoose.Types.ObjectId()),
        restock: [{ lineIndex: 0, quantity: 1 }],
      }),
    );
    assert.equal(await Reversal.countDocuments(), 0);
    assert.equal((await Stock.findOne()).remaining, 22);
    assert.equal((await Shift.findById(shift._id)).cashSales, 30000);
  });
  it("serializes different refund keys so the same sale can only be reversed once", async () => {
    const sale = await checkout(u, order());
    const b = {
      shift: String(shift._id),
      sale: String(sale._id),
      kind: "refund",
      reason: "Double return request",
      restock: [{ lineIndex: 0, quantity: 1 }],
    };
    const r = await Promise.allSettled([
      mutate({ ...u, role: "Manager" }, "reverseSale", {
        ...b,
        key: crypto.randomUUID(),
      }),
      mutate({ ...u, role: "Manager" }, "reverseSale", {
        ...b,
        key: crypto.randomUUID(),
      }),
    ]);
    assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal((await Stock.findOne()).remaining, 24);
    assert.equal(await Reversal.countDocuments(), 1);
  });
  it("reports net categories and exact mixed Social payments from the full shift ledger", async () => {
    const ticket = await Product.create({
      name: "Social",
      category: "Drinks",
      kind: "social",
      variants: [
        { name: "Sáng", price: 30000 },
        { name: "Tối", price: 50000 },
      ],
    });
    const tea = await Product.create({
      name: "Trà đá",
      category: "Drinks",
      kind: "prepared",
      variants: [{ name: "Ly", price: 10000 }],
    });
    const other = await Product.create({
      name: "Phụ kiện",
      category: "Drinks",
      kind: "other",
      variants: [{ name: "Cái", price: 5000 }],
    });
    const sale = await checkout(u, {
      ...order(),
      lines: [
        { product: String(p._id), variant: "Không đá", quantity: 3 },
        { product: String(p._id), variant: "Có đá", quantity: 2 },
        { product: String(tea._id), variant: "Ly", quantity: 1 },
        {
          product: String(ticket._id),
          variant: "Sáng",
          quantity: 2,
          guests: ["An", "Bình"],
        },
        {
          product: String(ticket._id),
          variant: "Tối",
          quantity: 1,
          guests: ["Chi"],
        },
        { product: String(other._id), variant: "Cái", quantity: 1 },
      ],
      cash: 110000,
      transfer: 100000,
    });
    let r = await getShiftReport(u, String(shift._id));
    assert.deepEqual(
      [
        r.revenue.water,
        r.revenue.socialMorning,
        r.revenue.socialEvening,
        r.revenue.other,
        r.revenue.net,
      ],
      [95000, 60000, 50000, 5000, 210000],
    );
    assert.equal(r.social[0].cash, 15000);
    assert.equal(r.social[0].transfer, 15000);
    assert.equal(r.social[0].method, "Kết hợp");
    assert.equal(
      r.social.reduce((n, g) => n + g.paid, 0),
      110000,
    );
    assert.equal(r.reconciliation.totalsMatch, true);
    await mutate({ ...u, role: "Admin" }, "reverseSale", {
      key: crypto.randomUUID(),
      shift: String(shift._id),
      sale: String(sale._id),
      kind: "refund",
      reason: "Hoàn đơn có Social",
      restock: [
        { lineIndex: 0, quantity: 2 },
        { lineIndex: 1, quantity: 1 },
      ],
    });
    r = await getShiftReport(u, String(shift._id));
    assert.equal(r.revenue.net, 0);
    assert.equal(
      r.social.every((g) => g.status === "refunded" && g.paid === 0),
      true,
    );
    assert.equal(r.reconciliation.stockMatches, true);
    assert.equal(r.stocks[0].expected, 22);
    assert.equal(r.reconciliation.expectedCash, 100000);
  });
  it("closes and exports reconciled reports including returns, handover and counted differences", async () => {
    const sale = await checkout(u, order(3));
    await mutate({ ...u, role: "Admin" }, "stock", {
      shift: String(shift._id),
      product: String(p._id),
      mode: "restock",
      quantity: 4,
      reason: "Bổ sung bốn chai",
    });
    await mutate({ ...u, role: "Admin" }, "stock", {
      shift: String(shift._id),
      product: String(p._id),
      mode: "adjust",
      quantity: -1,
      reason: "Chai bị hỏng",
    });
    await mutate({ ...u, role: "Admin" }, "reverseSale", {
      key: crypto.randomUUID(),
      shift: String(shift._id),
      sale: String(sale._id),
      kind: "refund",
      reason: "Nhập lại hai chai nguyên",
      restock: [{ lineIndex: 0, quantity: 2 }],
    });
    const next = await User.create({
      name: "Ca sau",
      email: "handover@example.com",
      passwordHash: "test-only",
      role: "Cashier",
    });
    await mutate({ ...u, role: "Admin" }, "handover", {
      shift: String(shift._id),
      cashier: String(next._id),
      note: "Đã bàn giao tiền và chai",
    });
    await mutate({ _id: next._id, role: "Cashier" }, "closeShift", {
      shift: String(shift._id),
      countedCash: 99000,
      counts: [{ product: String(p._id), counted: 25 }],
      note: "Thực đếm thiếu một chai",
    });
    const r = await getShiftReport(u, String(shift._id));
    assert.equal(r.stocks[0].expected, 26);
    assert.equal(r.stocks[0].counted, 25);
    assert.equal(r.stocks[0].difference, -1);
    assert.equal(r.stocks[0].adjustmentOut, 1);
    assert.equal(r.reconciliation.difference, -1000);
    assert.equal(r.shift.handovers[0].note, "Đã bàn giao tiền và chai");
    assert.equal(r.shift.cashier, "Ca sau");
    assert.ok(r.shift.endedAt);
    assert.equal(r.shift.closingNote, "Thực đếm thiếu một chai");
    assert.equal(
      r.movements.some(
        (m) =>
          m.kind === "restock" &&
          m.actor === "Test cashier" &&
          m.quantity === 4,
      ),
      true,
    );
    const rows = shiftReportRows(r);
    assert.ok(rows.some((row) => row.includes("Hoàn/hủy")));
    const xlsx = await exportRows(rows, "xlsx");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(
      Buffer.from(await xlsx.arrayBuffer()) as unknown as Parameters<
        typeof wb.xlsx.load
      >[0],
    );
    assert.ok(wb.worksheets[0].rowCount > 35);
    const before = JSON.stringify(r);
    await Product.updateOne(
      { _id: p._id },
      { $set: { name: "Tên sản phẩm mới" } },
    );
    assert.equal(
      JSON.stringify(await getShiftReport(u, String(shift._id))),
      before,
    );
    await assert.rejects(
      mutate({ ...u, role: "Admin" }, "reverseSale", {
        key: crypto.randomUUID(),
        shift: String(shift._id),
        sale: String(sale._id),
        kind: "refund",
        reason: "Không sửa ca đã chốt",
        restock: [{ lineIndex: 0, quantity: 0 }],
      }),
    );
    await assert.rejects(
      mutate({ ...u, role: "Admin" }, "handover", {
        shift: String(shift._id),
        cashier: String(u._id),
        note: "Không được sửa",
      }),
    );
  });
  it("rejects closing when stock or money counters do not reconcile with the ledger", async () => {
    await checkout(u, order());
    await Shift.updateOne({ _id: shift._id }, { $inc: { cashSales: 1 } });
    await assert.rejects(
      mutate(u, "closeShift", {
        shift: String(shift._id),
        countedCash: 115001,
        counts: [{ product: String(p._id), counted: 23 }],
      }),
      /đối soát/,
    );
    assert.equal((await Shift.findById(shift._id)).status, "open");
    await Shift.updateOne({ _id: shift._id }, { $inc: { cashSales: -1 } });
    await Stock.updateOne({ shift: shift._id }, { $inc: { remaining: 1 } });
    await assert.rejects(
      mutate(u, "closeShift", {
        shift: String(shift._id),
        countedCash: 115000,
        counts: [{ product: String(p._id), counted: 24 }],
      }),
      /đối soát/,
    );
  });
  it("reports all 205 transactions rather than the 200-row workspace limit", async () => {
    const tea = await Product.create({
      name: "Trà đá",
      category: "Drinks",
      kind: "prepared",
      variants: [{ name: "Ly", price: 10000 }],
    });
    for (let i = 0; i < 205; i++)
      await checkout(u, {
        ...order(),
        lines: [{ product: String(tea._id), variant: "Ly", quantity: 1 }],
        cash: 10000,
        transfer: 0,
      });
    const r = await getShiftReport(u, String(shift._id));
    assert.equal(r.sales.length, 205);
    assert.equal(r.revenue.net, 2050000);
    assert.equal(r.reconciliation.totalsMatch, true);
    await assert.rejects(
      getShiftReport(
        { _id: new mongoose.Types.ObjectId(), role: "Cashier" },
        String(shift._id),
      ),
      /quyền/,
    );
  });
  it("serializes refund against close without mutating a closed shift afterwards", async () => {
    const sale = await checkout(u, order());
    const results = await Promise.allSettled([
      mutate({ ...u, role: "Manager" }, "reverseSale", {
        key: crypto.randomUUID(),
        shift: String(shift._id),
        sale: String(sale._id),
        kind: "refund",
        reason: "Race with shift close",
        restock: [{ lineIndex: 0, quantity: 1 }],
      }),
      mutate(u, "closeShift", {
        shift: String(shift._id),
        countedCash: 100000,
        counts: [{ product: String(p._id), counted: 24 }],
      }),
    ]);
    assert.equal(results[1].status, "fulfilled");
    const r = await getShiftReport(u, String(shift._id));
    assert.equal(r.reconciliation.totalsMatch, true);
    assert.equal(r.reconciliation.stockMatches, true);
    assert.equal(r.revenue.net, results[0].status === "fulfilled" ? 0 : 15000);
    assert.equal(
      r.stocks[0].expected,
      results[0].status === "fulfilled" ? 24 : 23,
    );
    const snapshot = JSON.stringify(r);
    await assert.rejects(
      mutate({ ...u, role: "Admin" }, "stock", {
        shift: String(shift._id),
        product: String(p._id),
        mode: "restock",
        quantity: 1,
        reason: "Closed write blocked",
      }),
    );
    assert.equal(
      JSON.stringify(await getShiftReport(u, String(shift._id))),
      snapshot,
    );
  });
  it("charges authoritative price, records staff and inventory", async () => {
    const sale = await checkout(u, order(2));
    assert.equal(sale.total, 30000);
    assert.equal(String(sale.employee), String(u._id));
    assert.equal((await Stock.findOne({ shift: shift._id })).remaining, 22);
    assert.equal((await Shift.findById(shift._id)).cashSales, 30000);
    assert.equal(await Audit.countDocuments({ action: "sale.create" }), 1);
  });
  it("deduplicates concurrent retries", async () => {
    const b = order();
    const r = await Promise.all([checkout(u, b), checkout(u, b)]);
    assert.equal(String(r[0]._id), String(r[1]._id));
    assert.equal(await Sale.countDocuments(), 1);
    assert.equal((await Stock.findOne()).remaining, 23);
  });
  it("rejects reuse of key for a different order", async () => {
    const b = order();
    await checkout(u, b);
    await assert.rejects(
      checkout(u, { ...b, cash: 20000 }),
      new RegExp("nội dung khác"),
    );
  });
  it("allows only one buyer of the last bottle", async () => {
    await Stock.updateOne({ shift: shift._id }, { $set: { remaining: 1 } });
    const r = await Promise.allSettled([
      checkout(u, order()),
      checkout(u, order()),
    ]);
    assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal((await Stock.findOne()).remaining, 0);
    assert.equal(await Sale.countDocuments(), 1);
  });
  it("rolls back stock and sales on invalid payment", async () => {
    await assert.rejects(checkout(u, { ...order(), cash: 1 }));
    assert.equal((await Stock.findOne()).remaining, 24);
    assert.equal(await Sale.countDocuments(), 0);
  });
  it("protects another cashier shift", async () => {
    await assert.rejects(
      checkout(
        { _id: new mongoose.Types.ObjectId(), role: "Cashier" },
        order(),
      ),
    );
  });
  it("requires management for stock adjustments", async () => {
    await assert.rejects(
      mutate(u, "stock", {
        shift: String(shift._id),
        product: String(p._id),
        mode: "restock",
        quantity: 2,
        reason: "New box",
      }),
      new RegExp("quyền"),
    );
  });
  it("records stock adjustment reason and refuses negative stock", async () => {
    const admin = { ...u, role: "Admin" };
    await mutate(admin, "stock", {
      shift: String(shift._id),
      product: String(p._id),
      mode: "restock",
      quantity: 5,
      reason: "New box",
    });
    assert.equal((await Stock.findOne()).remaining, 29);
    await assert.rejects(
      mutate(admin, "stock", {
        shift: String(shift._id),
        product: String(p._id),
        mode: "adjust",
        quantity: -30,
        reason: "Count",
      }),
    );
    assert.equal(await Audit.countDocuments({ action: "stock.restock" }), 1);
  });
  it("closes a shift with immutable cash and stock reconciliation", async () => {
    await checkout(u, order());
    const result = await mutate(u, "closeShift", {
      shift: String(shift._id),
      countedCash: 110000,
      counts: [{ product: String(p._id), counted: 22 }],
    });
    assert.equal(result.cashDifference, -5000);
    assert.equal(result.stockSnapshot[0].difference, -1);
    await assert.rejects(checkout(u, order()));
    await assert.rejects(
      mutate({ ...u, role: "Admin" }, "stock", {
        shift: String(shift._id),
        product: String(p._id),
        mode: "restock",
        quantity: 1,
        reason: "New box",
      }),
    );
  });
  it("does not consume bottle inventory for prepared tea", async () => {
    const tea = await Product.create({
      name: "Trà đá",
      category: "Drinks",
      kind: "prepared",
      variants: [{ name: "Ly", price: 10000 }],
      defaultStock: 0,
    });
    await checkout(u, {
      ...order(),
      cash: 10000,
      lines: [{ product: String(tea._id), variant: "Ly", quantity: 1 }],
    });
    assert.equal((await Stock.findOne()).remaining, 24);
  });
  it("tracks social guests and blocks double collection", async () => {
    const social = await Product.create({
      name: "Social",
      category: "Drinks",
      kind: "social",
      variants: [{ name: "Sáng", price: 30000 }],
      defaultStock: 0,
    });
    const g = await mutate(u, "social", {
      shift: String(shift._id),
      name: "Lan",
      period: "morning",
    });
    const b = {
      ...order(),
      cash: 10000,
      transfer: 20000,
      lines: [
        {
          product: String(social._id),
          variant: "Sáng",
          quantity: 1,
          socialIds: [String(g._id)],
        },
      ],
    };
    await checkout(u, b);
    assert.equal((await Social.findById(g._id)).paid, true);
    await assert.rejects(checkout(u, { ...b, key: crypto.randomUUID() }));
    assert.equal(await Sale.countDocuments(), 1);
  });
  it("enforces a single open shift across concurrent requests", async () => {
    const r = await Promise.allSettled([
      mutate(u, "openShift", { openingCash: 0 }),
      mutate(u, "openShift", { openingCash: 0 }),
    ]);
    assert.equal(
      r.every((x) => x.status === "rejected"),
      true,
    );
    assert.equal(await Shift.countDocuments({ status: "open" }), 1);
  });
  it("hands over shift ownership and audits it", async () => {
    const target = await User.create({
      name: "Next cashier",
      email: "next@example.com",
      passwordHash: "test-only",
      role: "Cashier",
    });
    await mutate({ ...u, role: "Manager" }, "handover", {
      shift: String(shift._id),
      cashier: String(target._id),
      note: "Cash and stock counted",
    });
    await assert.rejects(checkout(u, order()));
    await checkout({ _id: target._id, role: "Cashier" }, order());
    assert.equal(await Audit.countDocuments({ action: "shift.handover" }), 1);
  });
});
