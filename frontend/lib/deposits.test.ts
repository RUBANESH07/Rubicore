import assert from "node:assert/strict";
import { test } from "node:test";
import { addMonths, fdRequiredPrincipal, fdValueAt, fixedDeposit, rdFactor, rdFactorClosed, rdRequiredDeposit, rdYieldPct, recurringDeposit } from "./deposits";

const near = (a: number, b: number, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

test("FD yearly compounding: 1000 at 10% for 2 years is exactly 1210", () => {
  const r = fixedDeposit({ principal: 1000, ratePct: 10, months: 24, freq: 1 })!;
  near(r.maturity, 1210, 0.001);
  near(r.interest, 210, 0.001);
  near(r.effectiveYieldPct, 10, 1e-9);
});

test("FD quarterly: 1,00,000 at 7% for 5 years is about 1,41,478", () => {
  const r = fixedDeposit({ principal: 100_000, ratePct: 7, months: 60, freq: 4 })!;
  near(r.maturity, 141_478, 1);
  near(r.maturity, 100_000 * Math.pow(1.0175, 20), 0.01);   // independent formula
  assert.ok(r.effectiveYieldPct > 7 && r.effectiveYieldPct < 7.2);  // (1.0175)^4 - 1 = 7.19%
});

test("more frequent compounding never gives less", () => {
  const v = (n: 1 | 2 | 4 | 12) => fdValueAt(50_000, 8, 36, n);
  assert.ok(v(12) > v(4) && v(4) > v(2) && v(2) > v(1));
});

test("FD payout: interest is paid out, principal returned, nothing compounds", () => {
  const r = fixedDeposit({ principal: 100_000, ratePct: 8, months: 12, freq: 4, payoutPerYear: 12 })!;
  near(r.payoutPerPeriod!, 666.67, 0.01);
  near(r.interest, 8000, 0.01);
  near(r.maturity, 100_000, 0.01);
  near(fixedDeposit({ principal: 100_000, ratePct: 8, months: 12, freq: 4, payoutPerYear: 4 })!.payoutPerPeriod!, 2000, 0.01);
});

test("RD loop and closed form agree", () => {
  for (const n of [1, 2, 4, 12] as const) for (const m of [1, 6, 12, 37, 120]) near(rdFactor(7.1, m, n), rdFactorClosed(7.1, m, n), 1e-6);
});

test("RD quarterly matches the standard bank formula M = R[(1+i)^q - 1] / (1 - (1+i)^(-1/3))", () => {
  const R = 1000, i = 0.08 / 4, q = 4;                              // 12 months
  const bank = (R * (Math.pow(1 + i, q) - 1)) / (1 - Math.pow(1 + i, -1 / 3));
  near(recurringDeposit({ monthly: R, ratePct: 8, months: 12, freq: 4 })!.maturity, bank, 0.01);
});

test("RD with 0% interest returns exactly what was deposited", () => {
  const r = recurringDeposit({ monthly: 2500, ratePct: 0, months: 24, freq: 4 })!;
  near(r.maturity, 60_000, 0.001);
  near(r.interest, 0, 0.001);
});

test("RD one month, monthly compounding: deposit grows one month of interest", () => {
  near(recurringDeposit({ monthly: 1000, ratePct: 12, months: 1, freq: 12 })!.maturity, 1010, 0.001);
});

test("RD invested amount and schedule are consistent", () => {
  const r = recurringDeposit({ monthly: 5000, ratePct: 6.5, months: 30, freq: 4 })!;
  near(r.invested, 150_000, 0.001);
  assert.equal(r.schedule.length, 3);
  near(r.schedule[2].balance, r.maturity, 0.01);
  near(r.schedule[0].invested, 60_000, 0.001);
  for (let i = 1; i < r.schedule.length; i++) assert.ok(r.schedule[i].balance > r.schedule[i - 1].balance);
});

test("RD yield exceeds the nominal rate when compounding, and is zero at 0%", () => {
  const r = recurringDeposit({ monthly: 5000, ratePct: 7, months: 60, freq: 4 })!;
  assert.ok(r.effectiveYieldPct > 7 && r.effectiveYieldPct < 7.6);
  near(rdYieldPct(1000, 12, 12_000), 0, 1e-9);
});

test("target planner is the inverse of the maturity calculation", () => {
  const maturity = recurringDeposit({ monthly: 5000, ratePct: 6.5, months: 60, freq: 4 })!.maturity;
  near(rdRequiredDeposit(maturity, 6.5, 60, 4)!, 5000, 0.01);
  const fd = fixedDeposit({ principal: 80_000, ratePct: 7, months: 48, freq: 4 })!.maturity;
  near(fdRequiredPrincipal(fd, 7, 48, 4)!, 80_000, 0.01);
});

test("tax and inflation adjust the result without changing the gross figures", () => {
  const gross = fixedDeposit({ principal: 100_000, ratePct: 7, months: 60, freq: 4 })!;
  const taxed = fixedDeposit({ principal: 100_000, ratePct: 7, months: 60, freq: 4, taxSlabPct: 30, inflationPct: 6 })!;
  near(taxed.maturity, gross.maturity, 0.001);
  near(taxed.postTaxInterest, gross.interest * 0.7, 0.01);
  near(taxed.postTaxMaturity, 100_000 + gross.interest * 0.7, 0.01);
  near(taxed.realMaturity, taxed.postTaxMaturity / Math.pow(1.06, 5), 0.01);
  near(gross.realMaturity, gross.postTaxMaturity, 0.001);          // no inflation entered: real == nominal
});

test("invalid input is rejected instead of producing nonsense", () => {
  assert.equal(fixedDeposit({ principal: 0, ratePct: 7, months: 12, freq: 4 }), null);
  assert.equal(fixedDeposit({ principal: 1000, ratePct: -1, months: 12, freq: 4 }), null);
  assert.equal(fixedDeposit({ principal: 1000, ratePct: 7, months: 0, freq: 4 }), null);
  assert.equal(fixedDeposit({ principal: 1000, ratePct: 7, months: 1.5, freq: 4 }), null);
  assert.equal(recurringDeposit({ monthly: NaN, ratePct: 7, months: 12, freq: 4 }), null);
  assert.equal(recurringDeposit({ monthly: 1000, ratePct: 99, months: 12, freq: 4 }), null);
  assert.equal(rdRequiredDeposit(-5, 7, 12, 4), null);
});

test("maturity dates handle month ends", () => {
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2026-10-31", 12), "2027-10-31");
  assert.equal(addMonths("2026-03-15", 60), "2031-03-15");
  assert.equal(addMonths("bad", 3), "");
});
