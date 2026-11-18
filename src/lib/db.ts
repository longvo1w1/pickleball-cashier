import mongoose from "mongoose";
let pending: Promise<typeof mongoose> | undefined;
export async function db() {
  if (!process.env.MONGODB_URI) throw new Error("Chưa cấu hình MongoDB Atlas");
  if (!pending)
    pending = mongoose
      .connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 })
      .catch((e) => {
        pending = undefined;
        throw e;
      });
  return pending;
}
