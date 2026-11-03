/**
 * Fixed deposit (FD) and recurring deposit (RD) maths. Pure functions, no UI.
 *
 * Conventions (all estimates; real banks differ in rounding, day counts and rules for part periods):
 *  - rates are nominal annual percentages; `n` is compounding periods per year (12, 4, 2 or 1)
 *  - FD cumulative:  A = P (1 + r/n)^(n t), with t in years (fractions allowed)
 *  - FD payout:      interest is paid every `payoutPerYear`, nothing compounds, principal comes back at maturity
 *  - RD:             a deposit is made at the START of each month; a deposit with m months left grows by (1 + r/n)^(n m / 12)
 *                    (for quarterly compounding this equals the standard Indian bank RD formula)
 *  - Effective yield is the annualised rate that turns the cash you put in into the maturity value
 */
export type Freq = 1 | 2 | 4 | 12;
export const FREQUENCIES: { value: Freq; label: string }[] = [
  { value: 12, label: "Monthly" }, { value: 4, label: "Quarterly" }, { value: 2, label: "Half-yearly" }, { value: 1, label: "Yearly" },
];

export type YearRow = { year: number; label: string; invested: number; interest: number; balance: number };

export type DepositResult = {
  invested: number;
  maturity: number;          // value at the end of the tenure (for payout FDs: the principal returned)
  interest: number;          // total interest earned (paid out over time for payout FDs)
  effectiveYieldPct: number;
  postTaxInterest: number;
  postTaxMaturity: number;   // invested + post-tax interest
  realMaturity: number;      // post-tax maturity in today's money after inflation
  payoutPerPeriod?: number;
  schedule: YearRow[];
};

type Common = { ratePct: number; months: number; freq: Freq; taxSlabPct?: number; inflationPct?: number };
export type FdInput = Common & { principal: number; payoutPerYear?: Freq | 0 };   // payoutPerYear 0/undefined = cumulative
export type RdInput = Common & { monthly: number };

export function validRange(rate: number, months: number): boolean {
  return Number.isFinite(rate) && rate >= 0 && rate <= 40 && Number.isInteger(months) && months >= 1 && months <= 600;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

function finish(invested: number, maturity: number, interest: number, yieldPct: number, i: Common, schedule: YearRow[], extra: Partial<DepositResult> = {}): DepositResult {
  const tax = Math.min(100, Math.max(0, i.taxSlabPct ?? 0)) / 100;
  const post = interest * (1 - tax);
  const postMaturity = invested + post;
  const years = i.months / 12;
  const infl = Math.max(0, i.inflationPct ?? 0) / 100;
  return {
    invested: round2(invested), maturity: round2(maturity), interest: round2(interest), effectiveYieldPct: yieldPct,
    postTaxInterest: round2(post), postTaxMaturity: round2(postMaturity), realMaturity: round2(postMaturity / Math.pow(1 + infl, years)),
    schedule, ...extra,
  };
}

/* ---------------- FD ---------------- */
export const fdValueAt = (principal: number, ratePct: number, months: number, n: Freq) =>
  principal * Math.pow(1 + ratePct / 100 / n, (n * months) / 12);

export function fixedDeposit(i: FdInput): DepositResult | null {
  if (!(i.principal > 0) || !validRange(i.ratePct, i.months)) return null;
  const r = i.ratePct / 100, years = i.months / 12;
  const rows: YearRow[] = [];
  const payout = i.payoutPerYear ? (i.payoutPerYear as Freq) : 0;
  for (let y = 1; y <= Math.ceil(years); y++) {
    const m = Math.min(12 * y, i.months);
    const interest = payout ? i.principal * r * (m / 12) : fdValueAt(i.principal, i.ratePct, m, i.freq) - i.principal;
    rows.push({ year: y, label: `Year ${y}`, invested: i.principal, interest: round2(interest), balance: round2(payout ? i.principal : i.principal + interest) });
  }
  if (payout) {
    const total = i.principal * r * years;
    return finish(i.principal, i.principal, total, i.ratePct, i, rows, { payoutPerPeriod: round2((i.principal * r) / payout) });
  }
  const maturity = fdValueAt(i.principal, i.ratePct, i.months, i.freq);
  const effective = (Math.pow(maturity / i.principal, 1 / years) - 1) * 100;
  return finish(i.principal, maturity, maturity - i.principal, effective, i, rows);
}

/* ---------------- RD ---------------- */
/** Value at the end of month `m` of one unit deposited at the start of each of the first `m` months. */
export function rdFactor(ratePct: number, m: number, n: Freq): number {
  const g = Math.pow(1 + ratePct / 100 / n, n / 12);  // growth per month
  let sum = 0;
  for (let k = 1; k <= m; k++) sum += Math.pow(g, m - k + 1);
  return sum;
}

/** Closed form of rdFactor (geometric series). Used to cross-check and for the target planner. */
export function rdFactorClosed(ratePct: number, m: number, n: Freq): number {
  const g = Math.pow(1 + ratePct / 100 / n, n / 12);
  return g === 1 ? m : (g * (Math.pow(g, m) - 1)) / (g - 1);
}

/** Annualised yield of paying `monthly` at the start of each month for `months` and receiving `maturity` at the end. */
export function rdYieldPct(monthly: number, months: number, maturity: number): number {
  const f = (x: number) => { let s = 0; for (let k = 1; k <= months; k++) s += monthly * Math.pow(1 + x, months - k + 1); return s - maturity; };
  let lo = 0, hi = 1;
  if (f(0) >= 0) return 0;
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (f(mid) > 0) hi = mid; else lo = mid; }
  return (Math.pow(1 + (lo + hi) / 2, 12) - 1) * 100;
}

export function recurringDeposit(i: RdInput): DepositResult | null {
  if (!(i.monthly > 0) || !validRange(i.ratePct, i.months)) return null;
  const rows: YearRow[] = [];
  for (let y = 1; y <= Math.ceil(i.months / 12); y++) {
    const m = Math.min(12 * y, i.months), bal = i.monthly * rdFactorClosed(i.ratePct, m, i.freq), inv = i.monthly * m;
    rows.push({ year: y, label: `Year ${y}`, invested: inv, interest: round2(bal - inv), balance: round2(bal) });
  }
  const maturity = i.monthly * rdFactorClosed(i.ratePct, i.months, i.freq);
  const invested = i.monthly * i.months;
  return finish(invested, maturity, maturity - invested, rdYieldPct(i.monthly, i.months, maturity), i, rows);
}

/** Monthly deposit needed to reach `target` at maturity. */
export function rdRequiredDeposit(target: number, ratePct: number, months: number, n: Freq): number | null {
  if (!(target > 0) || !validRange(ratePct, months)) return null;
  return round2(target / rdFactorClosed(ratePct, months, n));
}

/** One-off amount needed today to reach `target` as a cumulative FD. */
export function fdRequiredPrincipal(target: number, ratePct: number, months: number, n: Freq): number | null {
  if (!(target > 0) || !validRange(ratePct, months)) return null;
  return round2(target / Math.pow(1 + ratePct / 100 / n, (n * months) / 12));
}

export function addMonths(isoDate: string, months: number): string {
  const d = new Date(isoDate + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "";
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < day) d.setDate(0);  // 31 Jan + 1 month -> end of February
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}
