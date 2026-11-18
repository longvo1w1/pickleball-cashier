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
} from "../src/lib/models";
import { checkout, mutate } from "../src/lib/service";
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
    [Audit, Category, Product, Sale, Shift, Social, Stock, User].map((m) =>
      m.deleteMany({}),
    ),
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
