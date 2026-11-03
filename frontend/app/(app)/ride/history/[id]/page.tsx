"use client";
import { ArrowLeft, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Async, Empty, PageHeader, SectionTitle } from "@/components/common/states";
import { RideMap } from "@/components/ride/RideMap";
import { DashboardCard } from "@/components/ride/parts";
import { Badge, Button, Card, Input, Label } from "@/components/ui";
import { useFetch } from "@/hooks/useApi";
import { api } from "@/lib/api";
import { RideDetail, duration, km, kmh, place, timeOf } from "@/lib/ride";
import { fmtDate } from "@/lib/utils";

type PointRow = { id: number; latitude: number; longitude: number; recorded_at: string; speed_kmh: number | null; computed_speed_kmh: number | null; accuracy_m: number | null; accepted: boolean; reject_reason: string | null };

function Points({ id }: { id: number }) {
  const [page, setPage] = useState(0);
  const [bad, setBad] = useState(false);
  const pts = useFetch<{ total: number; items: PointRow[] }>(`/rides/${id}/points?offset=${page * 50}&limit=50${bad ? "&rejected_only=true" : ""}`);
  return (
    <Card>
      <SectionTitle title="GPS points" sub="Every stored fix, including ones the engine ignored" right={<label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={bad} onChange={(e) => { setBad(e.target.checked); setPage(0); }} />Ignored only</label>} />
      <Async state={pts} empty={(d) => !d.items.length && "No points."}>{(d) => (
        <>
          <div className="overflow-x-auto"><table className="w-full text-xs"><thead className="text-left text-muted-foreground"><tr><th className="py-1">Time</th><th>Latitude</th><th>Longitude</th><th>Speed</th><th>Accuracy</th><th>Status</th></tr></thead>
            <tbody className="divide-y font-mono">{d.items.map((p) => (
              <tr key={p.id} className={p.accepted ? "" : "text-muted-foreground"}><td className="py-1">{new Date(p.recorded_at).toLocaleTimeString("en-IN")}</td><td>{p.latitude.toFixed(5)}</td><td>{p.longitude.toFixed(5)}</td>
                <td>{(p.computed_speed_kmh ?? p.speed_kmh) != null ? Math.round((p.computed_speed_kmh ?? p.speed_kmh) as number) : "—"}</td><td>{p.accuracy_m != null ? `±${Math.round(p.accuracy_m)}m` : "—"}</td>
                <td className="font-sans">{p.accepted ? <Badge tone="success">counted</Badge> : <Badge tone="warning">{p.reject_reason}</Badge>}</td></tr>
            ))}</tbody></table></div>
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground"><span>{d.total} points</span>
            <div className="flex gap-2"><button className="rounded border px-2 py-1 disabled:opacity-40" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
              <button className="rounded border px-2 py-1 disabled:opacity-40" disabled={(page + 1) * 50 >= d.total} onClick={() => setPage(page + 1)}>Next</button></div></div>
        </>
      )}</Async>
    </Card>
  );
}

export default function RideDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const ride = useFetch<RideDetail>(`/rides/${id}`);
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ title: "", start_label: "", end_label: "" });

  return (
    <Async state={ride}>{(r) => {
      const track = r.track.map((p) => [p[0], p[1]] as [number, number]);
      const startedMs = new Date(r.started_at).getTime();
      const profile = r.speed_profile.map((p) => ({ minute: Math.round(((p.t * 1000 - startedMs) / 60000) * 10) / 10, speed: Math.round(p.speed) }));
      const s = r.statistics;
      return (
        <>
          <PageHeader title={r.title || `Ride on ${fmtDate(r.date)}`} sub={`${timeOf(r.started_at)} – ${timeOf(r.ended_at)} · ${place(r.start_label, r.start_latitude, r.start_longitude)} → ${place(r.end_label, r.end_latitude, r.end_longitude)}`}
            right={<div className="flex gap-2"><Link href="/ride/history"><Button variant="outline" size="sm"><ArrowLeft className="h-4 w-4" />History</Button></Link>
              <Button variant="outline" size="sm" onClick={() => { setF({ title: r.title, start_label: r.start_label, end_label: r.end_label }); setEditing(!editing); }}>Edit names</Button>
              <Button variant="outline" size="sm" onClick={async () => { await api.post(`/rides/${r.id}/reprocess`); ride.reload(); }}>Reprocess</Button>
              <Button variant="danger" size="sm" onClick={async () => { if (confirm("Delete this ride and all its GPS points?")) { await api.del(`/rides/${r.id}`); router.push("/ride/history"); } }}><Trash2 className="h-4 w-4" /></Button></div>} />
          {editing && (
            <Card className="mb-3 grid gap-3 sm:grid-cols-4">
              <div><Label>Title</Label><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={160} /></div>
              <div><Label>Start location</Label><Input value={f.start_label} onChange={(e) => setF({ ...f, start_label: e.target.value })} maxLength={200} /></div>
              <div><Label>Destination</Label><Input value={f.end_label} onChange={(e) => setF({ ...f, end_label: e.target.value })} maxLength={200} /></div>
              <div className="flex items-end"><Button className="w-full" onClick={async () => { await api.put(`/rides/${r.id}`, f); setEditing(false); ride.reload(); }}>Save</Button></div>
            </Card>
          )}
          <div className="space-y-4">
            {track.length > 1 ? <RideMap height={420} tracks={[{ coords: track }]} markers={[
              ...(r.start_latitude != null ? [{ lat: r.start_latitude, lon: r.start_longitude as number, kind: "start" as const, label: "Start" }] : []),
              ...(r.end_latitude != null ? [{ lat: r.end_latitude, lon: r.end_longitude as number, kind: "end" as const, label: "End" }] : [])]} /> : <Card><Empty text="No route points were recorded for this ride." /></Card>}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <DashboardCard label="Distance" value={km(r.total_distance_km, 2)} sub={s ? `raw GPS sum ${km(s.raw_distance_km, 2)}` : undefined} /><DashboardCard label="Duration" value={duration(r.duration_seconds)} sub={r.paused_seconds ? `+ ${duration(r.paused_seconds)} paused` : undefined} />
              <DashboardCard label="Average speed" value={kmh(r.average_speed_kmh)} sub={s ? `${kmh(s.moving_average_speed_kmh)} while moving` : undefined} /><DashboardCard label="Max speed" value={kmh(r.maximum_speed_kmh)} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card><SectionTitle title="Speed over time" sub="Minutes since start" />
                {profile.length > 1 ? <div style={{ height: 220 }}><ResponsiveContainer><AreaChart data={profile} margin={{ left: -12, right: 4 }}><CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="minute" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} unit="m" /><YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => `${v} km/h`} />
                  <Area type="monotone" dataKey="speed" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.15} strokeWidth={2} /></AreaChart></ResponsiveContainer></div> : <Empty text="Not enough points." />}</Card>
              <Card><SectionTitle title="Trip timeline" />
                <ol className="space-y-2 text-sm">{r.events.map((e, i) => <li key={i} className="flex justify-between"><span className="capitalize">{e.type === "start" ? "Ride started" : e.type === "stop" ? "Ride finished" : e.type === "pause" ? "Paused" : "Resumed"}</span><span className="text-muted-foreground">{new Date(e.at).toLocaleTimeString("en-IN")}</span></li>)}</ol>
                {s && <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 border-t pt-3 text-sm">
                  <dt className="text-muted-foreground">Moving time</dt><dd className="text-right">{duration(s.moving_seconds)}</dd><dt className="text-muted-foreground">Stopped time</dt><dd className="text-right">{duration(s.stationary_seconds)}</dd>
                  <dt className="text-muted-foreground">GPS points counted</dt><dd className="text-right">{s.accepted_points}</dd><dt className="text-muted-foreground">Points ignored</dt><dd className="text-right">{s.rejected_points}{Object.keys(s.rejected_by_reason).length ? ` (${Object.entries(s.rejected_by_reason).map(([k, v]) => `${v} ${k.replace("_", " ")}`).join(", ")})` : ""}</dd>
                  <dt className="text-muted-foreground">Signal gaps</dt><dd className="text-right">{s.gap_count}</dd><dt className="text-muted-foreground">Elevation gain</dt><dd className="text-right">{Math.round(s.elevation_gain_m)} m</dd></dl>}
                {s?.points_compacted && <p className="mt-2 text-xs text-muted-foreground">Older GPS points were thinned to a simplified route to save space; totals are unchanged.</p>}
              </Card>
            </div>
            <Points id={r.id} />
          </div>
        </>
      );
    }}</Async>
  );
}
