import fs from "node:fs";
import crypto from "node:crypto";
const target = ".env.local";
if (!fs.existsSync(target))
  throw new Error(
    "Copy .env.example to .env.local and configure MONGODB_URI first.",
  );
let content = fs.readFileSync(target, "utf8");
const defaults = {
  SESSION_SECRET: crypto.randomBytes(48).toString("hex"),
  SEED_ADMIN_EMAIL: "admin@courtdesk.local",
  SEED_ADMIN_PASSWORD: crypto.randomBytes(24).toString("base64url"),
};
for (const [key, value] of Object.entries(defaults))
  if (!new RegExp("^" + key + "=", "m").test(content))
    content += "\n" + key + "=" + value + "\n";
fs.writeFileSync(target, content);
console.log(
  "Local configuration ready in ignored .env.local. Secrets are not printed.",
);
