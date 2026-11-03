"use client";
import { Bike, Clock, Fuel, Gauge, Route, Zap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Async, PageHeader, SectionTitle } from "@/components/common/states";
import { AnalyticsChart, DashboardCard, RideHistoryTable, StartRideButton } from "@/components/ride/parts";
import { DonutChart, HeatmapCalendar, ProgressRing, RadarViz } from "@/components/charts/viz";
import { Card } from "@/components/ui";
import { useFetch } from "@/hooks/useApi";
import { useApp } from "@/hooks/useApp";
import { Ride, duration, km, kmh } from "@/lib/ride";
import { money } from "@/lib/utils";

type Overview = {
  cards: { today_km: number; week_km: number; month_km: number; total_rides: number; average_speed_kmh: number; max_speed_kmh: number; riding_seconds: number; fuel_total: number; fuel_month: number };
  daily_distance: any[]; weekly: any[]; monthly: any[]; fuel_trend: any[]; speed_trend: any[]; duration_trend: any[]; recent: Ride[];
};

export default function RideOverview() {
  const { version } = useApp();
  const router = useRouter();
  const ov = useFetch<Overview>(`/rides/overview?v=${version}`);
  return (
    <>
      <PageHeader title="RubiRide" sub="Bike & ride intelligence from your phone's GPS" right={<StartRideButton onClick={() => router.push("/ride/start")} label="Start new ride" size="md" />} />
      <Async state={ov} empty={(d) => d.cards.total_rides === 0 && "No rides yet. Start your first ride to see distance, speed and routes here."}>{(d) => (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <DashboardCard label="Today" value={km(d.cards.today_km)} icon={<Route className="h-4 w-4" />} />
            <DashboardCard label="This week" value={km(d.cards.week_km)} />
            <DashboardCard label="This month" value={km(d.cards.month_km)} />
            <DashboardCard label="Total rides" value={String(d.cards.total_rides)} icon={<Bike className="h-4 w-4" />} />
            <DashboardCard label="Average speed" value={kmh(d.cards.average_speed_kmh)} icon={<Gauge className="h-4 w-4" />} />
            <DashboardCard label="Max speed" value={kmh(d.cards.max_speed_kmh)} icon={<Zap className="h-4 w-4" />} />
            <DashboardCard label="Riding time" value={duration(d.cards.riding_seconds)} icon={<Clock className="h-4 w-4" />} />
            <DashboardCard label="Fuel spent" value={money(d.cards.fuel_total)} sub={`${money(d.cards.fuel_month)} this month`} icon={<Fuel className="h-4 w-4" />} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card><SectionTitle title="Daily distance" sub="Last 30 days (km)" /><AnalyticsChart data={d.daily_distance} xKey="date" series={[{ key: "distance_km", name: "Distance (km)" }]} unit=" km" /></Card>
            <Card><SectionTitle title="Weekly riding activity" sub="Last 8 weeks (km)" /><AnalyticsChart data={d.weekly} xKey="label" series={[{ key: "distance_km", name: "Distance (km)" }]} unit=" km" /></Card>
            <Card><SectionTitle title="Monthly distance comparison" sub="Last 12 months (km)" /><AnalyticsChart data={d.monthly} xKey="label" series={[{ key: "distance_km", name: "Distance (km)" }]} unit=" km" /></Card>
            <Card><SectionTitle title="Average speed trend" sub="Last 20 rides (km/h)" /><AnalyticsChart kind="line" data={d.speed_trend} xKey="label" series={[{ key: "average", name: "Average" }, { key: "max", name: "Max" }]} unit=" km/h" /></Card>
            <Card><SectionTitle title="Ride duration trend" sub="Last 20 rides (minutes)" /><AnalyticsChart kind="line" data={d.duration_trend} xKey="label" series={[{ key: "minutes", name: "Minutes" }]} unit=" min" /></Card>
            <Card><SectionTitle title="Fuel expense trend" sub="Last 12 months" /><AnalyticsChart data={d.fuel_trend} xKey="label" series={[{ key: "amount", name: "Fuel spend", color: "hsl(var(--warning))" }]} unit="" empty="No fuel entries yet." /></Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card><SectionTitle title="Riding calendar" sub="Darker = more km that day" /><HeatmapCalendar days={d.daily_distance.map((x: any) => ({ date: x.date, value: x.distance_km }))} unit=" km" fmt={(n) => n.toFixed(1)} /></Card>
            <Card><SectionTitle title="Riding by weekday" sub="Km over the last 30 days" />
              <RadarViz aName="Distance (km)" data={["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w, i) => ({ axis: w, a: Math.round(d.daily_distance.filter((x: any) => (new Date(x.date + "T00:00:00").getDay() + 6) % 7 === i).reduce((s: number, x: any) => s + x.distance_km, 0)) }))} height={240} /></Card>
            <Card><SectionTitle title="Speed bands" sub="Last 20 rides by average speed" />
              <DonutChart fmt={(n) => `${n} rides`} centerLabel="rides" height={190} data={[
                { name: "Under 25 km/h", value: d.speed_trend.filter((r: any) => r.average < 25).length }, { name: "25 to 35", value: d.speed_trend.filter((r: any) => r.average >= 25 && r.average < 35).length },
                { name: "35 to 45", value: d.speed_trend.filter((r: any) => r.average >= 35 && r.average < 45).length }, { name: "45 and above", value: d.speed_trend.filter((r: any) => r.average >= 45).length }]} /></Card>
          </div>
          <Card className="p-0">
            <div className="p-4 pb-0"><SectionTitle title="Recent rides" right={<Link href="/ride/history" className="text-xs text-primary">View all</Link>} /></div>
            <RideHistoryTable rides={d.recent} />
          </Card>
        </div>
      )}</Async>
    </>
  );
}
