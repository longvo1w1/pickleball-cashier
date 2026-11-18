import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { HttpError } from "./auth";
export function errorResponse(e: unknown) {
  if (e instanceof HttpError)
    return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof ZodError)
    return NextResponse.json(
      { error: e.issues.map((x) => x.message).join("; ") },
      { status: 400 },
    );
  if ((e as { code?: number })?.code === 11000)
    return NextResponse.json(
      { error: "Dữ liệu trùng hoặc đã có ca đang mở" },
      { status: 409 },
    );
  if (
    e instanceof Error &&
    e.message === "Số tiền thanh toán không khớp tổng đơn"
  )
    return NextResponse.json({ error: e.message }, { status: 400 });
  console.error("Request failed", e instanceof Error ? e.name : "UnknownError");
  return NextResponse.json(
    { error: "Không thể xử lý. Kiểm tra cấu hình và kết nối cơ sở dữ liệu." },
    { status: 503 },
  );
}
