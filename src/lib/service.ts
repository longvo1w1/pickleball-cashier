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
} from "./models";
import {
  amount,
  assertPayment,
  checkoutSchema,
  id,
  productInput,
} from "./domain";
import { HttpError, roles } from "./auth";
type Actor = { _id: mongoose.Types.ObjectId; role: string; name?: string };
async function audit(
  u: Actor,
  action: string,
  entity: string,
  details: unknown,
  session: ClientSession,
) {
  await Audit.create([{ actor: u._id, action, entity, details }], { session });
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
        lines.push({
          ...l,
          name: p.name,
          kind: p.kind,
          price: v.price,
          subtotal,
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
      for (const l of lines) {
        if (l.kind !== "social") continue;
        const period = l.variant === "Sáng" ? "morning" : "evening";
        for (const name of l.guests || [])
          await Social.create(
            [{ name, period, shift: s._id, paid: true, sale: sale._id }],
            { session },
          );
        for (const guest of l.socialIds || []) {
          const paid = await Social.findOneAndUpdate(
            { _id: guest, shift: s._id, period, paid: false },
            { $set: { paid: true, sale: sale._id } },
            { session, returnDocument: "after" },
          );
          if (!paid)
            throw new HttpError(409, "Khách đã thanh toán hoặc sai buổi");
        }
      }
      await Shift.updateOne(
        { _id: s._id },
        { $inc: { cashSales: b.cash, transferSales: b.transfer } },
        { session },
      );
      await audit(u, "sale.create", String(sale._id), { total }, session);
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
export async function mutate(u: Actor, action: string, input: unknown) {
  await db();
  if (action === "checkout") return checkout(u, input);
  return mongoose.connection.transaction(async (session) => {
    const manager = ["Admin", "Manager"];
    switch (action) {
      case "openShift": {
        const b = z.object({ openingCash: amount }).parse(input);
        const [s] = await Shift.create(
          [{ openingCash: b.openingCash, openedBy: u._id, cashier: u._id }],
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
                opening: p.defaultStock,
                remaining: p.defaultStock,
              },
            ],
            { session },
          );
        await audit(u, "shift.open", String(s._id), b, session);
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
        await lockShift(b.shift, u, session);
        const target = await User.findOne({
          _id: b.cashier,
          active: true,
        }).session(session);
        if (!target) throw new HttpError(400, "Nhân viên không hợp lệ");
        await Shift.updateOne(
          { _id: b.shift },
          { $set: { cashier: target._id } },
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
            counts: z.array(
              z.object({
                product: id,
                counted: z.number().int().min(0).max(100000),
              }),
            ),
          })
          .parse(input);
        const s = await lockShift(b.shift, u, session);
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
        await s.save({ session });
        await audit(
          u,
          "shift.close",
          String(s._id),
          { countedCash: b.countedCash, difference: s.cashDifference },
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
            },
          },
          { returnDocument: "after", session },
        );
        if (!st) throw new HttpError(409, "Tồn kho không hợp lệ");
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
        const [guest] = await Social.create([b], { session });
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
