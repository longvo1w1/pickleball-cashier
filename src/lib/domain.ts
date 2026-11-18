import { z } from "zod";
export const id = z.string().regex(/^[a-f\d]{24}$/i, "ID không hợp lệ");
export const amount = z.number().int().min(0).max(1_000_000_000);
export const checkoutSchema = z.object({
  key: z.string().uuid(),
  shift: id,
  lines: z
    .array(
      z.object({
        product: id,
        variant: z.string().min(1).max(80),
        quantity: z.number().int().min(1).max(1000),
        guests: z.array(z.string().trim().min(1).max(100)).optional(),
        socialIds: z.array(id).optional(),
      }),
    )
    .min(1)
    .max(100),
  cash: amount,
  transfer: amount,
});
export const productInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    category: z.string().trim().min(1).max(80),
    kind: z.enum(["bottle", "prepared", "social", "other"]),
    variants: z
      .array(
        z.object({ name: z.string().trim().min(1).max(80), price: amount }),
      )
      .min(1)
      .max(20),
    defaultStock: z.number().int().min(0).max(10000),
    active: z.boolean().default(true),
  })
  .refine(
    (p) => new Set(p.variants.map((v) => v.name)).size === p.variants.length,
    "Tên tùy chọn bị trùng",
  )
  .refine(
    (p) =>
      p.kind !== "social" ||
      p.variants.every((v) => ["Sáng", "Tối"].includes(v.name)),
    "Vé Social dùng tùy chọn Sáng hoặc Tối",
  );
export function assertPayment(total: number, cash: number, transfer: number) {
  if (total !== cash + transfer)
    throw new Error("Số tiền thanh toán không khớp tổng đơn");
}
export function expectedCash(opening: number, sales: number) {
  return opening + sales;
}
export function csvCell(v: unknown) {
  let s = String(v ?? "");
  if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function canManage(role: string) {
  return role === "Admin" || role === "Manager";
}
