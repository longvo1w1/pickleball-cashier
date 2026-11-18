/** Full HTTP checks against a disposable replica set. Never uses .env.local/Atlas. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { hash } from "bcryptjs";
import ExcelJS from "exceljs";
import {
  Audit,
  Category,
  Product,
  Sale,
  Shift,
  Social,
  Stock,
  User,
  indexes,
} from "../src/lib/models";
const origin = "http://localhost:3101";
async function main() {
  const repl = await MongoMemoryReplSet.create({
    binary: { version: "7.0.14" },
    replSet: { count: 1 },
  });
  let server: ReturnType<typeof spawn> | undefined;
  const passed: string[] = [];
  const check = (name: string) => {
    passed.push(name);
    console.log("PASS", name);
  };
  try {
    await mongoose.connect(repl.getUri("http_smoke_disposable"));
    await indexes();
    const password = "HTTP-test-only-password-24";
    const passwordHash = await hash(password, 12);
    await User.create([
      {
        name: "Admin Test",
        email: "admin@test.local",
        passwordHash,
        role: "Admin",
      },
      {
        name: "Cashier Test",
        email: "cashier@test.local",
        passwordHash,
        role: "Cashier",
      },
    ]);
    await Category.create({ name: "Drinks" });
    const p = await Product.create({
      name: "Revive",
      category: "Drinks",
      kind: "bottle",
      defaultStock: 24,
      variants: [
        { name: "Không đá", price: 15000 },
        { name: "Có đá", price: 20000 },
      ],
    });
    const social = await Product.create({
      name: "Social",
      category: "Drinks",
      kind: "social",
      defaultStock: 0,
      variants: [
        { name: "Sáng", price: 30000 },
        { name: "Tối", price: 50000 },
      ],
    });
    server = spawn(
      process.execPath,
      ["node_modules/next/dist/bin/next", "start", "--port", "3101"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          MONGODB_URI: repl.getUri("http_smoke_disposable"),
          SESSION_SECRET: "http-smoke-only-secret-at-least-32-characters",
          APP_ORIGIN: origin,
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let stderr = "";
    server.stderr?.on("data", (c) => {
      stderr += String(c);
    });
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try {
        if ((await fetch(origin)).ok) {
          ready = true;
          break;
        }
      } catch {}
      await delay(250);
    }
    assert.ok(ready, "Next server readiness " + stderr);
    const request = (
      path: string,
      cookie = "",
      body?: unknown,
      overrideOrigin = origin,
    ) =>
      fetch(origin + path, {
        method: body ? "POST" : "GET",
        headers: {
          "Content-Type": "application/json",
          Origin: overrideOrigin,
          ...(cookie ? { Cookie: cookie } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const login = async (email: string) => {
      const r = await request("/api/auth", "", { email, password });
      assert.equal(r.status, 200);
      assert.match(r.headers.get("set-cookie") || "", /HttpOnly/i);
      return r.headers.get("set-cookie")!.split(";")[0];
    };
    assert.equal((await request("/api/workspace")).status, 401);
    check("Unauthenticated API denied");
    assert.equal(
      (
        await request(
          "/api/auth",
          "",
          { email: "admin@test.local", password },
          "https://untrusted.test",
        )
      ).status,
      403,
    );
    check("Cross-origin mutation denied");
    const admin = await login("admin@test.local"),
      cashier = await login("cashier@test.local");
    check("Admin and cashier login with HttpOnly session");
    assert.equal((await request("/api/reports", cashier)).status, 403);
    assert.equal(
      (
        await request("/api/workspace", cashier, {
          action: "category",
          data: { name: "Forbidden", active: true },
        })
      ).status,
      403,
    );
    check("Cashier management/report authorization");
    let r = await request("/api/workspace", cashier, {
      action: "openShift",
      data: { openingCash: 100000 },
    });
    assert.equal(r.status, 200);
    const shift = await r.json();
    assert.equal((await Stock.findOne()).remaining, 24);
    check("Open shift initializes inventory");
    const data = {
      key: crypto.randomUUID(),
      shift: shift._id,
      lines: [{ product: String(p._id), variant: "Có đá", quantity: 2 }],
      cash: 10000,
      transfer: 30000,
    };
    r = await request("/api/workspace", cashier, { action: "checkout", data });
    assert.equal(r.status, 200);
    const sale = await r.json();
    assert.equal(sale.total, 40000);
    r = await request("/api/workspace", cashier, { action: "checkout", data });
    assert.equal((await r.json())._id, sale._id);
    assert.equal(await Sale.countDocuments(), 1);
    check("Split payment and HTTP retry idempotency");
    r = await request("/api/workspace", cashier, {
      action: "social",
      data: { shift: shift._id, name: "Social Test", period: "morning" },
    });
    assert.equal(r.status, 200);
    const guest = await r.json();
    r = await request("/api/workspace", cashier, {
      action: "checkout",
      data: {
        key: crypto.randomUUID(),
        shift: shift._id,
        lines: [
          {
            product: String(social._id),
            variant: "Sáng",
            quantity: 1,
            socialIds: [guest._id],
          },
        ],
        cash: 30000,
        transfer: 0,
      },
    });
    assert.equal(r.status, 200);
    assert.equal((await Social.findById(guest._id)).paid, true);
    check("Social registration and collection");
    r = await request("/api/workspace", admin, {
      action: "stock",
      data: {
        shift: shift._id,
        product: String(p._id),
        mode: "restock",
        quantity: 3,
        reason: "HTTP smoke replenishment",
      },
    });
    assert.equal(r.status, 200);
    check("Manager stock adjustment and audit");
    r = await request("/api/workspace", cashier);
    assert.equal(r.status, 200);
    const workspace = await r.json();
    assert.equal(workspace.user.role, "Cashier");
    assert.equal(workspace.users.length, 0);
    assert.equal(workspace.audits.length, 0);
    assert.equal(workspace.sales.length, 2);
    check("Workspace restricts management data");
    r = await request("/api/reports?format=csv&shift=" + shift._id, admin);
    assert.equal(r.status, 200);
    const csv = await r.text();
    assert.ok(
      csv.includes("Revive") &&
        csv.includes("Social Test") === false &&
        csv.includes("70000"),
    );
    check("CSV shift report includes reconciled revenue");
    r = await request("/api/reports?format=xlsx&shift=" + shift._id, admin);
    assert.equal(r.status, 200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(
      Buffer.from(await r.arrayBuffer()) as unknown as Parameters<
        typeof wb.xlsx.load
      >[0],
    );
    assert.ok(wb.worksheets[0].rowCount > 10);
    check("Excel report parses successfully");
    r = await request("/api/workspace", cashier, {
      action: "closeShift",
      data: {
        shift: shift._id,
        countedCash: 138000,
        counts: [{ product: String(p._id), counted: 24 }],
      },
    });
    assert.equal(r.status, 200);
    const closed = await r.json();
    assert.equal(closed.cashDifference, -2000);
    assert.equal(closed.stockSnapshot[0].difference, -1);
    check("Shift close records cash and stock discrepancy");
    r = await request("/api/workspace", cashier, {
      action: "checkout",
      data: { ...data, key: crypto.randomUUID() },
    });
    assert.equal(r.status, 409);
    assert.equal(await Sale.countDocuments(), 2);
    check("Closed shift blocks new sales");
    assert.ok(await Audit.countDocuments({ action: "shift.close" }));
    assert.equal((await Shift.findById(shift._id)).status, "closed");
    check("Audit trail persisted");
    console.log(
      `HTTP_SMOKE_RESULT ${passed.length}/${passed.length} PASS; disposable database only.`,
    );
  } finally {
    if (server) {
      server.kill();
      await delay(800);
    }
    await mongoose.disconnect();
    await repl.stop();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
