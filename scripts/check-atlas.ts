import mongoose from "mongoose";
import { db } from "../src/lib/db";
async function main() {
  await db();
  await mongoose.connection.db!.admin().ping();
  console.log(
    "Atlas connection PASS. Selected database:",
    mongoose.connection.name,
  );
  await mongoose.disconnect();
}
main().catch(async () => {
  console.error(
    "Atlas connection FAIL. Check network access list, database user permissions, URI and DNS.",
  );
  await mongoose.disconnect();
  process.exitCode = 1;
});
