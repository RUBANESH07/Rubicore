"use client";
import { ArrowDownRight, ArrowUpRight, PiggyBank, Wallet } from "lucide-react";
import Link from "next/link";
import { CashflowChart, CategoryPie } from "@/components/charts";
import { DonutChart, FunnelViz, HeatmapCalendar, PyramidViz, ProgressRing, RadarViz, Sparkline, TreemapViz, UnitChart, VerticalTimeline } from "@/components/charts/viz";
import { AiNotice, Async, Empty, PageHeader, SectionTitle } from "@/components/common/states";
import { Button, Card } from "@/components/ui";
import { useFetch } from "@/hooks/useApi";
import { useApp } from "@/hooks/useApp";
import { CORAL, MINT, PINK, SKY, SUN, fmtDate, money, pct } from "@/lib/utils";
import type { Article, CatAmount, Quote } from "@/types";

type Overview = {
  balance: { total: number; by_type: Record<string, number> };
  today: { income: number; expense: number };
  month: { income: number; expense: number; savings: number; savings_rate: number };
  total_goal_savings: number; expense_breakdown: CatAmount[]; income_breakdown: CatAmount[]; previous_breakdown: CatAmount[];
  daily_trend: { date: string; income: number; expense: number }[];
  recent_transactions: { id: number; type: string; amount: number; date: string; category: string | null; description: string }[];
  daily_summary: string;
};
type Budget = { id: number; category: string; limit: number; spent: number; percent: number; status: "ok" | "warning" | "over" };

const NEEDS = ["food", "rent", "bills", "health", "transportation", "petrol", "fuel", "education"];
const isNeed = (c: string) => NEEDS.some((n) => c.toLowerCase().includes(n));

function Stat({ label, value, sub, icon, tone, spark, sparkKey, sparkColor }: { label: string; value: string; sub?: string; icon: React.ReactNode; tone?: string; spark?: any[]; sparkKey?: string; sparkColor?: string }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">{label}{icon}</div>
      <div className={`mt-1 text-2xl font-bold tracking-tight tabular-nums ${tone ?? ""}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      {spark && sparkKey && <div className="-mx-4 -mb-4 mt-2"><Sparkline data={spark} dataKey={sparkKey} color={sparkColor} /></div>}
    </Card>
  );
}

function AiSummary({ fallback }: { fallback: string }) {
  const s = useFetch<{ summary: string | null }>("/dashboard/ai-summary");
  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/10 via-sun/10 to-sky/10">
      <SectionTitle title="Daily financial summary" right={s.data?.summary ? <AiNotice /> : undefined} />
      <p className="text-sm leading-relaxed">{s.loading ? "Writing your summary…" : s.data?.summary || fallback}</p>
    </Card>
  );
}

function BudgetRings() {
  const b = useFetch<Budget[]>("/budgets");
  return (
    <Card>
      <SectionTitle title="Budget rings" sub="This month, spent vs limit" right={<Link href="/finance" className="text-xs text-primary">Edit</Link>} />
      <Async state={b} empty={(d) => !d.length && "No budgets yet. Set some in Financial Analysis."}>{(d) => (
        <div className="grid grid-cols-3 gap-3">
          {d.slice(0, 6).map((x) => (
            <ProgressRing key={x.id} value={x.spent} max={x.limit} label={x.category} sub={`${money(x.spent)} / ${money(x.limit)}`} size={88}
              color={x.status === "over" ? CORAL : x.status === "warning" ? SUN : MINT} display={`${Math.round(x.percent)}%`} />
          ))}
        </div>
      )}</Async>
    </Card>
  );
}

function StocksWidget() {
  const s = useFetch<{ data: Quote[] }>("/stocks/indices");
  return (
    <Card>
      <SectionTitle title="Market overview" sub="Delayed data" right={<Link href="/stocks" className="text-xs text-primary">Open</Link>} />
      <Async state={s}>{(d) => (
        <ul className="space-y-2">
          {d.data.map((q) => (
            <li key={q.symbol} className="flex items-center justify-between text-sm">
              <span className="font-medium">{q.label}</span>
              {q.error ? <span className="text-xs text-muted-foreground">unavailable</span> : (
                <span className="text-right tabular-nums">{q.price?.toLocaleString("en-IN")}
                  <span className={`ml-2 text-xs ${(q.change_pct ?? 0) >= 0 ? "text-success" : "text-danger"}`}>{pct(q.change_pct)}</span></span>
              )}
            </li>
          ))}
        </ul>
      )}</Async>
    </Card>
  );
}

function NewsWidget() {
  const n = useFetch<Article[]>("/news?category=india&limit=5");
  return (
    <Card>
      <SectionTitle title="Latest news" right={<Link href="/news" className="text-xs text-primary">More</Link>} />
      <Async state={n} empty={(d) => !d.length && "No headlines right now."}>{(d) => (
        <ul className="space-y-2.5">
          {d.slice(0, 5).map((a) => (
            <li key={a.url}>
              <a href={a.url} target="_blank" rel="noopener noreferrer" className="line-clamp-2 text-sm font-medium hover:text-primary">{a.title}</a>
              <p className="text-xs text-muted-foreground">{a.source}</p>
            </li>
          ))}
        </ul>
      )}</Async>
    </Card>
  );
}

export default function Dashboard() {
  const { user, version, openAdd } = useApp();
  const ov = useFetch<Overview>("/dashboard/overview");
  const widgets = useFetch<{ widgets: { key: string; visible: boolean }[] }>("/settings/dashboard");
  const show = (k: string) => widgets.data?.widgets.find((w) => w.key === k)?.visible !== false;
  void version;

  return (
    <>
      <PageHeader title={`Hello, ${user.name.split(" ")[0]}`} sub="Track Your Day. Understand Your Money. Explore the World." />
      <Async state={ov} empty={() => false}>{(d) => {
        const exp = d.expense_breakdown;
        const needs = exp.filter((c) => isNeed(c.category)).reduce((s, c) => s + c.amount, 0);
        const invest = exp.filter((c) => /invest/i.test(c.category)).reduce((s, c) => s + c.amount, 0);
        const wants = exp.filter((c) => !isNeed(c.category) && !/invest/i.test(c.category)).reduce((s, c) => s + c.amount, 0);
        const saved = Math.max(0, d.month.savings) + invest;
        const top = Array.from(new Set([...exp.slice(0, 6).map((c) => c.category), ...d.previous_breakdown.slice(0, 6).map((c) => c.category)])).slice(0, 7);
        const radar = top.map((c) => ({ axis: c.length > 11 ? c.slice(0, 10) + "…" : c, a: exp.find((x) => x.category === c)?.amount ?? 0, b: d.previous_breakdown.find((x) => x.category === c)?.amount ?? 0 }));
        const perTen = d.month.income > 0 ? (d.month.expense / d.month.income) * 10 : 0;
        const split = d.balance.by_type;
        const splitTotal = Math.max(1, Math.abs(split.cash) + Math.abs(split.bank) + Math.abs(split.wallet));
        return (
          <div className="space-y-4">
            {show("balance") && (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Card>
                  <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">Available balance<Wallet className="h-4 w-4" /></div>
                  <div className="mt-1 text-2xl font-bold tracking-tight tabular-nums">{money(d.balance.total)}</div>
                  <div className="mt-3 flex h-2.5 overflow-hidden rounded-full" role="img" aria-label="Cash, bank and wallet split">
                    <span style={{ width: `${(Math.abs(split.cash) / splitTotal) * 100}%`, background: SUN }} /><span style={{ width: `${(Math.abs(split.bank) / splitTotal) * 100}%`, background: PINK }} /><span style={{ width: `${(Math.abs(split.wallet) / splitTotal) * 100}%`, background: SKY }} />
                  </div>
                  <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground"><span>Cash {money(split.cash)}</span><span>Bank {money(split.bank)}</span><span>Wallet {money(split.wallet)}</span></div>
                </Card>
                <Stat label="Today's income" value={money(d.today.income)} tone="text-success" icon={<ArrowUpRight className="h-4 w-4" />} spark={d.daily_trend} sparkKey="income" sparkColor={MINT} sub={`${money(d.month.income)} this month`} />
                <Stat label="Today's expenses" value={money(d.today.expense)} tone="text-danger" icon={<ArrowDownRight className="h-4 w-4" />} spark={d.daily_trend} sparkKey="expense" sparkColor={CORAL} sub={`${money(d.month.expense)} this month`} />
                <Stat label="Saved this month" value={money(d.month.savings)} tone={d.month.savings >= 0 ? "text-success" : "text-danger"} icon={<PiggyBank className="h-4 w-4" />} sub={`${d.month.savings_rate}% savings rate · goals ${money(d.total_goal_savings)}`} />
              </div>
            )}
            {show("ai_summary") && <AiSummary fallback={d.daily_summary} />}
            <div className="grid gap-4 lg:grid-cols-2">
              {show("cashflow") && <Card><SectionTitle title="Cash flow this month" /><CashflowChart data={d.daily_trend} /></Card>}
              {show("expense_chart") && <Card><SectionTitle title="Expense breakdown" sub="This month" /><CategoryPie data={d.expense_breakdown} /></Card>}
              {show("funnel") && (
                <Card><SectionTitle title="Money funnel" sub="From income to savings, this month" />
                  <FunnelViz stages={[{ label: "Income", value: d.month.income, color: SKY }, { label: "Spent", value: d.month.expense, color: CORAL }, { label: "Saved", value: Math.max(0, d.month.savings), color: MINT }]} /></Card>
              )}
              {show("ratio") && (
                <Card><SectionTitle title="Savings rate" sub="How much of your income you keep" />
                  <div className="flex flex-wrap items-center gap-6">
                    <ProgressRing value={Math.max(0, d.month.savings_rate)} max={100} label="Savings rate" size={124} color={d.month.savings_rate >= 20 ? MINT : d.month.savings_rate >= 0 ? SUN : CORAL} />
                    <div className="min-w-[12rem] flex-1">
                      <div className="mb-2 text-sm font-medium">Of every ₹10 you earn, you spend ₹{perTen.toFixed(1)}</div>
                      <UnitChart filled={perTen} total={10} color={CORAL} restColor={MINT} caption={d.month.income ? `${money(d.month.expense)} spent of ${money(d.month.income)} earned` : "Add income to see this"} />
                    </div>
                  </div></Card>
              )}
              {show("budget_rings") && <BudgetRings />}
              {show("radar") && <Card><SectionTitle title="Spending shape" sub="This month vs last month by category" /><RadarViz data={radar} aName="This month" bName="Last month" /></Card>}
              {show("heatmap") && <Card><SectionTitle title="Spending heatmap" sub="Darker = more spent that day" /><HeatmapCalendar days={d.daily_trend.map((x) => ({ date: x.date, value: x.expense }))} fmt={(n) => money(n)} /></Card>}
              {show("treemap") && <Card><SectionTitle title="Where the money went" sub="Bigger block = bigger share" /><TreemapViz data={exp.map((c) => ({ name: c.category, value: c.amount }))} /></Card>}
              {show("pyramid") && (
                <Card><SectionTitle title="Needs, wants and saving" sub="A healthy base is saving and essentials" />
                  <PyramidViz levels={[{ label: "Wants", value: wants, color: SUN }, { label: "Needs", value: needs, color: SKY }, { label: "Saving & investing", value: saved, color: MINT }]} /></Card>
              )}
              {show("income_chart") && <Card><SectionTitle title="Income sources" sub="This month" /><DonutChart data={d.income_breakdown.map((c) => ({ name: c.category, value: c.amount }))} centerLabel="earned" /></Card>}
              {show("recent") && (
                <Card>
                  <SectionTitle title="Recent activity" right={<Link href="/transactions" className="text-xs text-primary">View all</Link>} />
                  {!d.recent_transactions.length ? (
                    <div className="py-6 text-center text-sm text-muted-foreground">No transactions yet. <Button size="sm" className="ml-2" onClick={() => openAdd()}>Add one</Button></div>
                  ) : (
                    <VerticalTimeline items={d.recent_transactions.map((t) => ({
                      title: t.description || t.category || t.type, sub: `${fmtDate(t.date)} · ${t.category ?? (t.type === "transfer" ? "Transfer" : "Uncategorized")}`,
                      value: `${t.type === "income" ? "+" : t.type === "expense" ? "−" : ""}${money(t.amount)}`, positive: t.type === "income",
                      color: t.type === "income" ? MINT : t.type === "expense" ? CORAL : SKY }))} />
                  )}
                </Card>
              )}
              {show("stocks") && <StocksWidget />}
              {show("news") && <NewsWidget />}
            </div>
          </div>
        );
      }}</Async>
    </>
  );
}
