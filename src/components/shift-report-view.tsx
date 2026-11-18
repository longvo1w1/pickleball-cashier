"use client";
import { useEffect, useState } from "react";
import type { ShiftReport } from "@/lib/shift-report";
import { money } from "@/lib/utils";
import { Button } from "./ui/button";
const date = (v: string | null) =>
  v
    ? new Date(v).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })
    : "—";
const status = (s: string) =>
  ({
    paid: "Đã trả",
    unpaid: "Chưa trả",
    refunded: "Đã hoàn",
    cancelled: "Đã hủy",
  })[s] || s;
function Table({
  headers,
  rows,
}: {
  headers: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((v, j) => (
                <td key={j}>{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function ShiftReportView({ shiftId }: { shiftId: string }) {
  const [report, setReport] = useState<ShiftReport | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setReport(null);
    setError("");
    fetch("/api/reports?format=json&shift=" + shiftId)
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b.error);
        if (active) setReport(b);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [shiftId]);
  if (error)
    return (
      <p role="alert" className="error">
        {error}
      </p>
    );
  if (!report) return <p>Đang tổng hợp toàn bộ giao dịch của ca…</p>;
  const r = report;
  return (
    <div className="space-y-5 shift-report">
      <h2 className="text-xl font-semibold">
        Báo cáo ca #{r.shift._id.slice(-6)}
      </h2>
      <p className="text-xs break-all">Mã ca: {r.shift._id}</p>
      <p>
        {r.shift.status === "closed" ? "Đã chốt" : "Đang mở"} · Thu ngân:{" "}
        {r.shift.cashier}
      </p>
      <p className="text-xs muted">
        Bắt đầu: {date(r.shift.startedAt)} · Kết thúc: {date(r.shift.endedAt)}
      </p>
      <div className="no-print flex flex-wrap gap-2">
        <Button onClick={() => window.print()}>In báo cáo ca</Button>
        {["xlsx", "csv"].map((f) => (
          <Button variant="outline" asChild key={f}>
            <a href={"/api/reports?format=" + f + "&shift=" + shiftId}>
              Xuất {f.toUpperCase()}
            </a>
          </Button>
        ))}
      </div>
      {(!r.reconciliation.totalsMatch || !r.reconciliation.stockMatches) && (
        <p className="error">
          Sổ ca đang lệch với giao dịch hoặc công thức kho. Chưa được chốt ca.
        </p>
      )}
      <h3 className="font-semibold">Doanh thu thực tế sau hoàn/hủy</h3>
      <Table
        headers={["Khoản mục", "Số tiền"]}
        rows={(
          [
            ["Bán nước", r.revenue.water],
            ["Social sáng", r.revenue.socialMorning],
            ["Social tối", r.revenue.socialEvening],
            ["Sản phẩm khác", r.revenue.other],
            ["Doanh thu gốc", r.revenue.gross],
            ["Hoàn/hủy", r.revenue.reversed],
            ["Doanh thu ròng", r.revenue.net],
            ["Tiền mặt ròng", r.revenue.cash],
            ["Chuyển khoản ròng", r.revenue.transfer],
          ] as [string, number][]
        ).map(([t, v]) => [t, money(v)])}
      />
      <h3 className="font-semibold">Kho theo ca</h3>
      <p className="text-xs muted">
        Dự kiến = Đầu + Nhập − Bán + Hoàn kho + Nhập điều chỉnh − Xuất điều
        chỉnh.
      </p>
      <Table
        headers={[
          "Sản phẩm",
          "Đầu",
          "Nhập",
          "Bán",
          "Hoàn",
          "Nhập ĐC",
          "Xuất ĐC",
          "Dự kiến",
          "Đếm",
          "Lệch",
        ]}
        rows={r.stocks.map((s) => [
          s.name,
          s.opening,
          s.added,
          s.sold,
          s.returned,
          s.adjustmentIn,
          s.adjustmentOut,
          s.expected,
          s.counted ?? "—",
          s.difference ?? "—",
        ])}
      />
      <h3 className="font-semibold">Khách Social · {r.social.length} lượt</h3>
      <Table
        headers={[
          "Khách",
          "Buổi",
          "Tham gia",
          "Giá vé",
          "Đã thu ròng",
          "Phương thức",
          "Tiền mặt",
          "Chuyển khoản",
          "Trạng thái",
        ]}
        rows={r.social.map((g) => [
          g.name,
          g.period === "morning" ? "Sáng" : "Tối",
          date(g.joinedAt),
          money(g.price),
          money(g.paid),
          g.method,
          money(g.cash),
          money(g.transfer),
          status(g.status),
        ])}
      />
      <h3 className="font-semibold">Đối soát cuối ca</h3>
      <Table
        headers={["Khoản mục", "Số tiền"]}
        rows={(
          [
            ["Tiền mặt đầu ca", r.reconciliation.openingCash],
            ["Tiền mặt thu gộp", r.reconciliation.grossCash],
            ["Tiền mặt đã hoàn", r.revenue.cashRefunds],
            ["Tiền mặt thu ròng", r.reconciliation.netCash],
            ["Tiền mặt dự kiến", r.reconciliation.expectedCash],
            ["Thực đếm", r.reconciliation.countedCash],
            ["Thừa/thiếu", r.reconciliation.difference],
            ["Chuyển khoản ròng", r.reconciliation.transfer],
          ] as [string, number | null][]
        ).map(([t, v]) => [t, v === null ? "Chưa chốt" : money(v)])}
      />
      <p className="text-sm">Ghi chú chốt ca: {r.shift.closingNote || "—"}</p>
      <h3 className="font-semibold">Giao dịch · {r.sales.length} đơn</h3>
      <Table
        headers={[
          "Đơn",
          "Thời gian",
          "Nhân viên",
          "Chi tiết",
          "Gốc",
          "Ròng",
          "Tiền mặt ròng",
          "CK ròng",
          "Trạng thái",
        ]}
        rows={r.sales.map((s) => [
          "#" + s.id.slice(-7),
          date(s.at),
          s.employee,
          s.lines
            .map((l) => `${l.quantity} × ${l.name} (${l.variant})`)
            .join("; "),
          money(s.total),
          money(s.net),
          money(s.netCash),
          money(s.netTransfer),
          status(s.status),
        ])}
      />
      <h3 className="font-semibold">Hoàn/hủy</h3>
      <Table
        headers={[
          "Đơn",
          "Thời gian",
          "Người thực hiện",
          "Loại",
          "Số tiền",
          "Lý do",
        ]}
        rows={r.reversals.map((v) => [
          "#" + v.sale.slice(-7),
          date(v.at),
          v.actor,
          v.kind === "cancel" ? "Hủy" : "Hoàn tiền",
          money(v.total),
          v.reason,
        ])}
      />
      <h3 className="font-semibold">Lịch sử bổ sung/biến động kho</h3>
      <Table
        headers={[
          "Thời gian",
          "Sản phẩm",
          "Người thực hiện",
          "Loại",
          "Số lượng +/-",
          "Lý do",
        ]}
        rows={r.movements.map((m) => [
          date(m.at),
          m.name,
          m.actor,
          m.kind,
          m.quantity,
          m.reason,
        ])}
      />
      <h3 className="font-semibold">Ghi chú bàn giao</h3>
      <Table
        headers={["Thời gian", "Từ", "Đến", "Ghi chú"]}
        rows={r.shift.handovers.map((h) => [
          date(h.at),
          h.fromName,
          h.toName,
          h.note,
        ])}
      />
    </div>
  );
}

export function ReverseSaleForm({
  sale,
  busy,
  onSubmit,
}: {
  sale: {
    _id: string;
    shift: string;
    cash: number;
    transfer: number;
    total: number;
    lines: { name: string; kind: string; quantity: number }[];
  };
  busy: boolean;
  onSubmit: (b: unknown) => void;
}) {
  const [key] = useState(() => crypto.randomUUID());
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        onSubmit({
          key,
          sale: sale._id,
          shift: sale.shift,
          kind: f.get("kind"),
          reason: f.get("reason"),
          restock: sale.lines.flatMap((l, i) =>
            l.kind === "bottle"
              ? [{ lineIndex: i, quantity: Number(f.get("return-" + i)) }]
              : [],
          ),
        });
      }}
    >
      <h2 className="text-xl font-semibold">
        Hoàn/hủy đơn #{sale._id.slice(-7)}
      </h2>
      <p>
        Hoàn toàn bộ {money(sale.total)}: tiền mặt {money(sale.cash)}, chuyển
        khoản {money(sale.transfer)}.
      </p>
      <p className="text-xs muted">
        Xác nhận đã hoàn tiền qua đúng phương thức gốc. Chỉ nhập lại chai thực
        nhận, còn nguyên và bán lại được; chai đã sử dụng để 0. Đơn gốc được giữ
        nguyên trong lịch sử. Chỉ áp dụng ca đang mở.
      </p>
      <label>
        Loại xử lý
        <select name="kind">
          <option value="refund">Hoàn tiền toàn bộ đơn</option>
          <option value="cancel">Hủy toàn bộ đơn đã thu</option>
        </select>
      </label>
      {sale.lines.map((l, i) =>
        l.kind === "bottle" ? (
          <label key={i}>
            {l.name} · đã bán {l.quantity} chai · số chai nhập lại
            <input
              required
              name={"return-" + i}
              type="number"
              min={0}
              max={l.quantity}
              defaultValue={0}
              step={1}
            />
          </label>
        ) : null,
      )}
      <label>
        Lý do
        <textarea required minLength={3} maxLength={500} name="reason" />
      </label>
      <Button variant="destructive" disabled={busy}>
        Xác nhận hoàn/hủy
      </Button>
    </form>
  );
}
