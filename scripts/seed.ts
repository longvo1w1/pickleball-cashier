import mongoose from "mongoose";
import { hash } from "bcryptjs";
import { z } from "zod";
import { db } from "../src/lib/db";
import { Audit, Category, Product, User, indexes } from "../src/lib/models";
async function main() {
  if (process.env.ALLOW_SEED !== "true")
    throw new Error("Set ALLOW_SEED=true explicitly");
  const email = z.email().parse(process.env.SEED_ADMIN_EMAIL).toLowerCase();
  const password = z.string().min(12).parse(process.env.SEED_ADMIN_PASSWORD);
  await db();
  await indexes();
  await mongoose.connection.transaction(async (session) => {
    let admin = await User.findOne({ email }).session(session);
    if (!admin) {
      [admin] = await User.create(
        [
          {
            name: "Quản trị viên",
            email,
            passwordHash: await hash(password, 12),
            role: "Admin",
          },
        ],
        { session },
      );
    }
    for (const name of ["Nước đóng chai", "Đồ uống pha chế", "Vé Social"])
      await Category.updateOne(
        { name },
        { $setOnInsert: { name } },
        { upsert: true, session },
      );
    const products = [
      ...["Revive Pro", "Revive Trắng", "Revive Chanh Muối"].map((name) => ({
        name,
        category: "Nước đóng chai",
        kind: "bottle",
        defaultStock: 24,
        variants: [
          { name: "Không đá", price: 15000 },
          { name: "Có đá", price: 20000 },
        ],
      })),
      {
        name: "Nước suối",
        category: "Nước đóng chai",
        kind: "bottle",
        defaultStock: 24,
        variants: [{ name: "Chai", price: 10000 }],
      },
      {
        name: "Trà đá",
        category: "Đồ uống pha chế",
        kind: "prepared",
        defaultStock: 0,
        variants: [{ name: "Ly", price: 10000 }],
      },
      {
        name: "Vé Social",
        category: "Vé Social",
        kind: "social",
        defaultStock: 0,
        variants: [
          { name: "Sáng", price: 30000 },
          { name: "Tối", price: 50000 },
        ],
      },
    ];
    for (const p of products)
      await Product.updateOne(
        { name: p.name },
        { $setOnInsert: p },
        { upsert: true, session },
      );
    await Audit.create(
      [
        {
          actor: admin._id,
          action: "catalog.seed",
          details: { products: products.length },
        },
      ],
      { session },
    );
  });
  console.log("Seed catalog/admin complete; no shifts or sales created.");
  await mongoose.disconnect();
}
main().catch((e) => {
  console.error(
    e.name === "ZodError" ? "Invalid seed configuration" : e.message,
  );
  process.exit(1);
});
