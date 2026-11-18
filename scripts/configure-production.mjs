// Prepares an ignored local secret file; does not connect to any database.
import fs from "node:fs";
import crypto from "node:crypto";
if (fs.existsSync(".env.production.local"))
  throw new Error(
    "Production local config already exists; review it instead of overwriting secrets.",
  );
const uri = new URL(process.env.MONGODB_URI);
if (uri.pathname !== "/pickleball_cashier_preview")
  throw new Error("Expected the dedicated application Preview URI");
uri.pathname = "/pickleball_cashier_production";
const vars = {
  MONGODB_URI: uri.toString(),
  SESSION_SECRET: crypto.randomBytes(48).toString("hex"),
  APP_ORIGIN: "https://pickleball-cashier.vercel.app",
  ALLOW_SEED: "false",
  SEED_ADMIN_EMAIL: "admin@courtdesk.local",
  SEED_ADMIN_PASSWORD: crypto.randomBytes(24).toString("base64url"),
};
fs.writeFileSync(
  ".env.production.local",
  Object.entries(vars)
    .map(([k, v]) => k + "=" + v)
    .join("\n") + "\n",
  { flag: "wx" },
);
console.log(
  "Prepared ignored .env.production.local with separate database and fresh credentials. No remote changes performed.",
);
