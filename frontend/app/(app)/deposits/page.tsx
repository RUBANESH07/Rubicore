"use client";
import { Download, Info, PiggyBank, Target, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import { TrendArea } from "@/components/charts";
import { DonutChart, ProgressRing, StackedBars } from "@/components/charts/viz";
import { Empty, PageHeader, SectionTitle, StatCard } from "@/components/common/states";
import { Card, Input, Label, Select, Tabs } from "@/components/ui";
import { DepositResult, FREQUENCIES, Freq, addMonths, fdRequiredPrincipal, fixedDeposit, rdRequiredDeposit, recurringDeposit } from "@/lib/deposits";
import { MINT, PINK, SKY, fmtDate, iso, money } from "@/lib/utils";

type Kind = "fd" | "rd";
const rupee2 = (n: number) => money(n, { maximumFractionDigits: 2 });
const SLABS = [0, 5, 10, 15, 20, 30];

function NumberField({ label, value, onChange, suffix, step = "any", min = 0, max, hint }: { label: string; value: string; onChange: (v: string) => void; suffix?: string; step?: string; min?: number; max?: number; hint?: string }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="relative">
        <Input type="number" inputMode="decimal" step={step} min={min} max={max} value={value} onChange={(e) => onChange(e.target.value)} className={suffix ? "pr-14" : ""} />
        {suffix && <span className="pointer-events-none absolute right-3 top-2 text-xs text-muted-foreground">{suffix}</span>}
      </div>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function csv(kind: Kind, r: DepositResult) {
  const rows = [["year", "invested", "interest", "balance"], ...r.schedule.map((y) => [y.label, y.invested.toFixed(2), y.interest.toFixed(2), y.balance.toFixed(2)])];
  const url = URL.createObjectURL(new Blob([rows.map((x) => x.join(",")).join("\n")], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `${kind === "fd" ? "fixed" : "recurring"}-deposit-schedule.csv` });
  a.click();
  URL.revokeObjectURL(url);
}

function Results({ kind, r, startDate, months }: { kind: Kind; r: DepositResult | null; startDate: string; months: number }) {
  if (!r) return <Card><Empty text="Enter an amount, a rate between 0 and 40%, and a tenure of 1 to 600 months." /></Card>;
  const payout = r.payoutPerPeriod != null;
  const maturityDate = startDate ? addMonths(startDate, months) : "";
  const growth = r.schedule.map((y) => ({ label: y.label.replace("Year ", "Y"), balance: y.balance }));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label={payout ? "Principal returned" : "Maturity value"} value={rupee2(r.maturity)} sub={maturityDate ? `on ${fmtDate(maturityDate)}` : undefined} icon={<PiggyBank className="h-4 w-4" />} />
        <StatCard label="Total interest" value={rupee2(r.interest)} tone="success" sub={payout ? `${rupee2(r.payoutPerPeriod!)} paid each period` : undefined} icon={<TrendingUp className="h-4 w-4" />} />
        <StatCard label={kind === "rd" ? "Total deposited" : "Amount invested"} value={rupee2(r.invested)} />
        <StatCard label="Effective yield" value={`${r.effectiveYieldPct.toFixed(2)}%`} sub="per year, after compounding" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionTitle title="After tax and inflation" sub="Rough picture. Set your tax slab and expected inflation on the left." />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div><div className="text-xs text-muted-foreground">Interest after tax</div><div className="text-lg font-bold tabular-nums">{rupee2(r.postTaxInterest)}</div></div>
            <div><div className="text-xs text-muted-foreground">Value after tax</div><div className="text-lg font-bold tabular-nums">{rupee2(r.postTaxMaturity)}</div></div>
            <div><div className="text-xs text-muted-foreground">In today's money</div><div className="text-lg font-bold tabular-nums">{rupee2(r.realMaturity)}</div></div>
            <div className="flex items-center"><ProgressRing value={r.interest} max={r.invested + r.interest} size={72} color={PINK} display={`${r.invested ? Math.round((r.interest / r.invested) * 100) : 0}%`} label="Gain on money in" /></div>
          </div>
        </Card>
        <Card><SectionTitle title="Where the money comes from" /><DonutChart data={[{ name: "Interest", value: r.interest }, { name: "Invested", value: r.invested }]} centerValue={money(payout ? r.invested + r.interest : r.maturity)} centerLabel={payout ? "total received" : "at maturity"} height={170} /></Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><SectionTitle title={payout ? "Principal and interest paid out" : "Invested vs interest by year"} /><StackedBars xKey="label" keys={["Invested", "Interest"]} colors={[SKY, PINK]} height={240}
          data={r.schedule.map((y) => ({ label: y.label.replace("Year ", "Y"), Invested: Math.round(y.invested), Interest: Math.round(y.interest) }))} /></Card>
        <Card><SectionTitle title="Balance growth" /><TrendArea data={growth} xKey="label" yKey="balance" name="Balance" color={MINT} height={240} /></Card>
      </div>
      <Card className="p-0">
        <div className="flex items-center justify-between p-4 pb-2"><SectionTitle title="Year-by-year" /><button className="flex items-center gap-1 text-xs text-primary" onClick={() => csv(kind, r)}><Download className="h-3.5 w-3.5" />CSV</button></div>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground"><tr><th className="p-3">Year</th><th className="p-3 text-right">Invested</th><th className="p-3 text-right">Interest so far</th><th className="p-3 text-right">{payout ? "Principal" : "Balance"}</th></tr></thead>
          <tbody className="divide-y">{r.schedule.map((y) => (
            <tr key={y.year}><td className="p-3">{y.label}</td><td className="p-3 text-right tabular-nums">{rupee2(y.invested)}</td><td className="p-3 text-right tabular-nums text-success">{rupee2(y.interest)}</td><td className="p-3 text-right font-medium tabular-nums">{rupee2(y.balance)}</td></tr>
          ))}</tbody>
        </table></div>
      </Card>
    </div>
  );
}

export default function DepositsPage() {
  const [kind, setKind] = useState<Kind>("fd");
  const [amount, setAmount] = useState("100000");
  const [monthly, setMonthly] = useState("5000");
  const [rate, setRate] = useState("7");
  const [years, setYears] = useState("5");
  const [extraMonths, setExtraMonths] = useState("0");
  const [freq, setFreq] = useState<Freq>(4);
  const [payout, setPayout] = useState("0");
  const [tax, setTax] = useState("0");
  const [inflation, setInflation] = useState("5");
  const [start, setStart] = useState(iso(new Date()));
  const [target, setTarget] = useState("500000");

  const months = Math.round(Number(years || 0) * 12 + Number(extraMonths || 0));
  const common = { ratePct: Number(rate), months, freq, taxSlabPct: Number(tax), inflationPct: Number(inflation) };

  const result = useMemo(() => kind === "fd"
    ? fixedDeposit({ ...common, principal: Number(amount), payoutPerYear: Number(payout) as Freq | 0 })
    : recurringDeposit({ ...common, monthly: Number(monthly) }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [kind, amount, monthly, rate, months, freq, payout, tax, inflation]);

  const planner = useMemo(() => kind === "rd" ? rdRequiredDeposit(Number(target), Number(rate), months, freq) : fdRequiredPrincipal(Number(target), Number(rate), months, freq),
    [kind, target, rate, months, freq]);

  return (
    <>
      <PageHeader title="Deposit calculators" sub="Fixed deposit (FD) and recurring deposit (RD): maturity, interest, yield, tax and inflation"
        right={<Tabs value={kind} onChange={setKind} tabs={[{ id: "fd", label: "Fixed deposit" }, { id: "rd", label: "Recurring deposit" }]} />} />
      <div className="grid gap-4 xl:grid-cols-[22rem_1fr]">
        <div className="space-y-4">
          <Card className="space-y-3">
            <SectionTitle title={kind === "fd" ? "Fixed deposit" : "Recurring deposit"} sub={kind === "fd" ? "One lump sum for a fixed time" : "The same amount every month"} />
            {kind === "fd"
              ? <NumberField label="Deposit amount" value={amount} onChange={setAmount} suffix="₹" min={1} />
              : <NumberField label="Monthly deposit" value={monthly} onChange={setMonthly} suffix="₹ / month" min={1} hint="Paid at the start of each month." />}
            <NumberField label="Interest rate" value={rate} onChange={setRate} suffix="% a year" step="0.05" max={40} />
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Tenure: years" value={years} onChange={setYears} step="1" />
              <NumberField label="and months" value={extraMonths} onChange={setExtraMonths} step="1" max={11} />
            </div>
            <div><Label>Interest compounds</Label><Select value={freq} onChange={(e) => setFreq(Number(e.target.value) as Freq)}>{FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}</Select>
              <p className="mt-1 text-[11px] text-muted-foreground">Most Indian banks compound quarterly.</p></div>
            {kind === "fd" && (
              <div><Label>Interest option</Label><Select value={payout} onChange={(e) => setPayout(e.target.value)}>
                <option value="0">Cumulative (reinvested, paid at maturity)</option><option value="12">Pay out monthly</option><option value="4">Pay out quarterly</option><option value="2">Pay out half-yearly</option><option value="1">Pay out yearly</option></Select></div>
            )}
            <div><Label>Start date (for the maturity date)</Label><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
          </Card>
          <Card className="space-y-3">
            <SectionTitle title="Tax and inflation" sub="Optional, for a more realistic number" />
            <div><Label>Your tax slab on interest</Label><Select value={tax} onChange={(e) => setTax(e.target.value)}>{SLABS.map((s) => <option key={s} value={s}>{s === 0 ? "No tax" : `${s}%`}</option>)}</Select></div>
            <NumberField label="Expected inflation" value={inflation} onChange={setInflation} suffix="% a year" step="0.1" max={30} />
          </Card>
          <Card className="space-y-3">
            <SectionTitle title="Goal planner" sub={kind === "rd" ? "What monthly deposit reaches a target?" : "What lump sum reaches a target?"} right={<Target className="h-4 w-4 text-primary" />} />
            <NumberField label="Target amount at maturity" value={target} onChange={setTarget} suffix="₹" min={1} />
            <div className="rounded-lg bg-primary/10 p-3 text-center">
              {planner ? <><div className="text-xs text-muted-foreground">{kind === "rd" ? "Deposit each month" : "Deposit today"}</div><div className="text-2xl font-bold tabular-nums text-primary">{rupee2(planner)}</div>
                <div className="text-[11px] text-muted-foreground">at {rate}% for {months} months, compounding {FREQUENCIES.find((f) => f.value === freq)?.label.toLowerCase()}</div></> : <div className="text-sm text-muted-foreground">Enter a target, rate and tenure.</div>}
            </div>
          </Card>
        </div>
        <div className="min-w-0 space-y-4">
          <Results kind={kind} r={result} startDate={start} months={months} />
          <Card className="flex gap-2 bg-muted/50 text-xs text-muted-foreground"><Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Estimates for planning only. Banks differ in compounding rules, day counts, rounding and how they treat part periods, and tax rules (including TDS) change. Check the figures with your bank. This is not financial advice.</span></Card>
        </div>
      </div>
    </>
  );
}
