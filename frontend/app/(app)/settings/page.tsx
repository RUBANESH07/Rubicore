"use client";
import { Async, PageHeader, SectionTitle } from "@/components/common/states";
import { FaceLockCard } from "@/components/common/FaceLockCard";
import { Badge, Card, Switch } from "@/components/ui";
import { useFetch } from "@/hooks/useApi";
import { useApp } from "@/hooks/useApp";
import { api } from "@/lib/api";

type Mod = { key: string; name: string; enabled: boolean; available: boolean; core?: boolean };
const WIDGET_LABELS: Record<string, string> = {
  balance: "Balance & summary cards", ai_summary: "AI daily summary", cashflow: "Cash flow chart", expense_chart: "Expense donut",
  funnel: "Money funnel", ratio: "Savings rate ring & unit chart", budget_rings: "Budget rings", radar: "Spending radar (vs last month)",
  heatmap: "Spending heatmap calendar", treemap: "Spending treemap", pyramid: "Needs / wants / saving pyramid",
  income_chart: "Income sources donut", recent: "Recent activity timeline", stocks: "Market overview", news: "Latest news",
};

export default function SettingsPage() {
  const { user, refreshMeta } = useApp();
  const mods = useFetch<Mod[]>("/modules");
  const widgets = useFetch<{ widgets: { key: string; visible: boolean }[] }>("/settings/dashboard");
  return (
    <>
      <PageHeader title="Settings" sub="Modules, face lock and dashboard widgets." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle title="Profile" />
          <dl className="grid grid-cols-[6rem_1fr] gap-y-1.5 text-sm"><dt className="text-muted-foreground">Name</dt><dd>{user.name}</dd><dt className="text-muted-foreground">Currency</dt><dd>{user.currency}</dd></dl>
        </Card>
        <Card>
          <SectionTitle title="Dashboard widgets" sub="Choose what appears on your Overview." />
          <Async state={widgets}>{(d) => (
            <ul className="space-y-2.5">{d.widgets.map((w) => (
              <li key={w.key} className="flex items-center justify-between text-sm">{WIDGET_LABELS[w.key] ?? w.key}
                <Switch checked={w.visible} onChange={async (v) => {
                  const hidden = d.widgets.filter((x) => (x.key === w.key ? !v : !x.visible)).map((x) => x.key);
                  await api.put("/settings/dashboard", { hidden }); widgets.reload();
                }} /></li>
            ))}</ul>
          )}</Async>
        </Card>
        <FaceLockCard />
        <Card className="lg:col-span-2">
          <SectionTitle title="Modules" sub="Each module is independently configurable. Planned modules appear as they are built." />
          <Async state={mods}>{(d) => (
            <ul className="grid gap-x-8 gap-y-2.5 md:grid-cols-2">{d.map((m) => (
              <li key={m.key} className="flex items-center justify-between text-sm">
                <span>{m.name} {m.core && <Badge>core</Badge>} {!m.available && <Badge tone="muted">coming soon</Badge>}</span>
                <Switch checked={m.enabled} disabled={!m.available || m.core} onChange={async (v) => { await api.put(`/modules/${m.key}`, { enabled: v }); mods.reload(); refreshMeta(); }} />
              </li>
            ))}</ul>
          )}</Async>
        </Card>
      </div>
    </>
  );
}
