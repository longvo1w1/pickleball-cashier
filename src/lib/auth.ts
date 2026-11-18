import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { User } from "./models";
import { db } from "./db";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32)
    throw new Error("SESSION_SECRET phải có ít nhất 32 ký tự");
  return new TextEncoder().encode(s);
}
export async function sessionToken(id: string) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(id)
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secret());
}
export async function actor() {
  const token = (await cookies()).get("session")?.value;
  if (!token) throw new HttpError(401, "Vui lòng đăng nhập");
  let sub;
  try {
    sub = (await jwtVerify(token, secret(), { algorithms: ["HS256"] })).payload
      .sub;
  } catch {
    throw new HttpError(401, "Phiên đăng nhập hết hạn");
  }
  await db();
  const u = await User.findById(sub);
  if (!u?.active) throw new HttpError(401, "Tài khoản không hoạt động");
  return u;
}
export function roles(u: { role: string }, allowed: string[]) {
  if (!allowed.includes(u.role))
    throw new HttpError(403, "Bạn không có quyền thao tác");
}
export function sameOrigin(req: Request) {
  const configured =
    process.env.APP_ORIGIN ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);
  if (!configured) throw new HttpError(503, "Chưa cấu hình APP_ORIGIN");
  if (req.headers.get("origin") !== new URL(configured).origin)
    throw new HttpError(403, "Origin không hợp lệ");
}
