import mongoose, { type ClientSession } from "mongoose";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "./db";
import {
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
} from "./models";
import {
  amount,
  assertPayment,
  checkoutSchema,
  id,
  productInput,
  reversalInput,
  unitPayment,
} from "./domain";
import { HttpError, roles } from "./auth";
import { buildShiftReport } from "./shift-report";
type Actor = { _id: mongoose.Types.ObjectId; role: string; name?: string };
async function audit(
  u: Actor,
  action: string,
  entity: string,
  details: unknown,
  session: ClientSession,
) {
  const shift = (details as { shift?: string })?.shift;
  await Audit.create(
    [{ actor: u._id, action, entity, details, ...(shift ? { shift } : {}) }],
    { session },
  );
}
async function lockShift(shift: string, u: Actor, session: ClientSession) {
  const s = await Shift.findOneAndUpdate(
    {
      _id: shift,
      status: "open",
      ...(u.role === "Cashier" ? { cashier: u._id } : {}),
    },
    { $inc: { revision: 1 } },
    { returnDocument: "after", session },
  );
  if (!s) throw new HttpError(409, "Ca không mở hoặc không thuộc nhân viên");
  return s;
}
export async function checkout(u: Actor, input: unknown) {
  const b = checkoutSchema.parse(input);
  await db();
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ actor: String(u._id), ...b }))
    .digest("hex");
  const existing = await Sale.findOne({ key: b.key });
  if (existing) {
    if (existing.fingerprint !== fingerprint)
      throw new HttpError(409, "Khóa thanh toán đã dùng cho nội dung khác");
    return existing;
  }
  try {
    return await mongoose.connection.transaction(async (session) => {
      const s = await lockShift(b.shift, u, session);
      const lines = [];
      const movementIds: mongoose.Types.ObjectId[] = [];
      let total = 0;
      for (const l of b.lines) {
        const p = await Product.findOne({
          _id: l.product,
          active: true,
        }).session(session);
        if (!p) throw new HttpError(409, "Sản phẩm không còn bán");
        const v = p.variants.find(
          (x: { name: string }) => x.name === l.variant,
        );
        if (!v) throw new HttpError(409, "Tùy chọn không hợp lệ");
        if (p.kind === "bottle") {
          const stock = await Stock.findOneAndUpdate(
            { shift: s._id, product: p._id, remaining: { $gte: l.quantity } },
            { $inc: { remaining: -l.quantity, sold: l.quantity } },
            { session, returnDocument: "after" },
          );
          if (!stock) throw new HttpError(409, `Không đủ tồn: ${p.name}`);
          const [movement] = await Movement.create(
            [
              {
                shift: s._id,
                product: p._id,
                name: p.name,
                actor: u._id,
                kind: "sale",
                quantity: -l.quantity,
                reason: "Bán hàng",
              },
            ],
            { session },
          );
          movementIds.push(movement._id);
        }
        if (
          p.kind === "social" &&
          (l.guests?.length || 0) + (l.socialIds?.length || 0) !== l.quantity
        )
          throw new HttpError(400, "Mỗi vé Social cần tên khách");
        if (p.kind !== "social" && (l.guests?.length || l.socialIds?.length))
          throw new HttpError(400, "Chỉ vé Social mới có khách");
        const subtotal = v.price * l.quantity;
        total += subtotal;
        const guestNames = [...(l.guests || [])];
        for (const guestId of l.socialIds || []) {
          const g = await Social.findOne({
            _id: guestId,
            shift: s._id,
            paid: false,
          }).session(session);
          if (!g)
            throw new HttpError(409, "Khách đã thanh toán hoặc không thuộc ca");
          guestNames.push(g.name);
        }
        lines.push({
          ...l,
          name: p.name,
          kind: p.kind,
          price: v.price,
          subtotal,
          guestNames,
        });
      }
      assertPayment(total, b.cash, b.transfer);
      const [sale] = await Sale.create(
        [
          {
            key: b.key,
            fingerprint,
            shift: s._id,
            employee: u._id,
            lines,
            total,
            cash: b.cash,
            transfer: b.transfer,
          },
        ],
        { session },
      );
      if (movementIds.length)
        await Movement.updateMany(
          { _id: { $in: movementIds } },
          { $set: { sale: sale._id } },
          { session },
        );
      let offset = 0;
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const l = lines[lineIndex];
        if (l.kind !== "social") {
          offset += l.subtotal;
          continue;
        }
        const period = l.variant === "Sáng" ? "morning" : "evening";
        let guestIndex = 0;
        for (const name of l.guests || []) {
          await Social.create(
            [
              {
                name,
                period,
                shift: s._id,
                paid: true,
                sale: sale._id,
                lineIndex,
                ticketPrice: l.price,
                paymentStatus: "paid",
                ...unitPayment(b.cash, offset + guestIndex * l.price, l.price),
              },
            ],
            { session },
          );
          guestIndex++;
        }
        for (const guest of l.socialIds || []) {
          const paid = await Social.findOneAndUpdate(
            { _id: guest, shift: s._id, period, paid: false },
            {
              $set: {
                paid: true,
                sale: sale._id,
                lineIndex,
                ticketPrice: l.price,
                paymentStatus: "paid",
                ...unitPayment(b.cash, offset + guestIndex * l.price, l.price),
              },
            },
            { session, returnDocument: "after" },
          );
          if (!paid)
            throw new HttpError(409, "Khách đã thanh toán hoặc sai buổi");
          guestIndex++;
        }
        offset += l.subtotal;
      }
      await Shift.updateOne(
        { _id: s._id },
        { $inc: { cashSales: b.cash, transferSales: b.transfer } },
        { session },
      );
      await audit(
        u,
        "sale.create",
        String(sale._id),
        { total, shift: String(s._id) },
        session,
      );
      return sale;
    });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) {
      const sale = await Sale.findOne({ key: b.key });
      if (sale?.fingerprint === fingerprint) return sale;
      throw new HttpError(409, "Khóa thanh toán bị trùng");
    }
    throw e;
  }
}
export async function reverseSale(u: Actor, input: unknown) {
  roles(u, ["Admin", "Manager"]);
  const b = reversalInput.parse(input);
  await db();
  await Reversal.init();
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ actor: String(u._id), ...b }))
    .digest("hex");
  const existing = await Reversal.findOne({ key: b.key });
  if (existing) {
    if (existing.fingerprint !== fingerprint)
      throw new HttpError(409, "Khóa hoàn tiền đã dùng cho nội dung khác");
    return existing;
  }
  try {
    return await mongoose.connection.transaction(async (session) => {
      const committed = await Reversal.findOne({ key: b.key }).session(session);
      if (committed) {
        if (committed.fingerprint !== fingerprint)
          throw new HttpError(409, "Khóa hoàn tiền đã dùng cho nội dung khác");
        return committed;
      }
      await lockShift(b.shift, u, session);
      const sale = await Sale.findOne({ _id: b.sale, shift: b.shift }).session(
        session,
      );
      if (!sale) throw new HttpError(404, "Đơn hàng không thuộc ca");
      if (
        (await Reversal.exists({ sale: sale._id }).session(session)) ||
        sale.status === "refunded" ||
        sale.status === "cancelled"
      )
        throw new HttpError(409, "Đơn đã hoàn hoặc hủy");
      const bottled = sale.lines.flatMap(
        (l: { kind: string; quantity: number }, i: number) =>
          l.kind === "bottle" ? [i] : [],
      );
      if (
        b.restock.length !== bottled.length ||
        bottled.some((i: number) => !b.restock.some((r) => r.lineIndex === i))
      )
        throw new HttpError(
          400,
          "Phải xác nhận số chai nhập lại cho từng dòng nước đóng chai",
        );
      for (const r of b.restock) {
        const l = sale.lines[r.lineIndex];
        if (!l || l.kind !== "bottle" || r.quantity > l.quantity)
          throw new HttpError(400, "Số chai hoàn kho không hợp lệ");
      }
      const [reversal] = await Reversal.create(
        [
          {
            ...b,
            fingerprint,
            actor: u._id,
            total: sale.total,
            cash: sale.cash,
            transfer: sale.transfer,
          },
        ],
        { session },
      );
      for (const r of b.restock) {
        if (!r.quantity) continue;
        const l = sale.lines[r.lineIndex];
        const st = await Stock.findOneAndUpdate(
          { shift: b.shift, product: l.product },
          { $inc: { remaining: r.quantity, returned: r.quantity } },
          { session, returnDocument: "after" },
        );
        if (!st) throw new HttpError(409, "Không tìm thấy kho của ca");
        await Movement.create(
          [
            {
              shift: b.shift,
              product: l.product,
              name: l.name,
              actor: u._id,
              kind: "return",
              quantity: r.quantity,
              sale: sale._id,
              reversal: reversal._id,
              reason: b.reason,
            },
          ],
          { session },
        );
      }
      sale.status = b.kind === "cancel" ? "cancelled" : "refunded";
      await sale.save({ session });
      await Social.updateMany(
        { shift: b.shift, sale: sale._id },
        { $set: { paid: false, paymentStatus: sale.status } },
        { session },
      );
      await Shift.updateOne(
        { _id: b.shift },
        { $inc: { cashSales: -sale.cash, transferSales: -sale.transfer } },
        { session },
      );
      await audit(
        u,
        "sale." + b.kind,
        String(sale._id),
        {
          shift: b.shift,
          reversal: String(reversal._id),
          reason: b.reason,
          cash: sale.cash,
          transfer: sale.transfer,
          restock: b.restock,
        },
        session,
      );
      return reversal;
    });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) {
      const r = await Reversal.findOne({ key: b.key });
      if (r?.fingerprint === fingerprint) return r;
      throw new HttpError(409, "Đơn đã hoàn hoặc hủy");
    }
    throw e;
  }
}
export async function mutate(u: Actor, action: string, input: unknown) {
  await db();
  if (action === "checkout") return checkout(u, input);
  if (action === "reverseSale") return reverseSale(u, input);
  return mongoose.connection.transaction(async (session) => {
    const manager = ["Admin", "Manager"];
    switch (action) {
      case "openShift": {
        const b = z.object({ openingCash: amount }).parse(input);
        const [s] = await Shift.create(
          [
            {
              openingCash: b.openingCash,
              openedBy: u._id,
              cashier: u._id,
              cashierName: u.name,
              openedByName: u.name,
              participants: [u._id],
            },
          ],
          { session },
        );
        const products = await Product.find({
          active: true,
          kind: "bottle",
        }).session(session);
        for (const p of products)
          await Stock.create(
            [
              {
                shift: s._id,
                product: p._id,
                name: p.name,
                opening: p.defaultStock,
                remaining: p.defaultStock,
              },
            ],
            { session },
          );
        for (const p of products)
          await Movement.create(
            [
              {
                shift: s._id,
                product: p._id,
                name: p.name,
                actor: u._id,
                kind: "opening",
                quantity: p.defaultStock,
                reason: "Tồn đầu ca",
              },
            ],
            { session },
          );
        await audit(
          u,
          "shift.open",
          String(s._id),
          { ...b, shift: String(s._id) },
          session,
        );
        return s;
      }
      case "handover": {
        roles(u, manager);
        const b = z
          .object({
            shift: id,
            cashier: id,
            note: z.string().trim().min(1).max(500),
          })
          .parse(input);
        const current = await lockShift(b.shift, u, session);
        const target = await User.findOne({
          _id: b.cashier,
          active: true,
        }).session(session);
        if (!target) throw new HttpError(400, "Nhân viên không hợp lệ");
        await Shift.updateOne(
          { _id: b.shift },
          {
            $set: { cashier: target._id, cashierName: target.name },
            $addToSet: {
              participants: { $each: [current.cashier, target._id] },
            },
            $push: {
              handovers: {
                at: new Date(),
                actor: u._id,
                from: current.cashier,
                to: target._id,
                fromName:
                  current.cashierName ||
                  (await User.findById(current.cashier).session(session))
                    ?.name ||
                  "—",
                toName: target.name,
                note: b.note,
              },
            },
          },
          { session },
        );
        await audit(u, "shift.handover", b.shift, b, session);
        return { ok: true };
      }
      case "closeShift": {
        const b = z
          .object({
            shift: id,
            countedCash: amount,
            note: z.string().trim().max(500).default(""),
            counts: z.array(
              z.object({
                product: id,
                counted: z.number().int().min(0).max(100000),
              }),
            ),
          })
          .parse(input);
        const s = await lockShift(b.shift, u, session);
        const reconciliation = await buildShiftReport(b.shift, session);
        if (
          !reconciliation.reconciliation.totalsMatch ||
          !reconciliation.reconciliation.stockMatches
        )
          throw new HttpError(
            409,
            "Dữ liệu đối soát không khớp sổ giao dịch hoặc công thức kho; chưa thể chốt ca",
          );
        const stocks = await Stock.find({ shift: s._id }).session(session);
        if (
          b.counts.length !== stocks.length ||
          new Set(b.counts.map((x) => x.product)).size !== stocks.length
        )
          throw new HttpError(400, "Cần kiểm đếm đầy đủ từng loại chai");
        const snapshot = [];
        for (const st of stocks) {
          const count = b.counts.find((x) => x.product === String(st.product));
          if (!count) throw new HttpError(400, "Thiếu kiểm đếm");
          st.counted = count.counted;
          st.difference = count.counted - st.remaining;
          await st.save({ session });
          snapshot.push(st.toObject());
        }
        s.status = "closed";
        s.countedCash = b.countedCash;
        s.cashDifference = b.countedCash - s.openingCash - s.cashSales;
        s.closedBy = u._id;
        s.closedAt = new Date();
        s.stockSnapshot = snapshot;
        s.closingNote = b.note;
        await s.save({ session });
        await audit(
          u,
          "shift.close",
          String(s._id),
          {
            countedCash: b.countedCash,
            difference: s.cashDifference,
            shift: b.shift,
            note: b.note,
          },
          session,
        );
        return s;
      }
      case "stock": {
        roles(u, manager);
        const b = z
          .object({
            shift: id,
            product: id,
            mode: z.enum(["restock", "adjust"]),
            quantity: z
              .number()
              .int()
              .min(-100000)
              .max(100000)
              .refine((x) => x !== 0),
            reason: z.string().trim().min(3).max(500),
          })
          .parse(input);
        await lockShift(b.shift, u, session);
        if (b.mode === "restock" && b.quantity < 1)
          throw new HttpError(400, "Nhập kho phải dương");
        const st = await Stock.findOneAndUpdate(
          {
            shift: b.shift,
            product: b.product,
            ...(b.quantity < 0 ? { remaining: { $gte: -b.quantity } } : {}),
          },
          {
            $inc: {
              remaining: b.quantity,
              [b.mode === "restock" ? "added" : "adjustment"]: b.quantity,
              ...(b.mode === "adjust"
                ? {
                    [b.quantity > 0 ? "adjustmentIn" : "adjustmentOut"]:
                      Math.abs(b.quantity),
                  }
                : {}),
            },
          },
          { returnDocument: "after", session },
        );
        if (!st) throw new HttpError(409, "Tồn kho không hợp lệ");
        await Movement.create(
          [
            {
              shift: b.shift,
              product: b.product,
              name: st.name,
              actor: u._id,
              kind: b.mode,
              quantity: b.quantity,
              reason: b.reason,
            },
          ],
          { session },
        );
        await audit(u, "stock." + b.mode, String(st._id), b, session);
        return st;
      }
      case "social": {
        const b = z
          .object({
            shift: id,
            name: z.string().trim().min(1).max(100),
            period: z.enum(["morning", "evening"]),
          })
          .parse(input);
        await lockShift(b.shift, u, session);
        const ticket = await Product.findOne({
          kind: "social",
          active: true,
          "variants.name": b.period === "morning" ? "Sáng" : "Tối",
        }).session(session);
        const price = ticket?.variants.find(
          (v: { name: string }) =>
            v.name === (b.period === "morning" ? "Sáng" : "Tối"),
        )?.price;
        const [guest] = await Social.create([{ ...b, ticketPrice: price }], {
          session,
        });
        await audit(u, "social.join", String(guest._id), b, session);
        return guest;
      }
      case "product": {
        roles(u, manager);
        const b = z
          .object({ id: id.optional(), data: productInput })
          .parse(input);
        const cat = await Category.findOne({
          name: b.data.category,
          active: true,
        }).session(session);
        if (!cat) throw new HttpError(400, "Danh mục không hoạt động");
        let p;
        if (b.id) {
          const old = await Product.findById(b.id).session(session);
          if (!old) throw new HttpError(404, "Không tìm thấy sản phẩm");
          if (
            old.kind !== b.data.kind &&
            (await Shift.exists({ status: "open" }).session(session))
          )
            throw new HttpError(409, "Chỉ đổi loại sản phẩm sau khi chốt ca");
          p = await Product.findByIdAndUpdate(b.id, b.data, {
            returnDocument: "after",
            runValidators: true,
            session,
          });
        } else {
          [p] = await Product.create([b.data], { session });
        }
        const activeShift = await Shift.findOneAndUpdate(
          { status: "open" },
          { $inc: { revision: 1 } },
          { returnDocument: "after", session },
        );
        if (activeShift && p.kind === "bottle" && p.active) {
          await Stock.updateOne(
            { shift: activeShift._id, product: p._id },
            {
              $setOnInsert: {
                opening: 0,
                name: p.name,
                remaining: 0,
                added: 0,
                sold: 0,
                adjustment: 0,
              },
            },
            { upsert: true, session },
          );
        }
        await audit(u, "product.save", String(p._id), b, session);
        return p;
      }
      case "deleteProduct": {
        roles(u, manager);
        const b = z.object({ id }).parse(input);
        const p = await Product.findByIdAndUpdate(
          b.id,
          { active: false },
          { returnDocument: "after", session },
        );
        if (!p) throw new HttpError(404, "Không tìm thấy sản phẩm");
        await audit(u, "product.archive", b.id, {}, session);
        return p;
      }
      case "category": {
        roles(u, manager);
        const b = z
          .object({
            id: id.optional(),
            name: z.string().trim().min(1).max(80),
            active: z.boolean(),
          })
          .parse(input);
        let c;
        if (b.id) {
          c = await Category.findById(b.id).session(session);
          if (!c) throw new HttpError(404, "Không tìm thấy danh mục");
          if (c.name !== b.name || !b.active) {
            if (
              await Product.exists({ category: c.name, active: true }).session(
                session,
              )
            )
              throw new HttpError(
                409,
                "Cần chuyển hoặc ngừng bán sản phẩm trước",
              );
          }
          c.name = b.name;
          c.active = b.active;
          await c.save({ session });
        } else {
          [c] = await Category.create([{ name: b.name, active: b.active }], {
            session,
          });
        }
        await audit(u, "category.save", String(c._id), b, session);
        return c;
      }
      case "user": {
        roles(u, ["Admin"]);
        const b = z
          .object({
            name: z.string().trim().min(1).max(100),
            email: z.email().toLowerCase(),
            password: z.string().min(12).max(100),
            role: z.enum(["Admin", "Manager", "Cashier"]),
          })
          .parse(input);
        const { hash } = await import("bcryptjs");
        const [user] = await User.create(
          [
            {
              name: b.name,
              email: b.email,
              passwordHash: await hash(b.password, 12),
              role: b.role,
            },
          ],
          { session },
        );
        await audit(
          u,
          "user.create",
          String(user._id),
          { email: b.email, role: b.role },
          session,
        );
        return { _id: user._id, name: user.name, role: user.role };
      }
      default:
        throw new HttpError(400, "Thao tác không hợp lệ");
    }
  });
}
