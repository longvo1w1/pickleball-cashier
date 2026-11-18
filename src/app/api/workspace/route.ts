import { NextResponse } from "next/server";
import { actor, sameOrigin } from "@/lib/auth";
import {
  Audit,
  Category,
  Product,
  Sale,
  Shift,
  Social,
  Stock,
  User,
} from "@/lib/models";
import { mutate } from "@/lib/service";
import { errorResponse } from "@/lib/http";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const u = await actor();
    const manager = u.role !== "Cashier";
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
        Shift.find(manager ? {} : { cashier: u._id })
          .sort({ createdAt: -1 })
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
