"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronRight,
  ClipboardList,
  Clock3,
  CreditCard,
  History,
  LayoutGrid,
  LogOut,
  Minus,
  Package,
  Plus,
  Search,
  Settings2,
  ShoppingBag,
  Trash2,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { Button } from "./ui/button";
import { money } from "@/lib/utils";
type Product = {
  _id: string;
  name: string;
  category: string;
  kind: string;
  variants: { name: string; price: number }[];
  defaultStock: number;
  active: boolean;
};
type Stock = {
  _id: string;
  product: string;
  opening: number;
  added: number;
  sold: number;
  adjustment: number;
  remaining: number;
  counted?: number;
  difference?: number;
};
type Shift = {
  _id: string;
  status: string;
  createdAt: string;
  openingCash: number;
  cashSales: number;
  transferSales: number;
  countedCash?: number;
  cashDifference?: number;
  cashier?: { _id: string; name: string } | string;
  stockSnapshot?: Stock[];
};
type Sale = {
  _id: string;
  createdAt: string;
  shift: string;
  employee: { _id: string; name: string };
  total: number;
  cash: number;
  transfer: number;
  lines: {
    name: string;
    variant: string;
    quantity: number;
    subtotal: number;
  }[];
};
type Guest = {
  _id: string;
  name: string;
  period: string;
  paid: boolean;
  joinedAt: string;
};
type User = { _id: string; name: string; role: string; email?: string };
type Data = {
  user: User;
  products: Product[];
  categories: { _id: string; name: string; active: boolean }[];
  shift: Shift | null;
  stocks: Stock[];
  sales: Sale[];
  social: Guest[];
  shifts: Shift[];
  users: User[];
  audits: {
    _id: string;
    actor?: { name: string };
    action: string;
    entity: string;
    createdAt: string;
    details: unknown;
  }[];
};
type Line = {
  product: string;
  variant: string;
  quantity: number;
  price: number;
  name: string;
  kind: string;
  guests: string[];
  socialIds?: string[];
};
const tabs = [
  { name: "Bán hàng", icon: LayoutGrid },
  { name: "Giao dịch", icon: History },
  { name: "Sản phẩm", icon: Package },
  { name: "Kho hàng", icon: ClipboardList },
  { name: "Khách Social", icon: Users },
  { name: "Quản lý ca", icon: Clock3 },
  { name: "Báo cáo", icon: Activity },
  { name: "Thiết lập", icon: Settings2 },
];
const date = (s: string) =>
  new Date(s).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  });
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
async function api(path: string, method = "GET", body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json();
  if (!res.ok)
    throw new ApiError(res.status, json.error || "Không thể kết nối");
  return json;
}
function Field({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <label>
      {title}
      {children}
    </label>
  );
}
function Num({
  name,
  defaultValue = 0,
  min = 0,
}: {
  name: string;
  defaultValue?: number;
  min?: number;
}) {
  return (
    <input
      name={name}
      type="number"
      required
      min={min}
      step="1"
      defaultValue={defaultValue}
    />
  );
}
export function Desk() {
  const [data, setData] = useState<Data | null>(null),
    [loaded, setLoaded] = useState(false),
    [tab, setTab] = useState("Bán hàng"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(""),
    [category, setCategory] = useState("Tất cả"),
    [cart, setCart] = useState<Line[]>([]),
    [pay, setPay] = useState("cash"),
    [cash, setCash] = useState(""),
    [modal, setModal] = useState<string | null>(null),
    [editing, setEditing] = useState<Product | null>(null),
    [reportFrom, setReportFrom] = useState(""),
    [reportTo, setReportTo] = useState("");
  const key = useRef<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const d = await api("/api/workspace");
      setData(d);
    } catch (e) {
      if (
        (e as Error).message.includes("đăng nhập") ||
        (e as Error).message.includes("hết hạn")
      )
        setData(null);
      else setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function run(action: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      const result = await api("/api/workspace", "POST", {
        action,
        data: body,
      });
      await refresh();
      setModal(null);
      setNotice("Đã lưu thành công");
      return result;
    } catch (e) {
      if (
        action === "checkout" &&
        e instanceof ApiError &&
        [400, 403, 409].includes(e.status)
      )
        key.current = null;
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  const total = cart.reduce((n, l) => n + l.price * l.quantity, 0),
    manager = data?.user.role !== "Cashier";
  function changeCart(next: Line[]) {
    if (key.current) {
      setError(
        "Đơn đang chờ xác nhận. Giữ nguyên đơn và gửi lại để tránh thanh toán trùng.",
      );
      return;
    }
    setCart(next);
  }
  function add(p: Product, variant: string, guest?: Guest) {
    const v = p.variants.find((x) => x.name === variant)!;
    const st = data?.stocks.find((s) => s.product === p._id);
    const used = cart
      .filter((l) => l.product === p._id)
      .reduce((n, l) => n + l.quantity, 0);
    if (p.kind === "bottle" && used >= (st?.remaining || 0)) {
      setError("Không đủ tồn kho");
      return;
    }
    if (guest && cart.some((l) => l.socialIds?.includes(guest._id))) {
      setError("Khách đã có trong giỏ");
      return;
    }
    const index = cart.findIndex(
      (l) =>
        l.product === p._id &&
        l.variant === variant &&
        !l.socialIds?.length &&
        p.kind !== "social",
    );
    if (index >= 0)
      changeCart(
        cart.map((l, i) =>
          i === index ? { ...l, quantity: l.quantity + 1 } : l,
        ),
      );
    else
      changeCart([
        ...cart,
        {
          product: p._id,
          variant,
          quantity: 1,
          price: v.price,
          name: p.name,
          kind: p.kind,
          guests: guest ? [] : p.kind === "social" ? [""] : [],
          ...(guest ? { socialIds: [guest._id] } : {}),
        },
      ]);
  }
  async function checkout() {
    if (!data?.shift) return;
    key.current ??= crypto.randomUUID();
    const result = await run("checkout", {
      key: key.current,
      shift: data.shift._id,
      lines: cart.map(({ product, variant, quantity, guests, socialIds }) => ({
        product,
        variant,
        quantity,
        ...(guests.length ? { guests } : {}),
        ...(socialIds ? { socialIds } : {}),
      })),
      cash: pay === "cash" ? total : pay === "transfer" ? 0 : Number(cash),
      transfer:
        pay === "transfer" ? total : pay === "cash" ? 0 : total - Number(cash),
    });
    if (result) {
      setCart([]);
      key.current = null;
      setCash("");
      setNotice("Thanh toán thành công · " + money(result.total));
    }
  }
  function submit(
    e: React.FormEvent<HTMLFormElement>,
    action: string,
    body: (f: FormData) => unknown,
  ) {
    e.preventDefault();
    void run(action, body(new FormData(e.currentTarget)));
  }
  if (!loaded)
    return (
      <div className="min-h-dvh grid place-items-center text-emerald-900">
        Đang kết nối quầy thu ngân…
      </div>
    );
  if (!data)
    return (
      <main className="min-h-dvh grid place-items-center p-6">
        <div className="w-full max-w-md">
          <div className="flex items-center gap-3 mb-10">
            <div className="bg-emerald-900 text-lime-200 rounded-xl p-3">
              <ShoppingBag size={25} />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                court<span className="text-emerald-700">desk.</span>
              </h1>
              <p className="eyebrow mt-1">PICKLEBALL CASHIER</p>
            </div>
          </div>
          <div className="panel">
            <p className="eyebrow mb-3">CHÀO MỪNG TRỞ LẠI</p>
            <h2 className="text-2xl font-semibold mb-2">
              Sẵn sàng cho một ca mới
            </h2>
            <p className="muted mb-7">
              Đăng nhập để quản lý quầy thu ngân của bạn.
            </p>
            <form
              className="space-y-5"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                const f = new FormData(e.currentTarget);
                try {
                  await api("/api/auth", "POST", {
                    email: f.get("email"),
                    password: f.get("password"),
                  });
                  await refresh();
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Field title="Email">
                <input
                  name="email"
                  type="email"
                  autoComplete="username"
                  placeholder="ban@sanpickleball.vn"
                  required
                />
              </Field>
              <Field title="Mật khẩu">
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </Field>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <Button className="w-full" disabled={busy}>
                Đăng nhập <ArrowRight size={16} />
              </Button>
            </form>
          </div>
          <p className="text-xs muted text-center mt-6">
            Dữ liệu được lưu trên MongoDB · Truy cập theo phân quyền
          </p>
        </div>
      </main>
    );
  const products = data.products.filter((p) => p.active),
    filtered = products.filter(
      (p) =>
        (category === "Tất cả" || p.category === category) &&
        p.name.toLowerCase().includes(search.toLowerCase()),
    );
  const visibleTabs = tabs.filter(
    (t) => manager || !["Sản phẩm", "Báo cáo", "Thiết lập"].includes(t.name),
  );
  const today = new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());
  return (
    <>
      <aside className="sidebar">
        <div className="flex items-center gap-2 px-3 mb-10">
          <div className="bg-emerald-900 text-lime-200 rounded-lg p-2">
            <ShoppingBag size={20} />
          </div>
          <div>
            <div className="text-xl font-bold tracking-tight">courtdesk.</div>
            <div className="eyebrow" style={{ fontSize: 8 }}>
              PICKLEBALL CASHIER
            </div>
          </div>
        </div>
        <div className="eyebrow px-3 mb-3">KHÔNG GIAN LÀM VIỆC</div>
        <nav>
          {visibleTabs.map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={"nav-item " + (tab === name ? "active" : "")}
              onClick={() => {
                setTab(name);
                setError("");
              }}
            >
              <Icon size={18} />
              {name}
              {name === "Khách Social" &&
                data.social.filter((g) => !g.paid).length > 0 && (
                  <span className="ml-auto text-xs">
                    {data.social.filter((g) => !g.paid).length}
                  </span>
                )}
            </button>
          ))}
        </nav>
        <div className="mt-auto">
          <div className="rounded-xl bg-stone-50 border border-stone-100 p-3 mb-5">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <span
                className={
                  "w-2 h-2 rounded-full " +
                  (data.shift ? "bg-emerald-500" : "bg-stone-400")
                }
              />
              {data.shift ? "Ca đang hoạt động" : "Chưa mở ca"}
            </div>
            <div className="text-xs muted mt-2">
              {data.shift
                ? "Mở lúc " + date(data.shift.createdAt)
                : "Mở ca để bắt đầu bán hàng"}
            </div>
          </div>
          <div className="flex gap-2 items-center px-2">
            <div className="w-9 h-9 rounded-full bg-[#e7edde] grid place-items-center font-bold text-emerald-800">
              {data.user.name.charAt(0)}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold truncate">{data.user.name}</p>
              <p className="text-[10px] muted mt-1">{data.user.role}</p>
            </div>
            <button
              aria-label="Đăng xuất"
              className="ml-auto p-2"
              onClick={async () => {
                try {
                  await api("/api/auth", "DELETE");
                  setData(null);
                  setCart([]);
                  key.current = null;
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar flex items-center justify-between border-b border-stone-200 bg-white px-8 py-5">
          <div>
            <div className="flex items-center gap-2 text-[10px] muted mb-1">
              <span>Quản lý sân</span>
              <ChevronRight size={10} />
              <span>{tab}</span>
            </div>
            <h1 className="text-xl font-semibold tracking-tight">
              {tab === "Bán hàng" ? "Quầy thu ngân" : tab}
            </h1>
          </div>
          <div className="text-right">
            <p className="text-xs font-medium desktop-label capitalize">
              {today}
            </p>
            <p className="text-[10px] muted mt-1 desktop-label">
              Mỗi giao dịch, một trải nghiệm tốt hơn.
            </p>
            <Button
              className="md:hidden"
              variant="ghost"
              onClick={async () => {
                await api("/api/auth", "DELETE");
                setData(null);
              }}
            >
              Đăng xuất
            </Button>
          </div>
        </header>
        <nav className="mobile-nav">
          {visibleTabs.map((t) => (
            <Button
              variant={tab === t.name ? "default" : "ghost"}
              key={t.name}
              onClick={() => setTab(t.name)}
            >
              {t.name}
            </Button>
          ))}
        </nav>
        <div className="page-content p-8 max-w-[1650px] mx-auto">
          {error && (
            <div
              className="error mb-5 flex items-center justify-between"
              role="alert"
            >
              {error}
              <button
                className="p-2"
                aria-label="Đóng lỗi"
                onClick={() => setError("")}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {notice && (
            <div
              role="status"
              className="no-print mb-5 flex items-center gap-2 bg-emerald-50 border border-emerald-100 p-3 rounded-xl text-emerald-800 text-sm"
            >
              <Check size={16} />
              {notice}
              <button
                className="ml-auto p-2"
                aria-label="Đóng thông báo"
                onClick={() => setNotice("")}
              >
                <X size={14} />
              </button>
            </div>
          )}
          {tab === "Bán hàng" && (
            <>
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h2 className="font-semibold text-lg">
                    Một ca làm việc thật suôn sẻ.
                  </h2>
                  <p className="muted text-xs mt-1">
                    Chọn sản phẩm, thêm vào giỏ và thanh toán.
                  </p>
                </div>
                <span className="tag">
                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                  {data.shift ? "Đang mở ca" : "Chưa mở ca"}
                </span>
              </div>
              {!data.shift && (
                <div className="panel mb-5 flex items-center justify-between gap-4">
                  <p>Mở ca và xác nhận tồn đầu ca trước khi bán.</p>
                  <Button onClick={() => setModal("open")}>
                    Mở ca <ArrowRight size={15} />
                  </Button>
                </div>
              )}
              <div className="pos-layout">
                <section className="min-w-0 flex-1">
                  <div className="relative mb-4">
                    <Search
                      size={17}
                      className="absolute left-3.5 top-3.5 text-stone-400"
                    />
                    <input
                      className="pl-10"
                      placeholder="Tìm sản phẩm…"
                      aria-label="Tìm sản phẩm"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2 mb-5">
                    {[
                      "Tất cả",
                      ...data.categories
                        .filter((c) => c.active)
                        .map((c) => c.name),
                    ].map((c) => (
                      <button
                        className={
                          "px-3 py-2.5 rounded-lg text-xs border font-medium " +
                          (category === c
                            ? "bg-emerald-900 border-emerald-900 text-white"
                            : "bg-white border-stone-200 text-stone-600")
                        }
                        key={c}
                        onClick={() => setCategory(c)}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                  <div className="flex justify-between items-center mb-3">
                    <p className="eyebrow">THỰC ĐƠN</p>
                    <span className="text-[10px] muted">
                      {filtered.length} sản phẩm
                    </span>
                  </div>
                  <div className="product-grid">
                    {filtered.map((p, i) => {
                      const st = data.stocks.find((s) => s.product === p._id);
                      return (
                        <article className="product-card" key={p._id}>
                          <div
                            className="product-art"
                            style={
                              {
                                "--tone":
                                  p.kind === "social"
                                    ? "#f5efe0"
                                    : p.kind === "prepared"
                                      ? "#f4ede3"
                                      : i % 3 === 0
                                        ? "#edf2e4"
                                        : i % 3 === 1
                                          ? "#eef1ec"
                                          : "#eff4d9",
                                "--drink": p.name.includes("Trắng")
                                  ? "#edf1dc"
                                  : p.name.includes("suối")
                                    ? "#d4e7e3"
                                    : p.kind === "prepared"
                                      ? "#bd8f52"
                                      : "#d2df4f",
                              } as React.CSSProperties
                            }
                          >
                            {p.kind === "social" ? (
                              <div className="ticket">
                                SOCIAL{" "}
                                <span className="block text-[8px] mt-1 text-center">
                                  PLAY · CONNECT
                                </span>
                              </div>
                            ) : (
                              <div
                                className="bottle"
                                data-label={
                                  p.name.includes("Revive")
                                    ? "REVIVE"
                                    : p.name.includes("suối")
                                      ? "WATER"
                                      : "TEA"
                                }
                              />
                            )}
                            <span className="absolute top-2 right-2 text-[9px] bg-white/80 px-1.5 py-1 rounded text-stone-500">
                              {p.kind === "bottle"
                                ? `${st?.remaining ?? "—"} chai`
                                : p.kind === "social"
                                  ? "Vé tham gia"
                                  : "Pha chế"}
                            </span>
                          </div>
                          <div className="p-3">
                            <h3 className="text-sm font-semibold mb-1">
                              {p.name}
                            </h3>
                            <p className="text-[10px] muted mb-3">
                              {p.category}
                            </p>
                            <div className="space-y-1.5">
                              {p.variants.map((v) => (
                                <button
                                  disabled={
                                    !data.shift ||
                                    busy ||
                                    (p.kind === "bottle" && !st?.remaining)
                                  }
                                  key={v.name}
                                  onClick={() => add(p, v.name)}
                                  className="w-full flex items-center justify-between rounded-lg bg-stone-50 hover:bg-emerald-50 px-2.5 py-2.5 disabled:opacity-40 text-xs"
                                >
                                  <span className="text-stone-500">
                                    {v.name}
                                  </span>
                                  <span className="font-semibold flex items-center gap-2">
                                    {money(v.price)}
                                    <Plus
                                      size={13}
                                      className="text-emerald-700"
                                    />
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                  {!filtered.length && (
                    <div className="panel muted text-center py-12">
                      Chưa có sản phẩm. Quản lý có thể thêm ở mục Sản phẩm.
                    </div>
                  )}
                  <p className="mt-5 text-[10px] muted flex items-center gap-1.5">
                    <Package size={12} /> Tồn kho được kiểm tra lại khi thanh
                    toán.
                  </p>
                </section>
                <aside className="cart panel !p-0 overflow-hidden">
                  <div className="flex justify-between items-center px-5 py-4 border-b border-stone-100">
                    <h2 className="font-semibold flex items-center gap-2">
                      <ShoppingBag size={17} /> Đơn hiện tại{" "}
                      <span className="bg-stone-100 text-stone-500 px-2 py-1 text-[10px] rounded">
                        {cart.reduce((n, l) => n + l.quantity, 0)}
                      </span>
                    </h2>
                    <button
                      aria-label="Xóa giỏ hàng"
                      className="text-stone-400 p-2"
                      onClick={() => changeCart([])}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <div className="px-5 py-3 bg-stone-50 text-[10px] muted flex justify-between">
                    <span>Nhân viên: {data.user.name}</span>
                    <span>
                      {data.shift
                        ? "Ca #" + data.shift._id.slice(-5).toUpperCase()
                        : "—"}
                    </span>
                  </div>
                  <div className="px-5 min-h-[180px] max-h-[400px] overflow-auto">
                    {!cart.length ? (
                      <div className="text-center py-12 muted">
                        <ShoppingBag
                          size={27}
                          className="mx-auto mb-3 text-stone-300"
                        />
                        <p className="text-xs">Giỏ hàng đang trống</p>
                        <p className="text-[10px] mt-1">
                          Thêm sản phẩm để bắt đầu.
                        </p>
                      </div>
                    ) : (
                      cart.map((l, i) => (
                        <div key={i} className="py-4 border-b border-stone-100">
                          <div className="flex justify-between gap-2 text-xs font-semibold">
                            <span>{l.name}</span>
                            <span>{money(l.quantity * l.price)}</span>
                          </div>
                          <p className="text-[10px] muted mt-1">
                            {l.variant} · {money(l.price)}
                          </p>
                          <div className="flex items-center gap-3 mt-3">
                            <button
                              aria-label={"Giảm " + l.name}
                              disabled={!!l.socialIds?.length}
                              className="border rounded-md p-1"
                              onClick={() =>
                                changeCart(
                                  cart.flatMap((x, j) =>
                                    j !== i
                                      ? [x]
                                      : x.quantity === 1
                                        ? []
                                        : [
                                            {
                                              ...x,
                                              quantity: x.quantity - 1,
                                              guests: x.guests.slice(0, -1),
                                            },
                                          ],
                                  ),
                                )
                              }
                            >
                              <Minus size={12} />
                            </button>
                            <span className="text-xs">{l.quantity}</span>
                            <button
                              aria-label={"Tăng " + l.name}
                              disabled={!!l.socialIds?.length}
                              className="border rounded-md p-1"
                              onClick={() => {
                                if (l.kind === "social")
                                  changeCart(
                                    cart.map((x, j) =>
                                      j === i
                                        ? {
                                            ...x,
                                            quantity: x.quantity + 1,
                                            guests: [...x.guests, ""],
                                          }
                                        : x,
                                    ),
                                  );
                                else
                                  add(
                                    products.find((p) => p._id === l.product)!,
                                    l.variant,
                                  );
                              }}
                            >
                              <Plus size={12} />
                            </button>
                            <button
                              aria-label={"Hủy " + l.name}
                              className="ml-auto text-stone-400 p-1"
                              onClick={() =>
                                changeCart(cart.filter((_, j) => i !== j))
                              }
                            >
                              <X size={13} />
                            </button>
                          </div>
                          {l.guests.map((g, j) => (
                            <input
                              key={j}
                              className="mt-2 !min-h-9 !text-xs"
                              placeholder={"Tên khách " + (j + 1)}
                              aria-label={"Tên khách " + (j + 1)}
                              value={g}
                              onChange={(e) =>
                                changeCart(
                                  cart.map((x, k) =>
                                    k === i
                                      ? {
                                          ...x,
                                          guests: x.guests.map((v, n) =>
                                            n === j ? e.target.value : v,
                                          ),
                                        }
                                      : x,
                                  ),
                                )
                              }
                            />
                          ))}
                          {l.socialIds?.map((g) => (
                            <p key={g} className="text-xs mt-2">
                              Khách:{" "}
                              {data.social.find((x) => x._id === g)?.name}
                            </p>
                          ))}
                        </div>
                      ))
                    )}
                  </div>
                  <div className="p-5 border-t border-stone-100">
                    <div className="flex justify-between text-xs muted mb-3">
                      <span>Tạm tính</span>
                      <span>{money(total)}</span>
                    </div>
                    <div className="flex justify-between items-center mb-5">
                      <span className="text-sm font-semibold">
                        Tổng thanh toán
                      </span>
                      <strong className="text-2xl tracking-tight text-emerald-900 tabnums">
                        {money(total)}
                      </strong>
                    </div>
                    <p className="eyebrow mb-3">PHƯƠNG THỨC THANH TOÁN</p>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: "cash", name: "Tiền mặt", icon: Wallet },
                        {
                          id: "transfer",
                          name: "Chuyển khoản",
                          icon: CreditCard,
                        },
                        { id: "mixed", name: "Kết hợp", icon: Plus },
                      ].map(({ id, name, icon: Icon }) => (
                        <button
                          disabled={!!key.current}
                          onClick={() => setPay(id)}
                          key={id}
                          className={
                            "border rounded-lg py-3 text-[10px] flex flex-col items-center gap-2 " +
                            (pay === id
                              ? "border-emerald-800 bg-emerald-50 text-emerald-900"
                              : "border-stone-200 text-stone-500")
                          }
                        >
                          <Icon size={17} />
                          {name}
                        </button>
                      ))}
                    </div>
                    {pay === "mixed" && (
                      <label className="mt-3 text-xs">
                        Tiền mặt nhận
                        <input
                          disabled={!!key.current}
                          type="number"
                          min="0"
                          max={total}
                          value={cash}
                          onChange={(e) => setCash(e.target.value)}
                        />
                        <span className="muted font-normal">
                          Chuyển khoản: {money(total - Number(cash))}
                        </span>
                      </label>
                    )}
                    <Button
                      className="w-full mt-5 !py-3.5"
                      disabled={
                        !cart.length ||
                        busy ||
                        !data.shift ||
                        cart.some((l) => l.guests.some((g) => !g.trim())) ||
                        (pay === "mixed" &&
                          (!cash || Number(cash) > total || Number(cash) < 0))
                      }
                      onClick={() => void checkout()}
                    >
                      {busy
                        ? "Đang xử lý…"
                        : key.current
                          ? "Gửi lại thanh toán"
                          : "Thanh toán"}
                      <ArrowRight size={16} />
                    </Button>
                    <p className="text-[9px] text-center muted mt-3">
                      {key.current
                        ? "Giữ nguyên đơn để xác nhận kết quả thanh toán."
                        : "Kiểm tra tiền đã nhận trước khi xác nhận."}
                    </p>
                  </div>
                </aside>
              </div>
            </>
          )}
          {tab === "Giao dịch" && (
            <section className="panel">
              <div className="flex justify-between mb-5">
                <div>
                  <h2 className="text-lg font-semibold">Lịch sử giao dịch</h2>
                  <p className="muted text-xs mt-1">
                    200 giao dịch gần nhất · Chi tiết được lưu theo ca và nhân
                    viên
                  </p>
                </div>
                <Button variant="outline" onClick={() => void refresh()}>
                  Làm mới
                </Button>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Giao dịch</th>
                      <th>Thời gian</th>
                      <th>Nhân viên</th>
                      <th>Chi tiết</th>
                      <th>Tiền mặt</th>
                      <th>Chuyển khoản</th>
                      <th>Tổng</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sales.map((s) => (
                      <tr key={s._id}>
                        <td>#{s._id.slice(-7)}</td>
                        <td>{date(s.createdAt)}</td>
                        <td>{s.employee?.name}</td>
                        <td>
                          {s.lines.map((l, i) => (
                            <p className="mb-1" key={i}>
                              {l.quantity} × {l.name} ({l.variant})
                            </p>
                          ))}
                        </td>
                        <td>{money(s.cash)}</td>
                        <td>{money(s.transfer)}</td>
                        <td className="font-semibold">{money(s.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!data.sales.length && (
                <p className="muted text-center py-10">Chưa có giao dịch.</p>
              )}
            </section>
          )}
          {tab === "Sản phẩm" && manager && (
            <section>
              <div className="flex justify-between items-center mb-5">
                <div>
                  <h2 className="text-lg font-semibold">Danh mục sản phẩm</h2>
                  <p className="muted text-xs mt-1">
                    Giá và tùy chọn được quản lý tại quầy.
                  </p>
                </div>
                <Button
                  onClick={() => {
                    setEditing(null);
                    setModal("product");
                  }}
                >
                  <Plus size={16} />
                  Thêm sản phẩm
                </Button>
              </div>
              <div className="panel table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Sản phẩm</th>
                      <th>Danh mục</th>
                      <th>Giá bán</th>
                      <th>Tồn mặc định</th>
                      <th>Trạng thái</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.products.map((p) => (
                      <tr key={p._id}>
                        <td className="font-semibold">{p.name}</td>
                        <td>{p.category}</td>
                        <td>
                          {p.variants.map((v) => (
                            <p key={v.name}>
                              {v.name}: {money(v.price)}
                            </p>
                          ))}
                        </td>
                        <td>
                          {p.kind === "bottle"
                            ? p.defaultStock
                            : "Không đếm chai"}
                        </td>
                        <td>{p.active ? "Đang bán" : "Ngừng bán"}</td>
                        <td>
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setEditing(p);
                              setModal("product");
                            }}
                          >
                            Sửa
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={busy || !p.active}
                            onClick={() =>
                              void run("deleteProduct", { id: p._id })
                            }
                          >
                            Ngừng bán
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="panel mt-5">
                <h3 className="font-semibold mb-4">Danh mục</h3>
                <div className="flex flex-wrap gap-2 mb-4">
                  {data.categories.map((c) => (
                    <button
                      className="tag"
                      key={c._id}
                      onClick={() => setModal("category:" + c._id)}
                    >
                      {c.name} · {c.active ? "Hoạt động" : "Ẩn"}
                    </button>
                  ))}
                </div>
                <Button variant="outline" onClick={() => setModal("category")}>
                  Thêm danh mục
                </Button>
              </div>
            </section>
          )}
          {tab === "Kho hàng" && (
            <section className="panel">
              <div className="flex justify-between mb-5">
                <div>
                  <h2 className="text-lg font-semibold">Kiểm soát tồn kho</h2>
                  <p className="muted text-xs mt-1">
                    Chỉ đếm chai · Trà đá pha chế không trừ kho chai
                  </p>
                </div>
                {manager && data.shift && (
                  <Button onClick={() => setModal("stock")}>
                    <Plus size={16} />
                    Nhập / điều chỉnh
                  </Button>
                )}
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Sản phẩm</th>
                      <th>Đầu ca</th>
                      <th>Nhập thêm</th>
                      <th>Đã bán</th>
                      <th>Điều chỉnh</th>
                      <th>Còn lại</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.stocks.map((s) => (
                      <tr key={s._id}>
                        <td className="font-semibold">
                          {data.products.find((p) => p._id === s.product)
                            ?.name || s.product}
                        </td>
                        <td>{s.opening}</td>
                        <td>{s.added}</td>
                        <td>{s.sold}</td>
                        <td>{s.adjustment}</td>
                        <td>
                          <span className="tag">{s.remaining} chai</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!data.shift && (
                <p className="muted py-8 text-center">
                  Mở ca để ghi nhận tồn đầu ca.
                </p>
              )}
            </section>
          )}
          {tab === "Khách Social" && (
            <section className="panel">
              <div className="flex justify-between mb-5">
                <div>
                  <h2 className="text-lg font-semibold">
                    Cùng chơi, cùng kết nối
                  </h2>
                  <p className="muted text-xs mt-1">
                    {data.social.length} lượt trong ca ·{" "}
                    {data.social.filter((g) => !g.paid).length} chưa thanh toán
                  </p>
                </div>
                <Button
                  disabled={!data.shift}
                  onClick={() => setModal("social")}
                >
                  <Plus size={16} />
                  Thêm khách
                </Button>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Khách tham gia</th>
                      <th>Buổi</th>
                      <th>Thời gian</th>
                      <th>Thanh toán</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.social.map((g) => (
                      <tr key={g._id}>
                        <td className="font-semibold">{g.name}</td>
                        <td>{g.period === "morning" ? "Sáng" : "Tối"}</td>
                        <td>{date(g.joinedAt)}</td>
                        <td>
                          <span
                            className={
                              g.paid ? "tag" : "text-amber-700 text-xs"
                            }
                          >
                            {g.paid ? "Đã thanh toán" : "Chưa thanh toán"}
                          </span>
                        </td>
                        <td>
                          {!g.paid && (
                            <Button
                              variant="outline"
                              onClick={() => {
                                const p = products.find(
                                  (p) =>
                                    p.kind === "social" &&
                                    p.variants.some(
                                      (v) =>
                                        v.name ===
                                        (g.period === "morning"
                                          ? "Sáng"
                                          : "Tối"),
                                    ),
                                );
                                if (p) {
                                  add(
                                    p,
                                    g.period === "morning" ? "Sáng" : "Tối",
                                    g,
                                  );
                                  setTab("Bán hàng");
                                } else setError("Chưa có vé Social phù hợp");
                              }}
                            >
                              Thu tiền
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {tab === "Quản lý ca" && (
            <section>
              <div className="flex justify-between items-center mb-5">
                <div>
                  <h2 className="text-lg font-semibold">Ca bán hàng</h2>
                  <p className="muted text-xs mt-1">
                    Chốt ca khóa dữ liệu và lưu chênh lệch kiểm kê.
                  </p>
                </div>
                <div className="flex gap-2">
                  {data.shift ? (
                    <>
                      {manager && (
                        <Button
                          variant="outline"
                          onClick={() => setModal("handover")}
                        >
                          Bàn giao
                        </Button>
                      )}
                      <Button onClick={() => setModal("close")}>Chốt ca</Button>
                    </>
                  ) : (
                    <Button onClick={() => setModal("open")}>Mở ca mới</Button>
                  )}
                </div>
              </div>
              {data.shift && (
                <div className="stats-grid grid grid-cols-4 gap-4 mb-6">
                  {[
                    ["Tiền đầu ca", data.shift.openingCash],
                    ["Doanh thu tiền mặt", data.shift.cashSales],
                    ["Doanh thu chuyển khoản", data.shift.transferSales],
                    [
                      "Tiền mặt dự kiến",
                      data.shift.openingCash + data.shift.cashSales,
                    ],
                  ].map(([title, value]) => (
                    <div className="panel" key={title}>
                      <p className="eyebrow mb-3">{title}</p>
                      <p className="text-xl font-semibold">
                        {money(Number(value))}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              <div className="panel table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Ca</th>
                      <th>Mở lúc</th>
                      <th>Nhân viên</th>
                      <th>Doanh thu</th>
                      <th>Thực đếm</th>
                      <th>Thiếu / thừa</th>
                      <th>Trạng thái</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.shifts.map((s) => (
                      <tr key={s._id}>
                        <td>#{s._id.slice(-6)}</td>
                        <td>{date(s.createdAt)}</td>
                        <td>
                          {typeof s.cashier === "object" ? s.cashier.name : "—"}
                        </td>
                        <td>{money(s.cashSales + s.transferSales)}</td>
                        <td>
                          {s.countedCash === undefined
                            ? "—"
                            : money(s.countedCash)}
                        </td>
                        <td>
                          {s.cashDifference === undefined
                            ? "—"
                            : money(s.cashDifference)}
                        </td>
                        <td>
                          <span className="tag">
                            {s.status === "open" ? "Đang mở" : "Đã chốt"}
                          </span>
                        </td>
                        <td>
                          <Button
                            variant="ghost"
                            onClick={() => setModal("shift:" + s._id)}
                          >
                            Chi tiết
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {tab === "Báo cáo" && manager && (
            <section>
              <div className="flex flex-wrap gap-3 justify-between items-end mb-5">
                <div>
                  <h2 className="text-lg font-semibold">Báo cáo doanh thu</h2>
                  <p className="muted text-xs mt-1">
                    Màn hình tổng hợp tối đa 200 giao dịch gần nhất. File xuất
                    lấy đầy đủ theo khoảng ngày.
                  </p>
                </div>
                <Button variant="outline" onClick={() => window.print()}>
                  In báo cáo
                </Button>
              </div>
              <div className="panel no-print flex flex-wrap items-end gap-4 mb-5">
                <Field title="Từ ngày">
                  <input
                    type="date"
                    value={reportFrom}
                    onChange={(e) => setReportFrom(e.target.value)}
                  />
                </Field>
                <Field title="Đến hết ngày">
                  <input
                    type="date"
                    value={reportTo}
                    onChange={(e) => setReportTo(e.target.value)}
                  />
                </Field>
                {["csv", "xlsx"].map((format) => (
                  <Button variant="outline" key={format} asChild>
                    <a
                      href={
                        "/api/reports?" +
                        new URLSearchParams({
                          format,
                          ...(reportFrom
                            ? { from: reportFrom + "T00:00:00+07:00" }
                            : {}),
                          ...(reportTo
                            ? {
                                to: new Date(
                                  new Date(
                                    reportTo + "T00:00:00+07:00",
                                  ).getTime() + 86400000,
                                ).toISOString(),
                              }
                            : {}),
                        })
                      }
                    >
                      <ArrowDownToLine size={15} />
                      {format.toUpperCase()}
                    </a>
                  </Button>
                ))}
              </div>
              {(() => {
                const ss = data.sales.filter(
                  (s) =>
                    (!reportFrom ||
                      new Date(s.createdAt) >=
                        new Date(reportFrom + "T00:00:00+07:00")) &&
                    (!reportTo ||
                      new Date(s.createdAt).getTime() <
                        new Date(reportTo + "T00:00:00+07:00").getTime() +
                          86400000),
                );
                const productTotals = new Map<string, number>(),
                  staffTotals = new Map<string, number>(),
                  dayTotals = new Map<string, number>();
                for (const s of ss) {
                  staffTotals.set(
                    s.employee?.name || "—",
                    (staffTotals.get(s.employee?.name || "—") || 0) + s.total,
                  );
                  const d = new Date(s.createdAt).toLocaleDateString("vi-VN", {
                    timeZone: "Asia/Ho_Chi_Minh",
                  });
                  dayTotals.set(d, (dayTotals.get(d) || 0) + s.total);
                  for (const l of s.lines)
                    productTotals.set(
                      l.name,
                      (productTotals.get(l.name) || 0) + l.subtotal,
                    );
                }
                return (
                  <>
                    <div className="stats-grid grid grid-cols-4 gap-4 mb-5">
                      {[
                        [
                          "Tổng doanh thu",
                          money(ss.reduce((n, s) => n + s.total, 0)),
                        ],
                        ["Tiền mặt", money(ss.reduce((n, s) => n + s.cash, 0))],
                        [
                          "Chuyển khoản",
                          money(ss.reduce((n, s) => n + s.transfer, 0)),
                        ],
                        [
                          "Lượt Social đã trả",
                          String(
                            ss
                              .flatMap((s) => s.lines)
                              .filter(
                                (l) =>
                                  data.products.find((p) => p.name === l.name)
                                    ?.kind === "social",
                              )
                              .reduce((n, l) => n + l.quantity, 0),
                          ),
                        ],
                      ].map(([t, v]) => (
                        <div className="panel" key={t}>
                          <p className="eyebrow mb-3">{t}</p>
                          <p className="text-xl font-semibold">{v}</p>
                        </div>
                      ))}
                    </div>
                    <div className="grid lg:grid-cols-3 gap-5">
                      {[
                        ["Theo sản phẩm", productTotals],
                        ["Theo nhân viên", staffTotals],
                        ["Theo ngày", dayTotals],
                      ].map(([title, map]) => (
                        <div key={String(title)} className="panel">
                          <h3 className="font-semibold mb-4">
                            {String(title)}
                          </h3>
                          {[...(map as Map<string, number>)].map(([n, v]) => (
                            <div
                              key={n}
                              className="flex justify-between py-3 border-b border-stone-100 text-xs gap-4"
                            >
                              <span>{n}</span>
                              <strong>{money(v)}</strong>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
            </section>
          )}
          {tab === "Thiết lập" && manager && (
            <section>
              <div className="panel mb-5">
                <h2 className="text-lg font-semibold mb-5">
                  Nhân viên & phân quyền
                </h2>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Nhân viên</th>
                        <th>Email</th>
                        <th>Vai trò</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.users.map((u) => (
                        <tr key={u._id}>
                          <td>{u.name}</td>
                          <td>{u.email}</td>
                          <td>{u.role}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {data.user.role === "Admin" && (
                  <Button className="mt-5" onClick={() => setModal("user")}>
                    <Plus size={15} />
                    Thêm nhân viên
                  </Button>
                )}
              </div>
              <div className="panel">
                <h2 className="font-semibold mb-4">Nhật ký thay đổi</h2>
                <p className="text-xs muted mb-3">
                  100 sự kiện gần nhất · Lưu người thao tác, thời gian và nội
                  dung
                </p>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Thời gian</th>
                        <th>Nhân viên</th>
                        <th>Thao tác</th>
                        <th>Chi tiết</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.audits.map((a) => (
                        <tr key={a._id}>
                          <td>{date(a.createdAt)}</td>
                          <td>{a.actor?.name}</td>
                          <td>{a.action}</td>
                          <td className="max-w-xs !whitespace-normal break-words text-[10px]">
                            {JSON.stringify(a.details)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}
        </div>
      </main>
      {modal && (
        <div
          className="dialog-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <section
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Thao tác quản lý"
          >
            <div className="flex justify-between items-center mb-5">
              <p className="eyebrow">COURTDESK · QUẢN LÝ</p>
              <button
                className="p-2"
                aria-label="Đóng"
                onClick={() => setModal(null)}
              >
                <X size={20} />
              </button>
            </div>
            {error && <p className="error mb-4">{error}</p>}
            {modal === "open" && (
              <form
                className="space-y-5"
                onSubmit={(e) =>
                  submit(e, "openShift", (f) => ({
                    openingCash: Number(f.get("openingCash")),
                  }))
                }
              >
                <h2 className="text-xl font-semibold">Mở ca bán hàng</h2>
                <p className="muted text-sm">
                  Tồn đầu ca lấy theo cấu hình sản phẩm (mặc định 24 chai mỗi
                  loại). Xác nhận số thực tế; quản lý điều chỉnh nếu có chênh
                  lệch.
                </p>
                <Field title="Tiền mặt đầu ca (đ)">
                  <Num name="openingCash" />
                </Field>
                <Button disabled={busy} className="w-full">
                  Xác nhận mở ca
                </Button>
              </form>
            )}
            {modal === "close" && data.shift && (
              <form
                className="space-y-4"
                onSubmit={(e) =>
                  submit(e, "closeShift", (f) => ({
                    shift: data.shift!._id,
                    countedCash: Number(f.get("countedCash")),
                    counts: data.stocks.map((s) => ({
                      product: s.product,
                      counted: Number(f.get(s.product)),
                    })),
                  }))
                }
              >
                <h2 className="text-xl font-semibold">Đối soát & chốt ca</h2>
                <p className="text-sm muted">
                  Tiền mặt dự kiến:{" "}
                  {money(data.shift.openingCash + data.shift.cashSales)}. Ca đã
                  chốt không thể sửa trực tiếp.
                </p>
                <Field title="Tiền mặt thực đếm (đ)">
                  <Num
                    name="countedCash"
                    defaultValue={data.shift.openingCash + data.shift.cashSales}
                  />
                </Field>
                <h3 className="font-semibold pt-2">Số chai thực đếm cuối ca</h3>
                {data.stocks.map((s) => (
                  <Field
                    key={s.product}
                    title={
                      (data.products.find((p) => p._id === s.product)?.name ||
                        s.product) +
                      " · dự kiến " +
                      s.remaining
                    }
                  >
                    <Num name={s.product} defaultValue={s.remaining} />
                  </Field>
                ))}
                <Button disabled={busy} className="w-full">
                  Xác nhận chốt ca
                </Button>
              </form>
            )}
            {modal === "stock" && (
              <form
                className="space-y-4"
                onSubmit={(e) =>
                  submit(e, "stock", (f) => ({
                    shift: data.shift!._id,
                    product: f.get("product"),
                    mode: f.get("mode"),
                    quantity: Number(f.get("quantity")),
                    reason: f.get("reason"),
                  }))
                }
              >
                <h2 className="text-xl font-semibold">Nhập / điều chỉnh kho</h2>
                <Field title="Sản phẩm">
                  <select name="product" required>
                    {data.stocks.map((s) => (
                      <option value={s.product} key={s.product}>
                        {data.products.find((p) => p._id === s.product)?.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field title="Loại thao tác">
                  <select name="mode">
                    <option value="restock">Nhập bổ sung</option>
                    <option value="adjust">
                      Điều chỉnh chênh lệch (+ / −)
                    </option>
                  </select>
                </Field>
                <Field title="Số lượng thay đổi">
                  <Num name="quantity" defaultValue={1} min={-100000} />
                </Field>
                <Field title="Lý do">
                  <input name="reason" required minLength={3} />
                </Field>
                <Button disabled={busy}>Lưu thay đổi</Button>
              </form>
            )}
            {modal === "social" && (
              <form
                className="space-y-4"
                onSubmit={(e) =>
                  submit(e, "social", (f) => ({
                    shift: data.shift!._id,
                    name: f.get("name"),
                    period: f.get("period"),
                  }))
                }
              >
                <h2 className="text-xl font-semibold">Khách tham gia Social</h2>
                <Field title="Tên khách">
                  <input name="name" required maxLength={100} />
                </Field>
                <Field title="Buổi tham gia">
                  <select name="period">
                    <option value="morning">Sáng · 30.000đ</option>
                    <option value="evening">Tối · 50.000đ</option>
                  </select>
                </Field>
                <p className="muted text-xs">
                  Khách được ghi nhận chưa thanh toán. Chọn Thu tiền để chuyển
                  sang POS.
                </p>
                <Button disabled={busy}>Ghi nhận tham gia</Button>
              </form>
            )}
            {modal === "handover" && (
              <form
                className="space-y-4"
                onSubmit={(e) =>
                  submit(e, "handover", (f) => ({
                    shift: data.shift!._id,
                    cashier: f.get("cashier"),
                    note: f.get("note"),
                  }))
                }
              >
                <h2 className="text-xl font-semibold">Bàn giao ca</h2>
                <Field title="Nhân viên nhận ca">
                  <select name="cashier">
                    {data.users.map((u) => (
                      <option key={u._id} value={u._id}>
                        {u.name} · {u.role}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field title="Ghi chú bàn giao">
                  <input name="note" required />
                </Field>
                <p className="text-xs muted">
                  Giữ nguyên ca, lịch sử tiền và kho. Người nhận tiếp tục bán
                  trên ca này.
                </p>
                <Button disabled={busy}>Xác nhận bàn giao</Button>
              </form>
            )}
            {modal === "product" && (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  let variants;
                  try {
                    variants = String(f.get("variants"))
                      .split("\n")
                      .filter(Boolean)
                      .map((line) => {
                        const at = line.lastIndexOf("|");
                        if (at < 1) throw new Error();
                        return {
                          name: line.slice(0, at).trim(),
                          price: Number(line.slice(at + 1).trim()),
                        };
                      });
                  } catch {
                    setError("Mỗi dòng tùy chọn có dạng Tên | Giá");
                    return;
                  }
                  void run("product", {
                    ...(editing ? { id: editing._id } : {}),
                    data: {
                      name: f.get("name"),
                      category: f.get("category"),
                      kind: f.get("kind"),
                      defaultStock: Number(f.get("defaultStock")),
                      active: f.get("active") === "true",
                      variants,
                    },
                  });
                }}
              >
                <h2 className="text-xl font-semibold">
                  {editing ? "Sửa" : "Thêm"} sản phẩm
                </h2>
                <Field title="Tên sản phẩm">
                  <input name="name" required defaultValue={editing?.name} />
                </Field>
                <div className="grid-form">
                  <Field title="Danh mục">
                    <select
                      name="category"
                      defaultValue={editing?.category}
                      required
                    >
                      {data.categories
                        .filter((c) => c.active)
                        .map((c) => (
                          <option key={c._id}>{c.name}</option>
                        ))}
                    </select>
                  </Field>
                  <Field title="Loại">
                    <select
                      name="kind"
                      defaultValue={editing?.kind || "bottle"}
                    >
                      <option value="bottle">Nước đóng chai</option>
                      <option value="prepared">Đồ uống pha chế</option>
                      <option value="social">Vé Social</option>
                      <option value="other">Sản phẩm khác</option>
                    </select>
                  </Field>
                </div>
                <Field title="Tùy chọn và giá · mỗi dòng: Tên | Giá (đ)">
                  <textarea
                    name="variants"
                    rows={4}
                    required
                    defaultValue={
                      editing?.variants
                        .map((v) => v.name + " | " + v.price)
                        .join("\n") || "Không đá | 15000\nCó đá | 20000"
                    }
                  />
                </Field>
                <p className="text-xs muted">
                  Vé Social dùng tên tùy chọn Sáng / Tối.
                </p>
                <div className="grid-form">
                  <Field title="Tồn mặc định mỗi ca (chỉ loại chai)">
                    <Num
                      name="defaultStock"
                      defaultValue={editing?.defaultStock ?? 24}
                    />
                  </Field>
                  <Field title="Trạng thái">
                    <select
                      name="active"
                      defaultValue={String(editing?.active ?? true)}
                    >
                      <option value="true">Đang bán</option>
                      <option value="false">Ngừng bán</option>
                    </select>
                  </Field>
                </div>
                <Button disabled={busy}>Lưu sản phẩm</Button>
              </form>
            )}
            {modal.startsWith("category") &&
              (() => {
                const c = data.categories.find(
                  (c) => modal === "category:" + c._id,
                );
                return (
                  <form
                    className="space-y-4"
                    onSubmit={(e) =>
                      submit(e, "category", (f) => ({
                        ...(c ? { id: c._id } : {}),
                        name: f.get("name"),
                        active: f.get("active") === "true",
                      }))
                    }
                  >
                    <h2 className="text-xl font-semibold">
                      {c ? "Sửa" : "Thêm"} danh mục
                    </h2>
                    <Field title="Tên danh mục">
                      <input name="name" defaultValue={c?.name} required />
                    </Field>
                    <Field title="Trạng thái">
                      <select
                        name="active"
                        defaultValue={String(c?.active ?? true)}
                      >
                        <option value="true">Hoạt động</option>
                        <option value="false">Ẩn danh mục</option>
                      </select>
                    </Field>
                    <Button disabled={busy}>Lưu danh mục</Button>
                  </form>
                );
              })()}
            {modal === "user" && (
              <form
                className="space-y-4"
                onSubmit={(e) =>
                  submit(e, "user", (f) => Object.fromEntries(f))
                }
              >
                <h2 className="text-xl font-semibold">Thêm nhân viên</h2>
                <Field title="Họ tên">
                  <input name="name" required />
                </Field>
                <Field title="Email">
                  <input name="email" type="email" required />
                </Field>
                <Field title="Mật khẩu (tối thiểu 12 ký tự)">
                  <input
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    required
                  />
                </Field>
                <Field title="Vai trò">
                  <select name="role">
                    <option>Cashier</option>
                    <option>Manager</option>
                    <option>Admin</option>
                  </select>
                </Field>
                <Button disabled={busy}>Tạo tài khoản</Button>
              </form>
            )}
            {modal.startsWith("shift:") &&
              (() => {
                const s = data.shifts.find((s) => "shift:" + s._id === modal)!;
                return (
                  <div className="space-y-4">
                    <h2 className="text-xl font-semibold">
                      Báo cáo ca #{s._id.slice(-6)}
                    </h2>
                    <p>
                      Mở lúc: {date(s.createdAt)} ·{" "}
                      {s.status === "closed" ? "Đã chốt" : "Đang mở"}
                    </p>
                    {[
                      ["Tiền mặt đầu ca", s.openingCash],
                      ["Doanh thu tiền mặt", s.cashSales],
                      ["Doanh thu chuyển khoản", s.transferSales],
                      ["Tiền dự kiến", s.openingCash + s.cashSales],
                      ["Tiền thực đếm", s.countedCash],
                      ["Thừa / thiếu", s.cashDifference],
                    ].map(([t, v]) => (
                      <div
                        className="flex justify-between border-b border-stone-100 pb-2"
                        key={t}
                      >
                        <span>{t}</span>
                        <strong>
                          {v === undefined ? "—" : money(Number(v))}
                        </strong>
                      </div>
                    ))}
                    {s.stockSnapshot?.map((st) => (
                      <div key={st.product} className="text-xs">
                        <strong>
                          {data.products.find((p) => p._id === st.product)
                            ?.name || st.product}
                        </strong>
                        <p className="muted mt-1">
                          Đầu {st.opening} · Nhập {st.added} · Bán {st.sold} ·
                          Điều chỉnh {st.adjustment} · Dự kiến {st.remaining} ·
                          Đếm {st.counted} · Lệch {st.difference}
                        </p>
                      </div>
                    ))}
                    <div className="no-print flex gap-2">
                      <Button onClick={() => window.print()}>In chốt ca</Button>
                      {manager && (
                        <Button variant="outline" asChild>
                          <a href={"/api/reports?format=xlsx&shift=" + s._id}>
                            Xuất Excel
                          </a>
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })()}
          </section>
        </div>
      )}
    </>
  );
}
