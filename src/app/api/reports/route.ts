import { actor, roles, HttpError } from "@/lib/auth";
import { Sale, Shift, Social } from "@/lib/models";
import { id } from "@/lib/domain";
import { errorResponse } from "@/lib/http";
import { exportRows } from "@/lib/report";
export async function GET(req: Request) {
  try {
    const u = await actor();
    roles(u, ["Admin", "Manager"]);
    const url = new URL(req.url);
    const shift = url.searchParams.get("shift");
    if (shift) id.parse(shift);
    const dates: Record<string, Date> = {};
    for (const [key, value] of [
      ["$gte", url.searchParams.get("from")],
      ["$lt", url.searchParams.get("to")],
    ])
      if (value) {
        const d = new Date(value);
        if (Number.isNaN(d.getTime()))
          throw new HttpError(400, "Ngày không hợp lệ");
        dates[key!] = d;
      }
    if (dates.$gte && dates.$lt && dates.$gte >= dates.$lt)
      throw new HttpError(400, "Khoảng ngày không hợp lệ");
    const hasDates = Object.keys(dates).length > 0;
    const [sales, shifts, guests] = await Promise.all([
      Sale.find({
        ...(shift ? { shift } : {}),
        ...(hasDates ? { createdAt: dates } : {}),
      })
        .populate("employee", "name")
        .sort({ createdAt: 1 })
        .lean(),
      Shift.find(
        shift ? { _id: shift } : hasDates ? { createdAt: dates } : {},
      ).lean(),
      Social.find({
        ...(shift ? { shift } : {}),
        ...(hasDates ? { joinedAt: dates } : {}),
      }).lean(),
    ]);
    const rows: unknown[][] = [
      [
        "Mã giao dịch",
        "Thời gian (Asia/Ho_Chi_Minh)",
        "Ca",
        "Nhân viên",
        "Sản phẩm",
        "Tùy chọn",
        "Số lượng",
        "Doanh thu dòng",
        "Tiền mặt đơn",
        "Chuyển khoản đơn",
      ],
    ];
    const productTotals = new Map<string, number>(),
      staffTotals = new Map<string, number>(),
      dayTotals = new Map<string, number>();
    for (const s of sales) {
      let first = true;
      const day = new Date(s.createdAt).toLocaleDateString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
      });
      dayTotals.set(day, (dayTotals.get(day) || 0) + s.total);
      const staff = s.employee?.name || String(s.employee);
      staffTotals.set(staff, (staffTotals.get(staff) || 0) + s.total);
      for (const l of s.lines) {
        productTotals.set(
          l.name,
          (productTotals.get(l.name) || 0) + l.subtotal,
        );
        rows.push([
          String(s._id),
          new Date(s.createdAt).toLocaleString("vi-VN", {
            timeZone: "Asia/Ho_Chi_Minh",
          }),
          String(s.shift),
          staff,
          l.name,
          l.variant,
          l.quantity,
          l.subtotal,
          first ? s.cash : "",
          first ? s.transfer : "",
        ]);
        first = false;
      }
    }
    rows.push(
      [],
      ["TỔNG", sales.reduce((n, s) => n + s.total, 0)],
      ["Số lượt Social", guests.length],
      ["Social sáng", guests.filter((g) => g.period === "morning").length],
      ["Social tối", guests.filter((g) => g.period === "evening").length],
      ["Social đã thanh toán", guests.filter((g) => g.paid).length],
      [],
      [
        "Ca",
        "Tiền đầu ca",
        "Tiền mặt bán",
        "Chuyển khoản",
        "Thực đếm",
        "Thừa/thiếu",
        "Trạng thái",
      ],
    );
    for (const s of shifts)
      rows.push([
        String(s._id),
        s.openingCash,
        s.cashSales,
        s.transferSales,
        s.countedCash ?? "",
        s.cashDifference ?? "",
        s.status,
      ]);
    for (const [title, map] of [
      ["Theo sản phẩm", productTotals],
      ["Theo nhân viên", staffTotals],
      ["Theo ngày", dayTotals],
    ] as const) {
      rows.push([], [title, "Doanh thu"]);
      for (const [label, total] of map) rows.push([label, total]);
    }
    rows.push(
      [],
      [
        "Ca",
        "Sản phẩm (ID)",
        "Đầu ca",
        "Nhập",
        "Đã bán",
        "Điều chỉnh",
        "Dự kiến",
        "Thực đếm",
        "Chênh lệch",
      ],
    );
    for (const s of shifts)
      for (const st of s.stockSnapshot || [])
        rows.push([
          String(s._id),
          String(st.product),
          st.opening,
          st.added,
          st.sold,
          st.adjustment,
          st.remaining,
          st.counted,
          st.difference,
        ]);
    return exportRows(rows, url.searchParams.get("format") || "csv");
  } catch (e) {
    return errorResponse(e);
  }
}
