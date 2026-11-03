"use client";
import { useState } from "react";
import { Async, PageHeader, SectionTitle } from "@/components/common/states";
import { AnalyticsChart, DashboardCard } from "@/components/ride/parts";
import { Card, Input, Label, Tabs } from "@/components/ui";
import { useFetch } from "@/hooks/useApi";
import { duration, km, kmh } from "@/lib/ride";
import { iso, money } from "@/lib/utils";

type Tab = "daily" | "weekly" | "monthly" | "yearly";
const Routes = ({ routes }: { routes: any[] }) => (
  <Card><SectionTitle title="Most travelled routes" />
    {routes.length ? <ul className="divide-y text-sm">{routes.map((g, i) => <li key={i} className="flex items-center justify-between py-2"><span>{g.start} → {g.end}</span><span className="text-muted-foreground">{g.count}× · avg {km(g.avg_km)}</span></li>)}</ul> : <p className="text-sm text-muted-foreground">No repeated routes yet.</p>}</Card>
);

function Daily() {
  const [day, setDay] = useState(iso(new Date()));
  const d = useFetch<any>(`/ride-analytics/daily?day=${day}`);
  return <div className="space-y-4"><div className="max-w-[12rem]"><Label>Date</Label><Input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} /></div>
    <Async state={d}>{(x) => <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><DashboardCard label="Total distance" value={km(x.distance_km)} /><DashboardCard label="Rides" value={String(x.rides)} /><DashboardCard label="Total duration" value={duration(x.duration_seconds)} /><DashboardCard label="Average speed" value={kmh(x.average_speed_kmh)} /></div>}</Async></div>;
}
function Weekly() {
  const [day, setDay] = useState(iso(new Date()));
  const w = useFetch<any>(`/ride-analytics/weekly?day=${day}`);
  return <div className="space-y-4"><div className="max-w-[12rem]"><Label>Any day in the week</Label><Input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} /></div>
    <Async state={w}>{(x) => <><div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><DashboardCard label="Distance" value={km(x.distance_km)} sub={x.distance_change_pct != null ? `${x.distance_change_pct > 0 ? "▲" : "▼"} ${Math.abs(x.distance_change_pct)}% vs last week (${km(x.previous_week.distance_km)})` : "No rides last week"} />
      <DashboardCard label="Riding frequency" value={`${x.riding_days} / 7 days`} sub={`${x.rides} rides`} /><DashboardCard label="Riding hours" value={`${x.riding_hours} h`} /><DashboardCard label="Average speed" value={kmh(x.average_speed_kmh)} /></div>
      <Card><SectionTitle title="Distance by day (km)" /><AnalyticsChart data={x.daily} xKey="date" series={[{ key: "distance_km", name: "Distance (km)" }]} unit=" km" /></Card></>}</Async></div>;
}
function Monthly() {
  const n = new Date();
  const [ym, setYm] = useState(`${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`);
  const [y, m] = ym.split("-");
  const r = useFetch<any>(`/ride-analytics/monthly?year=${y}&month=${Number(m)}`);
  return <div className="space-y-4"><div className="max-w-[12rem]"><Label>Month</Label><Input type="month" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)} /></div>
    <Async state={r}>{(x) => <><div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><DashboardCard label="Total kilometres" value={km(x.distance_km)} /><DashboardCard label="Average daily distance" value={km(x.average_daily_km)} />
      <DashboardCard label="Fuel expenditure" value={money(x.fuel_spend)} sub={x.fuel_cost_per_km ? `${money(x.fuel_cost_per_km, { maximumFractionDigits: 2 })} per km` : undefined} />
      <DashboardCard label="Fuel efficiency" value={x.fuel_efficiency_kmpl ? `${x.fuel_efficiency_kmpl} km/l` : "—"} sub={x.fuel_efficiency_kmpl ? "full-to-full average" : "needs two full-tank fills"} /></div>
      <div className="grid gap-4 lg:grid-cols-2"><Card><SectionTitle title="Daily distance (km)" /><AnalyticsChart data={x.daily} xKey="date" series={[{ key: "distance_km", name: "Distance (km)" }]} unit=" km" /></Card><Routes routes={x.popular_routes} /></div></>}</Async></div>;
}
function Yearly() {
  const [year, setYear] = useState(new Date().getFullYear());
  const r = useFetch<any>(`/ride-analytics/yearly?year=${year}`);
  return <div className="space-y-4"><div className="max-w-[10rem]"><Label>Year</Label><Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} /></div>
    <Async state={r}>{(x) => <><div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><DashboardCard label="Annual kilometres" value={km(x.distance_km, 0)} /><DashboardCard label="Total rides" value={String(x.rides)} /><DashboardCard label="Annual fuel cost" value={money(x.fuel_cost)} /><DashboardCard label="Riding hours" value={`${x.riding_hours} h`} /></div>
      <div className="grid gap-4 lg:grid-cols-2"><Card><SectionTitle title="Distance by month (km)" /><AnalyticsChart data={x.months} xKey="label" series={[{ key: "distance_km", name: "Distance (km)" }]} unit=" km" /></Card>
        <Card><SectionTitle title="Riding trend" sub="Rides and average speed" /><AnalyticsChart kind="line" data={x.months} xKey="label" series={[{ key: "rides", name: "Rides" }, { key: "average_speed_kmh", name: "Avg km/h" }]} /></Card></div></>}</Async></div>;
}

export default function RideAnalytics() {
  const [tab, setTab] = useState<Tab>("monthly");
  return (
    <>
      <PageHeader title="Ride analytics" sub="Daily, weekly, monthly and yearly riding" right={<Tabs value={tab} onChange={setTab} tabs={[{ id: "daily", label: "Daily" }, { id: "weekly", label: "Weekly" }, { id: "monthly", label: "Monthly" }, { id: "yearly", label: "Yearly" }]} />} />
      {tab === "daily" && <Daily />}{tab === "weekly" && <Weekly />}{tab === "monthly" && <Monthly />}{tab === "yearly" && <Yearly />}
    </>
  );
}
