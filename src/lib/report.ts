import ExcelJS from "exceljs";
import { csvCell } from "./domain";
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
