// Explicitly disposable QA fixtures on the dedicated Preview database only.
// Never run against Production. Shared helper first performs read-only Preview checks.
import { request } from "./check-preview.mjs";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { hash } from "bcryptjs";
import { User, Shift, Stock, Sale, Social, Audit } from "../src/lib/models.ts";
if (process.exitCode) process.exit(process.exitCode);
assert.equal(
  new URL(process.env.MONGODB_URI).pathname,
  "/pickleball_cashier_preview",
  "Only the dedicated Preview database is permitted",
);
let checks = 0,
  qa,
  shift;
let adminId;
const pass = (n) => {
  checks++;
  console.log("PASS Preview workflow:", n);
};
const json = (r) => JSON.parse(r.body.toString());
async function login(email, password) {
  const r = await request("/api/auth", { email, password });
  assert.equal(r.status, 200);
  return r.headers.match(/^set-cookie:\s*(session=[^;\r\n]+)/im)[1];
}
async function action(cookie, action, data, status = 200) {
  const r = await request("/api/workspace", { action, data }, cookie);
  assert.equal(r.status, status, `action ${action}: ${r.body.toString()}`);
  return json(r);
}
try {
  const admin = await login(
    process.env.SEED_ADMIN_EMAIL,
    process.env.SEED_ADMIN_PASSWORD,
  );
  let workspace = json(await request("/api/workspace", undefined, admin));
  assert.equal(
    workspace.shifts.length,
    0,
    "Preview must be unused before disposable QA",
  );
  adminId = workspace.user._id;
  const email = "qa.preview." + Date.now() + "@example.com",
    password = crypto.randomBytes(24).toString("base64url");
  await mongoose.connect(process.env.MONGODB_URI);
  qa = await User.create({
    name: "QA PREVIEW — disposable",
    email,
    passwordHash: await hash(password, 12),
    role: "Cashier",
  });
  const cashier = await login(email, password);
  pass("disposable cashier authentication");
  shift = await action(cashier, "openShift", { openingCash: 100000 });
  workspace = json(await request("/api/workspace", undefined, cashier));
  const product = workspace.products.find((p) => p.name === "Revive Pro");
  const social = workspace.products.find((p) => p.kind === "social");
  const tea = workspace.products.find((p) => p.name === "Trà đá");
  assert.equal(
    workspace.stocks.find((s) => s.product === product._id).remaining,
    24,
  );
  pass("open shift and 24-bottle initialization");
  const order = {
    key: crypto.randomUUID(),
    shift: shift._id,
    lines: [{ product: product._id, variant: "Có đá", quantity: 2 }],
    cash: 15000,
    transfer: 25000,
  };
  const sale = await action(cashier, "checkout", order);
  const retry = await action(cashier, "checkout", order);
  assert.equal(sale._id, retry._id);
  assert.equal(sale.total, 40000);
  pass("split payment and idempotent HTTP retry");
  await action(admin, "stock", {
    shift: shift._id,
    product: product._id,
    mode: "adjust",
    quantity: -21,
    reason: "QA PREVIEW last-bottle concurrency fixture",
  });
  const last = () =>
    request(
      "/api/workspace",
      {
        action: "checkout",
        data: {
          key: crypto.randomUUID(),
          shift: shift._id,
          lines: [{ product: product._id, variant: "Không đá", quantity: 1 }],
          cash: 15000,
          transfer: 0,
        },
      },
      cashier,
    );
  const concurrent = await Promise.all([last(), last()]);
  assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
  pass("Atlas concurrent checkout cannot oversell the last bottle");
  const guest = await action(cashier, "social", {
    shift: shift._id,
    name: "QA PREVIEW disposable Social guest",
    period: "morning",
  });
  await action(cashier, "checkout", {
    key: crypto.randomUUID(),
    shift: shift._id,
    lines: [
      {
        product: social._id,
        variant: "Sáng",
        quantity: 1,
        socialIds: [guest._id],
      },
    ],
    cash: 0,
    transfer: 30000,
  });
  pass("Social guest collection");
  await action(cashier, "checkout", {
    key: crypto.randomUUID(),
    shift: shift._id,
    lines: [{ product: tea._id, variant: "Ly", quantity: 1 }],
    cash: 10000,
    transfer: 0,
  });
  await action(admin, "stock", {
    shift: shift._id,
    product: product._id,
    mode: "restock",
    quantity: 2,
    reason: "QA PREVIEW replenishment",
  });
  workspace = json(await request("/api/workspace", undefined, cashier));
  assert.equal(
    workspace.stocks.find((s) => s.product === product._id).remaining,
    2,
  );
  assert.equal(
    workspace.stocks.some((s) => s.product === tea._id),
    false,
  );
  pass("prepared drinks and stock replenishment");
  await action(
    cashier,
    "stock",
    {
      shift: shift._id,
      product: product._id,
      mode: "restock",
      quantity: 1,
      reason: "Forbidden QA operation",
    },
    403,
  );
  assert.equal((await request("/api/reports", undefined, cashier)).status, 403);
  pass("cashier RBAC on deployed API");
  const closed = await action(cashier, "closeShift", {
    shift: shift._id,
    countedCash: 139000,
    counts: workspace.stocks.map((s) => ({
      product: s.product,
      counted: s.product === product._id ? 1 : s.remaining,
    })),
  });
  assert.equal(closed.cashDifference, -1000);
  assert.equal(
    closed.stockSnapshot.find((s) => s.product === product._id).difference,
    -1,
  );
  await action(
    cashier,
    "checkout",
    { ...order, key: crypto.randomUUID() },
    409,
  );
  pass("cash/stock reconciliation and closed-shift immutability");
  const report = await request(
    "/api/reports?format=csv&shift=" + shift._id,
    undefined,
    admin,
  );
  assert.equal(report.status, 200);
  assert.ok(report.body.toString().includes("95000"));
  pass("shift report matches 95,000 VND test revenue");
  console.log(`PREVIEW_WORKFLOW_RESULT ${checks}/${checks} PASS.`);
} catch (e) {
  console.error("Preview workflow FAIL:", e.message);
  process.exitCode = 1;
} finally {
  try {
    if (qa) {
      await mongoose.connect(process.env.MONGODB_URI);
      await mongoose.connection.transaction(async (session) => {
        const fixture = await User.findOne({
          _id: qa._id,
          name: "QA PREVIEW — disposable",
        }).session(session);
        assert.ok(fixture, "QA fixture ownership");
        if (shift) {
          assert.equal(
            await Sale.countDocuments({
              shift: shift._id,
              employee: { $ne: qa._id },
            }).session(session),
            0,
            "Refuse cleanup if another employee touched QA shift",
          );
          await Sale.deleteMany(
            { shift: shift._id, employee: qa._id },
            { session },
          );
          await Social.deleteMany({ shift: shift._id }, { session });
          await Stock.deleteMany({ shift: shift._id }, { session });
          await Shift.deleteOne(
            { _id: shift._id, openedBy: qa._id },
            { session },
          );
        }
        await Audit.deleteMany(
          {
            $or: [
              { actor: qa._id },
              { action: "user.create", entity: String(qa._id) },
              ...(shift
                ? [{ actor: adminId, "details.shift": String(shift._id) }]
                : []),
            ],
          },
          { session },
        );
        await User.deleteOne(
          { _id: qa._id, name: "QA PREVIEW — disposable" },
          { session },
        );
        await Audit.create(
          [
            {
              actor: adminId,
              action: "preview.qa.completed",
              details: {
                checks,
                success: !process.exitCode,
                disposableFixturesRemoved: true,
              },
            },
          ],
          { session },
        );
      });
      assert.equal(await Sale.countDocuments(), 0);
      assert.equal(await Shift.countDocuments(), 0);
      console.log(
        "PASS Preview QA cleanup: only disposable fixtures removed; no sales/shifts remain.",
      );
    }
  } catch (e) {
    console.error("Preview fixture cleanup FAIL:", e.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
