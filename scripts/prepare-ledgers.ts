// Additive schema/index preparation only; does not modify existing business documents.
import mongoose from "mongoose";
import { db } from "../src/lib/db";
import { indexes } from "../src/lib/models";
async function main() {
  await db();
  await indexes();
  console.log(
    "Ledger indexes ready in database:",
    mongoose.connection.name,
    "; no business records modified.",
  );
  await mongoose.disconnect();
}
main().catch(async () => {
  console.error("Ledger index preparation failed; check database permissions.");
  await mongoose.disconnect();
  process.exitCode = 1;
});
