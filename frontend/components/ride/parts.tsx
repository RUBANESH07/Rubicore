"use client";
import { Gauge, MapPin, Navigation, Pause, Play, Route, Square, Timer } from "lucide-react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Empty } from "@/components/common/states";
import { Badge, Button, Card } from "@/components/ui";
import { MINT, PINK, SKY, cn, fmtDate } from "@/lib/utils";
import { Parking, Ride, clock, duration, km, kmh, place, timeOf } from "@/lib/ride";
import type { Signal } from "@/hooks/useRideTracker";

export const DashboardCard = ({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon?: React.ReactNode }) => (
  <Card className="transition hover:shadow-md">
    <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">{label}{icon}</div>
    <div className="mt-1 text-2xl font-bold tracking-tight tabular-nums">{value}</div>
    {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
  </Card>
);

export function LiveSpeedCard({ speed, max, avg }: { speed: number; max: number; avg?: number }) {
  return (
    <Card className="bg-gradient-to-br from-primary/10 to-transparent text-center">
      <div className="flex items-center justify-center gap-1 text-xs font-medium text-muted-foreground"><Gauge className="h-3.5 w-3.5" />Speed</div>
      <div className="text-6xl font-bold tabular-nums tracking-tight">{Math.round(speed)}</div>
      <div className="text-sm text-muted-foreground">km/h</div>
      <div className="mt-2 flex justify-center gap-4 text-xs text-muted-foreground"><span>Max {Math.round(max)}</span>{avg != null && <span>Avg {Math.round(avg)}</span>}</div>
    </Card>
  );
}

export const DistanceCard = ({ km: v, label = "Distance" }: { km: number; label?: string }) => (
  <Card className="text-center">
    <div className="flex items-center justify-center gap-1 text-xs font-medium text-muted-foreground"><Route className="h-3.5 w-3.5" />{label}</div>
    <div className="text-4xl font-bold tabular-nums tracking-tight">{v.toFixed(2)}</div>
    <div className="text-sm text-muted-foreground">km</div>
  </Card>
);

export const RideTimer = ({ seconds, paused }: { seconds: number; paused?: boolean }) => (
  <Card className="text-center">
    <div className="flex items-center justify-center gap-1 text-xs font-medium text-muted-foreground"><Timer className="h-3.5 w-3.5" />{paused ? "Paused" : "Ride time"}</div>
    <div className={cn("font-mono text-4xl font-bold tabular-nums tracking-tight", paused && "text-warning")}>{clock(seconds)}</div>
    <div className="text-sm text-muted-foreground">hh:mm:ss</div>
  </Card>
);

export const StartRideButton = ({ onClick, busy, label = "Start ride", size = "lg" }: { onClick: () => void; busy?: boolean; label?: string; size?: "lg" | "md" }) => (
  <Button onClick={onClick} disabled={busy} className={cn("bg-success text-white hover:bg-success/90", size === "lg" ? "h-14 px-8 text-base" : "")}>
    <Play className="h-5 w-5" />{busy ? "Starting…" : label}
  </Button>
);

export const StopRideButton = ({ onClick, busy }: { onClick: () => void; busy?: boolean }) => (
  <Button variant="danger" onClick={onClick} disabled={busy} className="h-14 px-8 text-base"><Square className="h-5 w-5" />{busy ? "Saving…" : "Stop ride"}</Button>
);

export const PauseButton = ({ paused, onClick }: { paused: boolean; onClick: () => void }) => (
  <Button variant="outline" onClick={onClick} className="h-14 px-8 text-base">{paused ? <><Play className="h-5 w-5" />Resume</> : <><Pause className="h-5 w-5" />Pause</>}</Button>
);

const SIGNAL: Record<Signal, { tone: "muted" | "success" | "warning" | "danger"; text: string }> = {
  none: { tone: "muted", text: "GPS idle" }, searching: { tone: "warning", text: "Searching for GPS…" }, good: { tone: "success", text: "Strong GPS" },
  fair: { tone: "warning", text: "Fair GPS" }, poor: { tone: "danger", text: "Weak GPS" }, lost: { tone: "danger", text: "GPS signal lost" },
};
export const SignalBadge = ({ signal, accuracy }: { signal: Signal; accuracy?: number | null }) => (
  <Badge tone={SIGNAL[signal].tone}>{SIGNAL[signal].text}{accuracy != null && signal !== "none" && signal !== "lost" ? ` · ±${Math.round(accuracy)} m` : ""}</Badge>
);

export function RideHistoryTable({ rides, onDelete }: { rides: Ride[]; onDelete?: (r: Ride) => void }) {
  if (!rides.length) return <Empty text="No rides in this period." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b text-left text-xs text-muted-foreground">
          <tr><th className="p-3">Date</th><th className="p-3">Time</th><th className="hidden p-3 md:table-cell">From → To</th><th className="p-3 text-right">Distance</th><th className="hidden p-3 text-right sm:table-cell">Duration</th><th className="p-3 text-right">Avg</th><th className="hidden p-3 text-right sm:table-cell">Max</th></tr>
        </thead>
        <tbody className="divide-y">
          {rides.map((r) => (
            <tr key={r.id} className="hover:bg-muted/50">
              <td className="whitespace-nowrap p-3"><Link href={`/ride/history/${r.id}`} className="font-medium text-primary hover:underline">{fmtDate(r.date)}</Link>{r.title && <div className="text-xs text-muted-foreground">{r.title}</div>}</td>
              <td className="whitespace-nowrap p-3 text-muted-foreground">{timeOf(r.started_at)}–{timeOf(r.ended_at)}</td>
              <td className="hidden max-w-[16rem] truncate p-3 text-muted-foreground md:table-cell">{place(r.start_label, r.start_latitude, r.start_longitude)} → {place(r.end_label, r.end_latitude, r.end_longitude)}</td>
              <td className="p-3 text-right font-medium tabular-nums">{km(r.total_distance_km)}</td>
              <td className="hidden p-3 text-right tabular-nums sm:table-cell">{duration(r.duration_seconds)}</td>
              <td className="p-3 text-right tabular-nums">{kmh(r.average_speed_kmh)}</td>
              <td className="hidden p-3 text-right tabular-nums sm:table-cell">{kmh(r.maximum_speed_kmh)}</td>
              {onDelete && <td className="p-3"><button className="text-xs text-danger" onClick={() => onDelete(r)}>Delete</button></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const axis = { stroke: "hsl(var(--muted-foreground))", fontSize: 11, tickLine: false, axisLine: false } as const;
const tip = { contentStyle: { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 } };

type Series = { key: string; name: string; color?: string };
/** One chart component for every analytics view: bars or lines, one or more series. */
export function AnalyticsChart({ data, xKey, series, kind = "bar", height = 240, unit = "", empty = "No data for this period." }:
  { data: any[]; xKey: string; series: Series[]; kind?: "bar" | "line"; height?: number; unit?: string; empty?: string }) {
  if (!data.length || data.every((d) => series.every((s) => !d[s.key]))) return <Empty text={empty} />;
  const palette = [PINK, SKY, MINT];
  const C = kind === "bar" ? BarChart : LineChart;
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <C data={data} margin={{ left: -12, right: 4 }}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey={xKey} {...axis} interval="preserveStartEnd" tickFormatter={(v) => (String(v).length === 10 && String(v)[4] === "-" ? String(v).slice(5) : v)} />
          <YAxis {...axis} />
          <Tooltip {...tip} formatter={(v: number) => `${v}${unit}`} />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {series.map((s, i) => kind === "bar"
            ? <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color ?? palette[i % 3]} radius={[3, 3, 0, 0]} />
            : <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color ?? palette[i % 3]} strokeWidth={2} dot={false} />)}
        </C>
      </ResponsiveContainer>
    </div>
  );
}

export function ParkingLocationCard({ p, onCollected, onNote }: { p: Parking; onCollected?: () => void; onNote?: () => void }) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5 text-sm font-semibold"><MapPin className="h-4 w-4 text-warning" />Parked here</div>
          <p className="text-xs text-muted-foreground">Saved {new Date(p.saved_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}{p.accuracy_m != null && ` · ±${Math.round(p.accuracy_m)} m`}</p>
        </div>
        <Badge tone="warning">Current</Badge>
      </div>
      <p className="mt-2 text-sm">{p.note || <span className="text-muted-foreground">No note</span>}</p>
      <p className="mt-1 font-mono text-xs text-muted-foreground">{p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={p.navigate_url} target="_blank" rel="noopener noreferrer"><Button size="sm"><Navigation className="h-4 w-4" />Navigate back</Button></a>
        {onNote && <Button size="sm" variant="outline" onClick={onNote}>Edit note</Button>}
        {onCollected && <Button size="sm" variant="outline" onClick={onCollected}>I've collected my bike</Button>}
      </div>
    </Card>
  );
}
