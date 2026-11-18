import { NextResponse } from "next/server";
import { actor, sameOrigin, HttpError } from "@/lib/auth";
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
} from "@/lib/models";
import { mutate } from "@/lib/service";
import { errorResponse } from "@/lib/http";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const u = await actor();
    const manager = u.role !== "Cashier";
    const pageValue = new URL(req.url).searchParams.get("shiftPage") || "0";
    const shiftPage = Number(pageValue);
    if (!Number.isInteger(shiftPage) || shiftPage < 0 || shiftPage > 10000)
      throw new HttpError(400, "Trang lịch sử ca không hợp lệ");
    const shift = await Shift.findOne({
      status: "open",
      ...(!manager ? { cashier: u._id } : {}),
    }).lean();
    const filter = !manager ? { employee: u._id } : {};
    const [products, categories, stocks, sales, social, shifts, users, audits] =
      await Promise.all([
        Product.find(manager ? {} : { active: true }).lean(),
        Category.find(manager ? {} : { active: true }).lean(),
        shift ? Stock.find({ shift: shift._id }).lean() : [],
        Sale.find(filter)
          .sort({ createdAt: -1 })
          .limit(200)
          .populate("employee", "name")
          .lean(),
        shift
          ? Social.find({ shift: shift._id }).sort({ joinedAt: -1 }).lean()
          : [],
        Shift.find(
          manager
            ? {}
            : {
                $or: [
                  { cashier: u._id },
                  { openedBy: u._id },
                  { participants: u._id },
                ],
              },
        )
          .sort({ createdAt: -1 })
          .skip(shiftPage * 50)
          .limit(50)
          .populate("cashier", "name")
          .lean(),
        manager
          ? User.find({ active: true }).select("name email role").lean()
          : [],
        manager
          ? Audit.find()
              .sort({ createdAt: -1 })
              .limit(100)
              .populate("actor", "name")
              .lean()
          : [],
      ]);
    const reversals = await Reversal.find({
      sale: { $in: sales.map((s) => s._id) },
    }).lean();
    const bySale = new Map(reversals.map((r) => [String(r.sale), r]));
    for (const s of sales) {
      const r = bySale.get(String(s._id));
      Object.assign(s, {
        netTotal: r ? 0 : s.total,
        netCash: r ? 0 : s.cash,
        netTransfer: r ? 0 : s.transfer,
        status: r ? (r.kind === "cancel" ? "cancelled" : "refunded") : "paid",
      });
    }
    return NextResponse.json(
      {
        user: { _id: u._id, name: u.name, role: u.role },
        products,
        categories,
        shift,
        stocks,
        sales,
        social,
        shifts,
        users,
        audits,
        shiftPage,
        hasMoreShifts: shifts.length === 50,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const u = await actor();
    const b = await req.json();
    return NextResponse.json(await mutate(u, b.action, b.data));
  } catch (e) {
    return errorResponse(e);
  }
}
