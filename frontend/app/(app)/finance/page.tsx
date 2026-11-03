"use client";
import { useState } from "react";
import { CashflowChart, CategoryPie, TrendArea } from "@/components/charts";
import { DonutChart, FlowChart, HeatmapCalendar, RadarViz, StackedBars, TreemapViz } from "@/components/charts/viz";
import { Async, PageHeader, SectionTitle, StatCard } from "@/components/common/states";
import { Badge, Button, Card, Input, Label, Select, Tabs } from "@/components/ui";
import { useFetch } from "@/hooks/useApi";
import { useApp } from "@/hooks/useApp";
import { api } from "@/lib/api";
import { cn, iso, money } from "@/lib/utils";
import type { CatAmount } from "@/types";

type Tab = "daily" | "weekly" | "monthly" | "yearly" | "budgets";
const change = (v: number | null | undefined, invert = false) =>
  v == null ? undefined : `${v > 0 ? "▲" : "▼"} ${Math.abs(v)}% ${invert ? "" : "vs previous"}`;

function Daily() {
  const [day, setDay] = useState(iso(new Date()));
  const r = useFetch<any>(`/analytics/daily?day=${day}`);
  return (
    <div className="space-y-4">
      <div className="max-w-[12rem]"><Label>Date</Label><Input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} /></div>
      <Async state={r}>{(d) => (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Total spending" value={money(d.total_spending)} tone="danger" sub={change(d.change_vs_previous_day_pct) ? `${change(d.change_vs_previous_day_pct)} day (${money(d.previous_day_spending)})` : "No spending the day before"} />
            <StatCard label="Total income" value={money(d.total_income)} tone="success" />
            <StatCard label="Remaining balance" value={money(d.remaining_balance)} />
            <StatCard label="Highest category" value={d.highest_category?.category ?? "—"} sub={d.highest_category ? money(d.highest_category.amount) : "No spending"} />
          </div>
          <Card><SectionTitle title="Spending by category" /><CategoryPie data={d.by_category as CatAmount[]} /></Card>
        </>
      )}</Async>
    </div>
  );
}

function Weekly() {
  const [day, setDay] = useState(iso(new Date()));
  const r = useFetch<any>(`/analytics/weekly?day=${day}`);
  return (
    <div className="space-y-4">
      <div className="max-w-[12rem]"><Label>Any day in the week</Label><Input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} /></div>
      <Async state={r}>{(d) => (
        <>
          <p className="text-sm text-muted-foreground">Week of {d.start} to {d.end}</p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Weekly expenses" value={money(d.expenses)} tone="danger" sub={change(d.change_vs_previous_week_pct)} />
            <StatCard label="Weekly income" value={money(d.income)} tone="success" />
            <StatCard label="Weekly savings" value={money(d.savings)} tone={d.savings >= 0 ? "success" : "danger"} />
            <StatCard label="Previous week" value={money(d.previous_week_expenses)} sub="expenses" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card><SectionTitle title="Daily spending trend" /><CashflowChart data={d.daily} /></Card>
            <Card><SectionTitle title="Category-wise spending" /><CategoryPie data={d.by_category} /></Card>
          </div>
        </>
      )}</Async>
    </div>
  );
}

function Monthly() {
  const now = new Date();
  const [ym, setYm] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [y, m] = ym.split("-");
  const r = useFetch<any>(`/analytics/monthly?year=${y}&month=${Number(m)}`);
  return (
    <div className="space-y-4">
      <div className="max-w-[12rem]"><Label>Month</Label><Input type="month" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)} /></div>
      <Async state={r}>{(d) => (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Total income" value={money(d.total_income)} tone="success" sub={change(d.comparison.income_change_pct)} />
            <StatCard label="Total expenses" value={money(d.total_expenses)} tone="danger" sub={change(d.comparison.expense_change_pct)} />
            <StatCard label="Savings rate" value={`${d.savings_rate}%`} sub={`Saved ${money(d.savings)}`} tone={d.savings >= 0 ? "success" : "danger"} />
            <StatCard label="Avg daily spend" value={money(d.avg_daily_spending)} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card><SectionTitle title="Expense distribution" /><CategoryPie data={d.distribution} /></Card>
            <Card><SectionTitle title="Daily cash flow" /><CashflowChart data={d.daily} /></Card>
            <Card>
              <SectionTitle title="Budget performance" />
              {!d.budget_performance.length ? <p className="text-sm text-muted-foreground">No budgets yet. Set some in the Budgets & goals tab.</p> : (
                <ul className="space-y-3">
                  {d.budget_performance.map((b: any) => (
                    <li key={b.id}>
                      <div className="mb-1 flex justify-between text-sm"><span className="font-medium">{b.category}</span><span className="tabular-nums text-muted-foreground">{money(b.spent)} / {money(b.limit)}</span></div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", b.status === "over" ? "bg-danger" : b.status === "warning" ? "bg-warning" : "bg-success")} style={{ width: `${Math.min(b.percent, 100)}%` }} /></div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card><SectionTitle title="Spending shape" sub="This month vs last month" />
              <RadarViz aName="This month" bName="Last month" data={Array.from(new Set([...d.distribution.slice(0, 6).map((c: any) => c.category), ...d.previous_month.distribution.slice(0, 6).map((c: any) => c.category)])).slice(0, 7).map((c: any) => ({ axis: String(c).length > 11 ? String(c).slice(0, 10) + "…" : c, a: d.distribution.find((x: any) => x.category === c)?.amount ?? 0, b: d.previous_month.distribution.find((x: any) => x.category === c)?.amount ?? 0 }))} /></Card>
            <Card><SectionTitle title="Share of spending" sub="Bigger block = bigger share" /><TreemapViz data={d.distribution.map((c: any) => ({ name: c.category, value: c.amount }))} /></Card>
            <Card><SectionTitle title="Daily spending heatmap" sub="Darker = more spent" /><HeatmapCalendar days={d.daily.map((x: any) => ({ date: x.date, value: x.expense }))} fmt={(n) => money(n)} /></Card>
            <Card><SectionTitle title="Income sources" /><DonutChart data={d.income_distribution.map((c: any) => ({ name: c.category, value: c.amount }))} centerLabel="earned" /></Card>
            <Card>
              <SectionTitle title="Month-over-month" sub={`vs ${d.previous_month.year}-${String(d.previous_month.month).padStart(2, "0")}`} />
              <table className="w-full text-sm"><tbody className="divide-y">
                <tr><td className="py-2">Income</td><td className="text-right tabular-nums">{money(d.total_income)}</td><td className="text-right text-muted-foreground tabular-nums">{money(d.previous_month.total_income)}</td></tr>
                <tr><td className="py-2">Expenses</td><td className="text-right tabular-nums">{money(d.total_expenses)}</td><td className="text-right text-muted-foreground tabular-nums">{money(d.previous_month.total_expenses)}</td></tr>
                <tr><td className="py-2">Savings</td><td className="text-right tabular-nums">{money(d.savings)}</td><td className="text-right text-muted-foreground tabular-nums">{money(d.previous_month.savings)}</td></tr>
              </tbody></table>
            </Card>
          </div>
        </>
      )}</Async>
    </div>
  );
}

function Yearly() {
  const [year, setYear] = useState(new Date().getFullYear());
  const r = useFetch<any>(`/analytics/yearly?year=${year}`);
  return (
    <div className="space-y-4">
      <div className="max-w-[10rem]"><Label>Year</Label><Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} /></div>
      <Async state={r}>{(d) => (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Annual income" value={money(d.annual_income)} tone="success" sub={change(d.progress.income_change_pct)} />
            <StatCard label="Annual expenses" value={money(d.annual_expenses)} tone="danger" sub={change(d.progress.expense_change_pct)} />
            <StatCard label="Savings" value={money(d.savings)} tone={d.savings >= 0 ? "success" : "danger"} />
            <StatCard label="Savings rate" value={`${d.savings_rate}%`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card><SectionTitle title="Income, expenses and net savings" /><FlowChart data={d.months} xKey="month" /></Card>
            <Card><SectionTitle title="Savings growth" sub="Cumulative" /><TrendArea data={d.months} xKey="month" yKey="cumulative_savings" name="Cumulative savings" color="#3fae6e" /></Card>
            <Card className="lg:col-span-2"><SectionTitle title="Category mix by month" sub="Top categories stacked" />
              <StackedBars xKey="month" keys={d.category_trends.map((c: any) => c.category)} data={d.months.map((m: any, i: number) => ({ month: m.month, ...Object.fromEntries(d.category_trends.map((c: any) => [c.category, c.monthly[i]])) }))} /></Card>
            <Card><SectionTitle title="Where the year's money went" /><TreemapViz data={d.distribution.map((c: any) => ({ name: c.category, value: c.amount }))} /></Card>
            <Card><SectionTitle title="Spending split" /><DonutChart data={d.distribution.map((c: any) => ({ name: c.category, value: c.amount }))} centerLabel="spent" /></Card>
            <Card className="lg:col-span-2">
              <SectionTitle title="Category trends" sub="Top categories by spend" />
              <div className="overflow-x-auto"><table className="w-full text-xs">
                <thead className="text-left text-muted-foreground"><tr><th className="py-1">Category</th>{d.months.map((m: any) => <th key={m.month} className="px-1 text-right">{m.month}</th>)}<th className="text-right">Total</th></tr></thead>
                <tbody className="divide-y">{d.category_trends.map((c: any) => (
                  <tr key={c.category}><td className="py-1.5 font-medium">{c.category}</td>{c.monthly.map((v: number, i: number) => <td key={i} className="px-1 text-right tabular-nums text-muted-foreground">{v ? Math.round(v) : "–"}</td>)}<td className="text-right font-medium tabular-nums">{money(c.total)}</td></tr>
                ))}</tbody>
              </table></div>
            </Card>
          </div>
        </>
      )}</Async>
    </div>
  );
}

function Budgets() {
  const { categories, bump, version } = useApp();
  const budgets = useFetch<any[]>(`/budgets?v=${version}`);
  const goals = useFetch<any[]>(`/goals?v=${version}`);
  const [cat, setCat] = useState("");
  const [amt, setAmt] = useState("");
  const [g, setG] = useState({ name: "", target: "", saved: "0" });
  const [err, setErr] = useState("");
  const run = async (fn: () => Promise<unknown>) => { setErr(""); try { await fn(); bump(); } catch (e: any) { setErr(e.message); } };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <SectionTitle title="Monthly budgets" sub="Alerts appear at 80% and 100%." />
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <div className="min-w-[10rem] flex-1"><Label>Category</Label><Select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Overall monthly budget</option>{categories.filter((c) => c.type === "expense").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
          <div className="w-32"><Label>Limit (₹)</Label><Input type="number" min="1" value={amt} onChange={(e) => setAmt(e.target.value)} /></div>
          <Button disabled={!(Number(amt) > 0)} onClick={() => run(async () => { await api.put("/budgets", { category_id: cat ? Number(cat) : null, amount: Number(amt) }); setAmt(""); })}>Set</Button>
        </div>
        <Async state={budgets} empty={(d) => !d.length && "No budgets yet."}>{(d) => (
          <ul className="space-y-3">{d.map((b) => (
            <li key={b.id}>
              <div className="mb-1 flex items-center justify-between text-sm"><span className="font-medium">{b.category} <Badge tone={b.status === "over" ? "danger" : b.status === "warning" ? "warning" : "success"}>{b.percent}%</Badge></span>
                <span className="flex items-center gap-2 tabular-nums text-muted-foreground">{money(b.spent)} / {money(b.limit)}<button className="text-xs text-danger" onClick={() => run(() => api.del(`/budgets/${b.id}`))}>remove</button></span></div>
              <div className="h-2 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", b.status === "over" ? "bg-danger" : b.status === "warning" ? "bg-warning" : "bg-success")} style={{ width: `${Math.min(b.percent, 100)}%` }} /></div>
            </li>
          ))}</ul>
        )}</Async>
      </Card>
      <Card>
        <SectionTitle title="Savings goals" />
        <div className="mb-4 grid grid-cols-3 items-end gap-2">
          <div className="col-span-3 sm:col-span-1"><Label>Goal</Label><Input value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} placeholder="Emergency fund" /></div>
          <div><Label>Target (₹)</Label><Input type="number" min="1" value={g.target} onChange={(e) => setG({ ...g, target: e.target.value })} /></div>
          <div><Label>Saved (₹)</Label><Input type="number" min="0" value={g.saved} onChange={(e) => setG({ ...g, saved: e.target.value })} /></div>
          <Button className="col-span-3" disabled={!g.name.trim() || !(Number(g.target) > 0)} onClick={() => run(async () => { await api.post("/goals", { name: g.name, target_amount: Number(g.target), saved_amount: Number(g.saved || 0) }); setG({ name: "", target: "", saved: "0" }); })}>Add goal</Button>
        </div>
        <Async state={goals} empty={(d) => !d.length && "No goals yet."}>{(d) => (
          <ul className="space-y-3">{d.map((x) => {
            const p = Math.min(100, Math.round((x.saved_amount / x.target_amount) * 100));
            return (
              <li key={x.id}>
                <div className="mb-1 flex items-center justify-between text-sm"><span className="font-medium">{x.name}</span><span className="tabular-nums text-muted-foreground">{money(x.saved_amount)} / {money(x.target_amount)} ({p}%)</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${p}%` }} /></div>
                <div className="mt-1 flex gap-2 text-xs">
                  <button className="text-primary" onClick={() => { const v = prompt("Add to saved amount (₹)"); if (v && Number(v) > 0) run(() => api.put(`/goals/${x.id}`, { saved_amount: x.saved_amount + Number(v) })); }}>+ Add savings</button>
                  <button className="text-danger" onClick={() => confirm("Delete goal?") && run(() => api.del(`/goals/${x.id}`))}>delete</button>
                </div>
              </li>
            );
          })}</ul>
        )}</Async>
      </Card>
      {err && <p className="text-sm text-danger lg:col-span-2" role="alert">{err}</p>}
    </div>
  );
}

export default function FinancePage() {
  const [tab, setTab] = useState<Tab>("monthly");
  const { version } = useApp();
  void version;
  return (
    <>
      <PageHeader title="Financial Analysis" sub="Daily, weekly, monthly and yearly insights. Transfers between your accounts are excluded."
        right={<Tabs value={tab} onChange={setTab} tabs={[{ id: "daily", label: "Daily" }, { id: "weekly", label: "Weekly" }, { id: "monthly", label: "Monthly" }, { id: "yearly", label: "Yearly" }, { id: "budgets", label: "Budgets & goals" }]} />} />
      {tab === "daily" && <Daily />}{tab === "weekly" && <Weekly />}{tab === "monthly" && <Monthly />}{tab === "yearly" && <Yearly />}{tab === "budgets" && <Budgets />}
    </>
  );
}
