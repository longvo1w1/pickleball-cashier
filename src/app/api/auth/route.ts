import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { compare } from "bcryptjs";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { Attempt, User } from "@/lib/models";
import { sessionToken, sameOrigin, HttpError } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const b = z
      .object({
        email: z.email().toLowerCase(),
        password: z.string().min(1).max(100),
      })
      .parse(await req.json());
    await db();
    const key = createHash("sha256").update(b.email).digest("hex");
    const now = new Date();
    await Attempt.deleteOne({ key, expiresAt: { $lte: now } });
    const attempt = await Attempt.findOneAndUpdate(
      { key },
      {
        $inc: { count: 1 },
        $setOnInsert: { expiresAt: new Date(Date.now() + 15 * 60 * 1000) },
      },
      { upsert: true, returnDocument: "after" },
    );
    if (attempt.count > 10) throw new HttpError(429, "Thử lại sau 15 phút");
    const u = await User.findOne({ email: b.email, active: true }).select(
      "+passwordHash",
    );
    const valid = await compare(
      b.password,
      u?.passwordHash ||
        "$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW",
    );
    if (!u || !valid)
      throw new HttpError(401, "Email hoặc mật khẩu không đúng");
    const token = await sessionToken(String(u._id));
    await Attempt.deleteOne({ key });
    (await cookies()).set("session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 43200,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function DELETE(req: Request) {
  try {
    sameOrigin(req);
    (await cookies()).delete("session");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
