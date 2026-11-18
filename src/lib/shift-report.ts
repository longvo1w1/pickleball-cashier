import mongoose, { type ClientSession } from "mongoose";
import {
  Shift,
  Sale,
  Stock,
  Social,
  Reversal,
  Movement,
  Product,
} from "./models";
import { HttpError } from "./auth";
import { id, unitPayment } from "./domain";
import { db } from "./db";
export type ShiftReport = {
  shift: {
    _id: string;
    status: string;
    startedAt: string;
    endedAt: string | null;
    cashier: string;
    openedBy: string;
    closingNote: string;
    handovers: { at: string; fromName: string; toName: string; note: string }[];
  };
  revenue: {
    water: number;
    socialMorning: number;
    socialEvening: number;
    other: number;
    gross: number;
    reversed: number;
    net: number;
    cash: number;
    transfer: number;
    cashRefunds: number;
    transferRefunds: number;
  };
  reconciliation: {
    openingCash: number;
    grossCash: number;
    netCash: number;
    expectedCash: number;
    countedCash: number | null;
    difference: number | null;
    transfer: number;
    totalsMatch: boolean;
    stockMatches: boolean;
  };
  stocks: {
    product: string;
    name: string;
    opening: number;
    added: number;
    sold: number;
    returned: number;
    adjustmentIn: number;
    adjustmentOut: number;
    adjustment: number;
    expected: number;
    counted: number | null;
    difference: number | null;
  }[];
  social: {
    id: string;
    name: string;
    period: string;
    joinedAt: string;
    price: number;
    paid: number;
    cash: number;
    transfer: number;
    method: string;
    status: string;
    sale: string | null;
  }[];
  sales: {
    id: string;
    at: string;
    employee: string;
    total: number;
    cash: number;
    transfer: number;
    net: number;
    netCash: number;
    netTransfer: number;
    status: string;
    lines: {
      name: string;
      variant: string;
      quantity: number;
      subtotal: number;
      kind: string;
    }[];
  }[];
  reversals: {
    id: string;
    sale: string;
    at: string;
    actor: string;
    kind: string;
    reason: string;
    total: number;
    cash: number;
    transfer: number;
    restock: { lineIndex: number; quantity: number }[];
  }[];
  movements: {
    at: string;
    product: string;
    name: string;
    actor: string;
    kind: string;
    quantity: number;
    reason: string;
  }[];
};
export async function buildShiftReport(
  shiftId: string,
  session: ClientSession,
): Promise<ShiftReport> {
  const s = await Shift.findById(shiftId)
    .session(session)
    .populate("cashier openedBy", "name")
    .lean();
  if (!s) throw new HttpError(404, "Không tìm thấy ca");
  const sales = await Sale.find({ shift: shiftId })
    .session(session)
    .sort({ createdAt: 1 })
    .populate("employee", "name")
    .lean();
  const reversals = await Reversal.find({ shift: shiftId })
    .session(session)
    .sort({ createdAt: 1 })
    .populate("actor", "name")
    .lean();
  const guests = await Social.find({ shift: shiftId })
    .session(session)
    .sort({ joinedAt: 1, _id: 1 })
    .lean();
  const stockRows =
    s.status === "closed" && s.stockSnapshot
      ? s.stockSnapshot
      : await Stock.find({ shift: shiftId }).session(session).lean();
  const movements = await Movement.find({ shift: shiftId })
    .session(session)
    .sort({ createdAt: 1 })
    .populate("actor", "name")
    .lean();
  const products = await Product.find({
    _id: { $in: stockRows.map((st: { product: unknown }) => st.product) },
  })
    .session(session)
    .select("name")
    .lean();
  const revBySale = new Map(reversals.map((r) => [String(r.sale), r]));
  const revenue = {
    water: 0,
    socialMorning: 0,
    socialEvening: 0,
    other: 0,
    gross: 0,
    reversed: 0,
    net: 0,
    cash: 0,
    transfer: 0,
    cashRefunds: 0,
    transferRefunds: 0,
  };
  let grossCash = 0;
  const saleDetails = sales.map((sale) => {
    const reversed = revBySale.has(String(sale._id));
    revenue.gross += sale.total;
    grossCash += sale.cash;
    revenue.cash += sale.cash;
    revenue.transfer += sale.transfer;
    for (const l of sale.lines) {
      const category =
        l.kind === "bottle" || l.kind === "prepared"
          ? "water"
          : l.kind === "social"
            ? l.variant === "Sáng"
              ? "socialMorning"
              : "socialEvening"
            : "other";
      revenue[category] += reversed ? 0 : l.subtotal;
    }
    return {
      id: String(sale._id),
      at: new Date(sale.createdAt).toISOString(),
      employee: sale.employee?.name || "—",
      total: sale.total,
      cash: sale.cash,
      transfer: sale.transfer,
      net: reversed ? 0 : sale.total,
      netCash: reversed ? 0 : sale.cash,
      netTransfer: reversed ? 0 : sale.transfer,
      status: reversed
        ? revBySale.get(String(sale._id))!.kind === "cancel"
          ? "cancelled"
          : "refunded"
        : "paid",
      lines: sale.lines,
    };
  });
  for (const r of reversals) {
    revenue.reversed += r.total;
    revenue.cashRefunds += r.cash;
    revenue.transferRefunds += r.transfer;
    revenue.cash -= r.cash;
    revenue.transfer -= r.transfer;
  }
  revenue.net = revenue.gross - revenue.reversed;
  const stocks = stockRows.map(
    (st: {
      product: unknown;
      name?: string;
      opening: number;
      added: number;
      sold: number;
      returned?: number;
      adjustment?: number;
      adjustmentIn?: number;
      adjustmentOut?: number;
      remaining: number;
      counted?: number;
      difference?: number;
    }) => {
      const adjustment = st.adjustment || 0;
      const incoming = st.adjustmentIn || 0,
        outgoing = st.adjustmentOut || 0;
      const legacy = adjustment - (incoming - outgoing);
      return {
        product: String(st.product),
        name:
          st.name ||
          products.find((p) => String(p._id) === String(st.product))?.name ||
          String(st.product),
        opening: st.opening,
        added: st.added,
        sold: st.sold,
        returned: st.returned || 0,
        adjustmentIn: incoming + Math.max(0, legacy),
        adjustmentOut: outgoing + Math.max(0, -legacy),
        adjustment,
        expected: st.remaining,
        counted: st.counted ?? null,
        difference: st.counted === undefined ? null : st.counted - st.remaining,
      };
    },
  );
  const legacyUnits = new Map<string, Set<number>>();
  const social = guests.map((g) => {
    const sale = sales.find((s) => String(s._id) === String(g.sale));
    let price = g.ticketPrice ?? null;
    let payment = { cash: g.cash ?? 0, transfer: g.transfer ?? 0 };
    if (sale && (price === null || g.cash === undefined)) {
      let offset = 0;
      for (let i = 0; i < sale.lines.length; i++) {
        const l = sale.lines[i];
        const guestNames: string[] = l.guestNames || l.guests || [];
        const unitKey = String(sale._id) + ":" + i;
        const used = legacyUnits.get(unitKey) || new Set<number>();
        let guestIndex = l.socialIds?.indexOf(String(g._id)) ?? -1;
        if (guestIndex >= 0) guestIndex += l.guests?.length || 0;
        else
          guestIndex = guestNames.findIndex(
            (name, index) => name === g.name && !used.has(index),
          );
        if (l.kind === "social" && (g.lineIndex === i || guestIndex >= 0)) {
          used.add(Math.max(0, guestIndex));
          legacyUnits.set(unitKey, used);
          price = l.price;
          payment = unitPayment(
            sale.cash,
            offset + Math.max(0, guestIndex) * l.price,
            l.price,
          );
          break;
        }
        offset += l.subtotal;
      }
    }
    const reversed = sale ? revBySale.get(String(sale._id)) : undefined;
    const paid = !!sale && g.paid && !reversed;
    return {
      id: String(g._id),
      name: g.name,
      period: g.period,
      joinedAt: new Date(g.joinedAt).toISOString(),
      price: price ?? 0,
      paid: paid ? (price ?? 0) : 0,
      cash: paid ? payment.cash : 0,
      transfer: paid ? payment.transfer : 0,
      method: paid
        ? payment.cash && payment.transfer
          ? "Kết hợp"
          : payment.cash
            ? "Tiền mặt"
            : "Chuyển khoản"
        : "—",
      status: paid
        ? "paid"
        : reversed
          ? reversed.kind === "cancel"
            ? "cancelled"
            : "refunded"
          : "unpaid",
      sale: g.sale ? String(g.sale) : null,
    };
  });
  return {
    shift: {
      _id: String(s._id),
      status: s.status,
      startedAt: new Date(s.createdAt).toISOString(),
      endedAt: s.closedAt ? new Date(s.closedAt).toISOString() : null,
      cashier: s.cashierName || s.cashier?.name || "—",
      openedBy: s.openedByName || s.openedBy?.name || "—",
      closingNote: s.closingNote || "",
      handovers: (s.handovers || []).map(
        (h: { at: Date; fromName: string; toName: string; note: string }) => ({
          at: new Date(h.at).toISOString(),
          fromName: h.fromName,
          toName: h.toName,
          note: h.note,
        }),
      ),
    },
    revenue,
    reconciliation: {
      openingCash: s.openingCash,
      grossCash,
      netCash: revenue.cash,
      expectedCash: s.openingCash + revenue.cash,
      countedCash: s.countedCash ?? null,
      difference:
        s.countedCash === undefined
          ? null
          : s.countedCash - s.openingCash - revenue.cash,
      transfer: revenue.transfer,
      totalsMatch:
        revenue.net === revenue.cash + revenue.transfer &&
        revenue.cash === s.cashSales &&
        revenue.transfer === s.transferSales,
      stockMatches: stocks.every(
        (st: ShiftReport["stocks"][number]) =>
          st.expected ===
          st.opening + st.added - st.sold + st.returned + st.adjustment,
      ),
    },
    stocks,
    social,
    sales: saleDetails,
    reversals: reversals.map((r) => ({
      id: String(r._id),
      sale: String(r.sale),
      at: new Date(r.createdAt).toISOString(),
      actor: r.actor?.name || "—",
      kind: r.kind,
      reason: r.reason,
      total: r.total,
      cash: r.cash,
      transfer: r.transfer,
      restock: r.restock,
    })),
    movements: movements.map((m) => ({
      at: new Date(m.createdAt).toISOString(),
      product: String(m.product),
      name:
        m.name ||
        products.find((p) => String(p._id) === String(m.product))?.name ||
        String(m.product),
      actor: m.actor?.name || "—",
      kind: m.kind,
      quantity: m.quantity,
      reason: m.reason || "",
    })),
  };
}
export async function getShiftReport(
  u: { _id: mongoose.Types.ObjectId; role: string },
  shiftId: string,
) {
  id.parse(shiftId);
  await db();
  return mongoose.connection.transaction(
    async (session) => {
      const s = await Shift.findById(shiftId).session(session);
      if (!s) throw new HttpError(404, "Không tìm thấy ca");
      if (
        u.role === "Cashier" &&
        ![s.cashier, s.openedBy, ...(s.participants || [])].some(
          (v) => String(v) === String(u._id),
        ) &&
        !(await Sale.exists({ shift: shiftId, employee: u._id }).session(
          session,
        ))
      )
        throw new HttpError(403, "Bạn không có quyền xem ca này");
      return buildShiftReport(shiftId, session);
    },
    { readConcern: { level: "snapshot" } },
  );
}
