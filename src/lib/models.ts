import mongoose, { Schema } from "mongoose";
const opts = { timestamps: true, strict: "throw" as const };
const userSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: ["Admin", "Manager", "Cashier"],
      required: true,
    },
    active: { type: Boolean, default: true },
  },
  opts,
);
const categorySchema = new Schema(
  {
    name: { type: String, required: true, unique: true },
    active: { type: Boolean, default: true },
  },
  opts,
);
const productSchema = new Schema(
  {
    name: { type: String, required: true },
    category: { type: String, required: true },
    kind: {
      type: String,
      enum: ["bottle", "prepared", "social", "other"],
      required: true,
    },
    variants: [
      {
        _id: false,
        name: { type: String, required: true },
        price: { type: Number, required: true, min: 0 },
      },
    ],
    defaultStock: { type: Number, default: 24, min: 0 },
    active: { type: Boolean, default: true },
  },
  opts,
);
const shiftSchema = new Schema(
  {
    status: { type: String, enum: ["open", "closed"], default: "open" },
    singleton: { type: String, default: "club" },
    openedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    cashier: { type: Schema.Types.ObjectId, ref: "User", required: true },
    cashierName: String,
    openedByName: String,
    participants: [{ type: Schema.Types.ObjectId, ref: "User" }],
    handovers: [
      {
        _id: false,
        at: Date,
        actor: { type: Schema.Types.ObjectId, ref: "User" },
        from: { type: Schema.Types.ObjectId, ref: "User" },
        to: { type: Schema.Types.ObjectId, ref: "User" },
        fromName: String,
        toName: String,
        note: String,
      },
    ],
    closingNote: String,
    openingCash: { type: Number, required: true },
    cashSales: { type: Number, default: 0 },
    transferSales: { type: Number, default: 0 },
    revision: { type: Number, default: 0 },
    countedCash: Number,
    cashDifference: Number,
    closedBy: { type: Schema.Types.ObjectId, ref: "User" },
    closedAt: Date,
    stockSnapshot: { type: Schema.Types.Mixed },
  },
  opts,
);
shiftSchema.index(
  { singleton: 1 },
  { unique: true, partialFilterExpression: { status: "open" } },
);
const stockSchema = new Schema(
  {
    shift: { type: Schema.Types.ObjectId, required: true },
    product: { type: Schema.Types.ObjectId, required: true },
    name: String,
    opening: { type: Number, required: true },
    added: { type: Number, default: 0 },
    sold: { type: Number, default: 0 },
    returned: { type: Number, default: 0 },
    adjustmentIn: { type: Number, default: 0 },
    adjustmentOut: { type: Number, default: 0 },
    adjustment: { type: Number, default: 0 },
    remaining: { type: Number, required: true, min: 0 },
    counted: Number,
    difference: Number,
  },
  opts,
);
stockSchema.index({ shift: 1, product: 1 }, { unique: true });
const saleSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    fingerprint: { type: String, required: true },
    shift: { type: Schema.Types.ObjectId, required: true },
    employee: { type: Schema.Types.ObjectId, ref: "User", required: true },
    lines: { type: Schema.Types.Mixed, required: true },
    total: { type: Number, required: true },
    cash: { type: Number, required: true },
    transfer: { type: Number, required: true },
    status: {
      type: String,
      enum: ["paid", "refunded", "cancelled"],
      default: "paid",
    },
  },
  opts,
);
const socialSchema = new Schema(
  {
    name: { type: String, required: true },
    period: { type: String, enum: ["morning", "evening"], required: true },
    joinedAt: { type: Date, default: Date.now },
    shift: { type: Schema.Types.ObjectId, required: true },
    paid: { type: Boolean, default: false },
    sale: { type: Schema.Types.ObjectId },
    lineIndex: Number,
    ticketPrice: Number,
    cash: Number,
    transfer: Number,
    paymentStatus: {
      type: String,
      enum: ["paid", "unpaid", "refunded", "cancelled"],
      default: "unpaid",
    },
  },
  opts,
);
const auditSchema = new Schema(
  {
    actor: { type: Schema.Types.ObjectId, required: true },
    action: { type: String, required: true },
    entity: String,
    shift: { type: Schema.Types.ObjectId, index: true },
    details: Schema.Types.Mixed,
  },
  opts,
);
const attemptSchema = new Schema(
  {
    key: { type: String, unique: true, required: true },
    count: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  opts,
);
attemptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const reversalSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    fingerprint: { type: String, required: true },
    sale: { type: Schema.Types.ObjectId, required: true, unique: true },
    shift: { type: Schema.Types.ObjectId, required: true, index: true },
    actor: { type: Schema.Types.ObjectId, ref: "User", required: true },
    kind: { type: String, enum: ["refund", "cancel"], required: true },
    reason: { type: String, required: true },
    total: { type: Number, required: true },
    cash: { type: Number, required: true },
    transfer: { type: Number, required: true },
    restock: { type: Schema.Types.Mixed, required: true },
  },
  opts,
);
const movementSchema = new Schema(
  {
    shift: { type: Schema.Types.ObjectId, required: true, index: true },
    product: { type: Schema.Types.ObjectId, required: true },
    name: String,
    actor: { type: Schema.Types.ObjectId, ref: "User", required: true },
    kind: {
      type: String,
      enum: ["opening", "sale", "return", "restock", "adjust"],
      required: true,
    },
    quantity: { type: Number, required: true },
    reason: String,
    sale: Schema.Types.ObjectId,
    reversal: Schema.Types.ObjectId,
  },
  opts,
);
export const Reversal =
  mongoose.models.Reversal || mongoose.model("Reversal", reversalSchema);
export const Movement =
  mongoose.models.Movement || mongoose.model("Movement", movementSchema);
export const User = mongoose.models.User || mongoose.model("User", userSchema);
export const Category =
  mongoose.models.Category || mongoose.model("Category", categorySchema);
export const Product =
  mongoose.models.Product || mongoose.model("Product", productSchema);
export const Shift =
  mongoose.models.Shift || mongoose.model("Shift", shiftSchema);
export const Stock =
  mongoose.models.Stock || mongoose.model("Stock", stockSchema);
export const Sale = mongoose.models.Sale || mongoose.model("Sale", saleSchema);
export const Social =
  mongoose.models.Social || mongoose.model("Social", socialSchema);
export const Audit =
  mongoose.models.Audit || mongoose.model("Audit", auditSchema);
export const Attempt =
  mongoose.models.Attempt || mongoose.model("Attempt", attemptSchema);
export async function indexes() {
  await Promise.all(
    [
      User,
      Category,
      Product,
      Shift,
      Stock,
      Sale,
      Social,
      Audit,
      Attempt,
      Reversal,
      Movement,
    ].map((m) => m.init()),
  );
}
