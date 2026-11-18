import fs from "node:fs";
import { execFileSync } from "node:child_process";
const local = [".env.local", ".env.production.local"]
  .filter((f) => fs.existsSync(f))
  .map((f) => fs.readFileSync(f, "utf8"))
  .join("\n");
const values = local
  .split(/\r?\n/)
  .filter((l) =>
    /^(MONGODB_URI|SESSION_SECRET|SEED_ADMIN_PASSWORD|VERCEL_OIDC_TOKEN)=/.test(
      l,
    ),
  )
  .map((l) => l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, ""));
const uri = values.find((v) => v.startsWith("mongodb"));
if (uri) {
  const u = new URL(uri);
  values.push(decodeURIComponent(u.password));
}
const files = execFileSync(
  "git",
  ["diff", "--cached", "--name-only", "--diff-filter=ACM"],
  { encoding: "utf8" },
)
  .trim()
  .split(/\r?\n/)
  .filter(Boolean);
for (const file of files) {
  const content = execFileSync("git", ["show", ":" + file], {
    encoding: "utf8",
    maxBuffer: 20_000_000,
  });
  if (values.some((v) => v.length > 12 && content.includes(v)))
    throw new Error("Secret detected in staged file: " + file);
  if (
    /^\.env(?!\.example$)/.test(file) ||
    file.startsWith(".vercel/") ||
    file.startsWith(".cache/")
  )
    throw new Error("Private file staged: " + file);
}
console.log(
  "PASS staged secrets check:",
  files.length,
  "files; local secret values excluded.",
);
