import {
  before as beforeAll,
  after as afterAll,
  beforeEach,
  describe,
  it,
} from "node:test";
import assert from "node:assert/strict";
import {
  assertPayment,
  checkoutSchema,
  expectedCash,
  productInput,
  csvCell,
  canManage,
} from "../src/lib/domain";
describe("cashier domain", () => {
  it("accepts split payments and rejects wrong totals", () => {
    assert.doesNotThrow(() => assertPayment(35000, 15000, 20000));
    assert.throws(() => assertPayment(35000, 15000, 15000));
  });
  it("reconciles cash independently of transfers", () =>
    assert.equal(expectedCash(500000, 125000), 625000));
  it("rejects negative, fractional and empty checkouts", () => {
    assert.equal(
      checkoutSchema.safeParse({
        key: crypto.randomUUID(),
        shift: "a".repeat(24),
        cash: -1,
        transfer: 0,
        lines: [],
      }).success,
      false,
    );
  });
  it("requires unique variant names", () => {
    assert.equal(
      productInput.safeParse({
        name: "Tea",
        category: "Drinks",
        kind: "prepared",
        defaultStock: 0,
        variants: [
          { name: "Cup", price: 10000 },
          { name: "Cup", price: 20000 },
        ],
      }).success,
      false,
    );
  });
  it("escapes spreadsheet formulas and quotes", () => {
    assert.equal(csvCell("=1+1"), '"\'=1+1"');
    assert.equal(csvCell('a"b'), '"a""b"');
  });
  it("limits management roles", () => {
    assert.equal(canManage("Cashier"), false);
    assert.equal(canManage("Manager"), true);
    assert.equal(canManage("Admin"), true);
  });
});
