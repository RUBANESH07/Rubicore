"use client";
import { useState } from "react";
import { Async, PageHeader } from "@/components/common/states";
import { DashboardCard, RideHistoryTable } from "@/components/ride/parts";
import { Card, Input, Label, Tabs } from "@/components/ui";
import { useFetch } from "@/hooks/useApi";
import { api, qs } from "@/lib/api";
import { Ride, duration, km, kmh } from "@/lib/ride";
import { useApp } from "@/hooks/useApp";

type Preset = "today" | "yesterday" | "7d" | "30d" | "custom";
const PAGE = 25;

export default function RideHistory() {
  const { bump, version } = useApp();
  const [preset, setPreset] = useState<Preset>("30d");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [page, setPage] = useState(0);
  const path = `/rides${qs({ preset, start: preset === "custom" ? start : "", end: preset === "custom" ? end : "", limit: PAGE, offset: page * PAGE })}&v=${version}`;
  const list = useFetch<{ items: Ride[]; total: number; totals: { rides: number; distance_km: number; duration_seconds: number; average_speed_kmh: number; max_speed_kmh: number } }>(path);

  return (
    <>
      <PageHeader title="Ride history" sub="Every saved trip. Open one to see its route."
        right={<Tabs value={preset} onChange={(p) => { setPreset(p); setPage(0); }} tabs={[{ id: "today", label: "Today" }, { id: "yesterday", label: "Yesterday" }, { id: "7d", label: "Last 7 days" }, { id: "30d", label: "Last 30 days" }, { id: "custom", label: "Custom" }]} />} />
      {preset === "custom" && (
        <Card className="mb-3 grid max-w-md grid-cols-2 gap-3"><div><Label>From</Label><Input type="date" value={start} onChange={(e) => { setStart(e.target.value); setPage(0); }} /></div><div><Label>To</Label><Input type="date" value={end} onChange={(e) => { setEnd(e.target.value); setPage(0); }} /></div></Card>
      )}
      <Async state={list}>{(d) => (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <DashboardCard label="Rides" value={String(d.totals.rides)} /><DashboardCard label="Distance" value={km(d.totals.distance_km)} />
            <DashboardCard label="Riding time" value={duration(d.totals.duration_seconds)} /><DashboardCard label="Avg / max speed" value={`${Math.round(d.totals.average_speed_kmh)} / ${Math.round(d.totals.max_speed_kmh)}`} sub="km/h" />
          </div>
          <Card className="p-0">
            <RideHistoryTable rides={d.items} onDelete={async (r) => { if (confirm(`Delete this ${km(r.total_distance_km)} ride and its GPS points? This can't be undone.`)) { await api.del(`/rides/${r.id}`); bump(); } }} />
            {d.total > PAGE && (
              <div className="flex items-center justify-between border-t p-3 text-sm text-muted-foreground"><span>{d.total} rides</span>
                <div className="flex gap-2"><button className="rounded border px-3 py-1 disabled:opacity-40" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
                  <button className="rounded border px-3 py-1 disabled:opacity-40" disabled={(page + 1) * PAGE >= d.total} onClick={() => setPage(page + 1)}>Next</button></div></div>
            )}
          </Card>
        </div>
      )}</Async>
    </>
  );
}
