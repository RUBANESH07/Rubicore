"use client";
import { useState } from "react";
import { Async, PageHeader, SectionTitle } from "@/components/common/states";
import { RideMap } from "@/components/ride/RideMap";
import { Badge, Card, Tabs } from "@/components/ui";
import { useFetch } from "@/hooks/useApi";
import { Ride, km, place } from "@/lib/ride";
import { fmtDate, PALETTE } from "@/lib/utils";
import Link from "next/link";

type Data = { rides: (Ride & { track: [number, number, number][] })[]; popular_routes: { count: number; total_km: number; avg_km: number; start: string; end: string; ride_ids: number[] }[] };

export default function RouteMaps() {
  const [preset, setPreset] = useState<"7d" | "30d">("30d");
  const [pick, setPick] = useState<number | null>(null);
  const data = useFetch<Data>(`/rides/routes?preset=${preset}`);
  return (
    <>
      <PageHeader title="Route maps" sub="Your rides overlaid on one map" right={<Tabs value={preset} onChange={setPreset} tabs={[{ id: "7d", label: "Last 7 days" }, { id: "30d", label: "Last 30 days" }]} />} />
      <Async state={data} empty={(d) => !d.rides.length && "No rides in this period yet."}>{(d) => {
        const shown = pick ? d.rides.filter((r) => r.id === pick) : d.rides;
        return (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <RideMap height={520} tracks={shown.map((r, i) => ({ id: r.id, coords: r.track.map((p) => [p[0], p[1]] as [number, number]), color: pick ? "#2563eb" : PALETTE[i % PALETTE.length], weight: pick ? 6 : 3, opacity: pick ? 1 : 0.7 }))} />
            </div>
            <div className="space-y-4">
              <Card>
                <SectionTitle title="Most travelled routes" sub="Grouped by start and end area" />
                {d.popular_routes.length ? <ul className="space-y-2 text-sm">{d.popular_routes.map((g, i) => (
                  <li key={i} className="rounded-md border p-2"><div className="flex items-center justify-between"><span className="font-medium">{g.start} → {g.end}</span><Badge tone="primary">{g.count}×</Badge></div>
                    <div className="text-xs text-muted-foreground">avg {km(g.avg_km)} · {km(g.total_km)} total</div></li>))}</ul> : <p className="text-sm text-muted-foreground">Ride the same route a few times to see it here.</p>}
              </Card>
              <Card className="max-h-[22rem] overflow-y-auto">
                <SectionTitle title="Rides on the map" right={pick ? <button className="text-xs text-primary" onClick={() => setPick(null)}>Show all</button> : undefined} />
                <ul className="space-y-1">{d.rides.map((r, i) => (
                  <li key={r.id}><button onClick={() => setPick(pick === r.id ? null : r.id)} className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${pick === r.id ? "bg-muted" : ""}`}>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} /><span className="flex-1 truncate">{fmtDate(r.date)} · {place(r.start_label, r.start_latitude, r.start_longitude)}</span><span className="tabular-nums text-muted-foreground">{km(r.total_distance_km)}</span></button></li>))}</ul>
                {pick && <Link href={`/ride/history/${pick}`} className="mt-2 block text-xs text-primary">Open ride details</Link>}
              </Card>
            </div>
          </div>
        );
      }}</Async>
    </>
  );
}
