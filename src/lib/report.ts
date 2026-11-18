import ExcelJS from "exceljs";
import { csvCell } from "./domain";
import type { ShiftReport } from "./shift-report";
const localDate = (v: string | null) =>
  v
    ? new Date(v).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })
    : "—";
export function shiftReportRows(r: ShiftReport): unknown[][] {
  return [
    ["BÁO CÁO CA", r.shift._id],
    ["Trạng thái", r.shift.status === "closed" ? "Đã chốt" : "Đang mở"],
    ["Bắt đầu", localDate(r.shift.startedAt)],
    ["Kết thúc", localDate(r.shift.endedAt)],
    ["Thu ngân", r.shift.cashier],
    ["Người mở ca", r.shift.openedBy],
    [],
    ["DOANH THU SAU HOÀN/HỦY", "Số tiền"],
    ["Bán nước", r.revenue.water],
    ["Social sáng", r.revenue.socialMorning],
    ["Social tối", r.revenue.socialEvening],
    ["Sản phẩm khác", r.revenue.other],
    ["Doanh thu gốc", r.revenue.gross],
    ["Hoàn/hủy", r.revenue.reversed],
    ["Doanh thu thực tế", r.revenue.net],
    ["Tiền mặt ròng", r.revenue.cash],
    ["Chuyển khoản ròng", r.revenue.transfer],
    [],
    ["ĐỐI SOÁT", "Số tiền"],
    ["Tiền mặt đầu ca", r.reconciliation.openingCash],
    ["Tiền mặt thu gộp", r.reconciliation.grossCash],
    ["Tiền mặt đã hoàn", r.revenue.cashRefunds],
    ["Tiền mặt thu ròng", r.reconciliation.netCash],
    ["Tiền mặt dự kiến cuối ca", r.reconciliation.expectedCash],
    ["Tiền mặt thực đếm", r.reconciliation.countedCash ?? "Chưa chốt"],
    ["Thừa/thiếu", r.reconciliation.difference ?? "Chưa chốt"],
    ["Chuyển khoản đã hoàn", r.revenue.transferRefunds],
    ["Tổng chuyển khoản ròng", r.reconciliation.transfer],
    ["Sổ tiền khớp", r.reconciliation.totalsMatch ? "Có" : "Không"],
    ["Công thức kho khớp", r.reconciliation.stockMatches ? "Có" : "Không"],
    ["Ghi chú chốt ca", r.shift.closingNote],
    [],
    [
      "KHO",
      "Đầu ca",
      "Nhập thêm",
      "Bán",
      "Hoàn kho",
      "Nhập điều chỉnh",
      "Xuất điều chỉnh",
      "Dự kiến",
      "Thực đếm",
      "Chênh lệch",
    ],
    ...r.stocks.map((s) => [
      s.name,
      s.opening,
      s.added,
      s.sold,
      s.returned,
      s.adjustmentIn,
      s.adjustmentOut,
      s.expected,
      s.counted ?? "",
      s.difference ?? "",
    ]),
    [],
    [
      "KHÁCH SOCIAL",
      "Buổi",
      "Tham gia",
      "Giá vé",
      "Đã thu ròng",
      "Tiền mặt",
      "Chuyển khoản",
      "Phương thức",
      "Trạng thái",
      "Đơn",
    ],
    ...r.social.map((g) => [
      g.name,
      g.period === "morning" ? "Sáng" : "Tối",
      localDate(g.joinedAt),
      g.price,
      g.paid,
      g.cash,
      g.transfer,
      g.method,
      g.status,
      g.sale || "",
    ]),
    [],
    [
      "GIAO DỊCH",
      "Thời gian",
      "Nhân viên",
      "Trạng thái",
      "Sản phẩm",
      "Tùy chọn",
      "Số lượng",
      "Thành tiền gốc",
      "Tiền mặt ròng đơn",
      "Chuyển khoản ròng đơn",
    ],
    ...r.sales.flatMap((s) =>
      s.lines.map((l, i) => [
        s.id,
        localDate(s.at),
        s.employee,
        s.status,
        l.name,
        l.variant,
        l.quantity,
        l.subtotal,
        i === 0 ? s.netCash : "",
        i === 0 ? s.netTransfer : "",
      ]),
    ),
    [],
    [
      "HOÀN/HỦY",
      "Đơn",
      "Thời gian",
      "Nhân viên",
      "Loại",
      "Lý do",
      "Tổng",
      "Tiền mặt",
      "Chuyển khoản",
      "Hoàn chai",
    ],
    ...r.reversals.map((v) => [
      v.id,
      v.sale,
      localDate(v.at),
      v.actor,
      v.kind,
      v.reason,
      v.total,
      v.cash,
      v.transfer,
      v.restock.map((s) => `Dòng ${s.lineIndex + 1}: ${s.quantity}`).join("; "),
    ]),
    [],
    [
      "BIẾN ĐỘNG KHO",
      "Sản phẩm",
      "Người thực hiện",
      "Loại",
      "Số lượng +/-",
      "Lý do",
    ],
    ...r.movements.map((m) => [
      localDate(m.at),
      m.name,
      m.actor,
      m.kind,
      m.quantity,
      m.reason,
    ]),
    [],
    ["BÀN GIAO", "Từ nhân viên", "Đến nhân viên", "Ghi chú"],
    ...r.shift.handovers.map((h) => [
      localDate(h.at),
      h.fromName,
      h.toName,
      h.note,
    ]),
  ];
}
export async function exportRows(rows: unknown[][], format: string) {
  if (format === "xlsx") {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("Báo cáo");
    sheet.addRows(rows);
    sheet.getRow(1).font = { bold: true };
    sheet.columns.forEach((c) => (c.width = 24));
    const buffer = await wb.xlsx.writeBuffer();
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="pickleball-report.xlsx"',
        "Cache-Control": "no-store",
      },
    });
  }
  return new Response(
    "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n"),
    {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="pickleball-report.csv"',
        "Cache-Control": "no-store",
      },
    },
  );
}
