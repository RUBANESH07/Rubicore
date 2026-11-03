"use client";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Async, Empty, PageHeader, SectionTitle } from "@/components/common/states";
import { AnalyticsChart, DashboardCard } from "@/components/ride/parts";
import { FuelEntryModal } from "@/components/ride/FuelEntryModal";
import { Badge, Button, Card, Input, Label, Select } from "@/components/ui";
import { useFetch } from "@/hooks/useApi";
import { useApp } from "@/hooks/useApp";
import { api } from "@/lib/api";
import { Bike, Fuel } from "@/lib/ride";
import { fmtDate, iso, money } from "@/lib/utils";

type Analytics = { total_spent: number; total_litres: number; entries: number; average_mileage_kmpl: number | null; cost_per_km: number | null; measured_distance_km: number; reliable: boolean; note: string | null;
  monthly: { label: string; amount: number }[]; segments: { from_date: string; to_date: string; distance_km: number; litres: number; mileage_kmpl: number; cost_per_km: number; gps_km: number }[] };
type Maint = { id: number; date: string; kind: string; odometer_km: number | null; cost: number; notes: string | null };

function Maintenance({ bikes }: { bikes: Bike[] }) {
  const list = useFetch<Maint[]>("/maintenance");
  const [f, setF] = useState({ date: iso(new Date()), kind: "", odometer: "", cost: "" });
  const [err, setErr] = useState("");
  return (
    <Card>
      <SectionTitle title="Maintenance log" sub="Services and repairs (kept separate from mileage)" />
      <form className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5" onSubmit={async (e) => { e.preventDefault(); setErr(""); try { await api.post("/maintenance", { date: f.date, kind: f.kind, odometer_km: f.odometer ? Number(f.odometer) : null, cost: Number(f.cost || 0), bike_id: bikes.find((b) => b.is_default)?.id ?? null }); setF({ ...f, kind: "", odometer: "", cost: "" }); list.reload(); } catch (e: any) { setErr(e.message); } }}>
        <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required aria-label="Date" /><Input placeholder="e.g. Oil change" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} required maxLength={80} aria-label="Service" />
        <Input type="number" placeholder="Odometer" value={f.odometer} onChange={(e) => setF({ ...f, odometer: e.target.value })} aria-label="Odometer" /><Input type="number" placeholder="Cost" min="0" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} aria-label="Cost" /><Button>Add</Button>
      </form>
      {err && <p className="mb-2 text-sm text-danger">{err}</p>}
      <Async state={list} empty={(d) => !d.length && "No maintenance recorded."}>{(d) => <ul className="divide-y text-sm">{d.map((m) => (
        <li key={m.id} className="flex items-center justify-between py-2"><span><b>{m.kind}</b> <span className="text-muted-foreground">{fmtDate(m.date)}{m.odometer_km ? ` · ${m.odometer_km} km` : ""}</span></span>
          <span className="flex items-center gap-3">{money(m.cost)}<button aria-label="Delete" className="text-muted-foreground hover:text-danger" onClick={async () => { await api.del(`/maintenance/${m.id}`); list.reload(); }}><Trash2 className="h-4 w-4" /></button></span></li>))}</ul>}</Async>
    </Card>
  );
}

export default function FuelPage() {
  const { version } = useApp();
  const [bikeId, setBikeId] = useState("");
  const bikes = useFetch<Bike[]>("/bikes");
  const fuel = useFetch<Fuel[]>(`/fuel?${bikeId ? `bike_id=${bikeId}&` : ""}v=${version}`);
  const an = useFetch<Analytics>(`/fuel/analytics?${bikeId ? `bike_id=${bikeId}&` : ""}v=${version}`);
  const [modal, setModal] = useState<{ open: boolean; editing?: Fuel | null }>({ open: false });
  const bikeList = bikes.data ?? [];
  const reload = () => { fuel.reload(); an.reload(); };

  return (
    <>
      <PageHeader title="Fuel & mileage" sub="Manual fuel entries. Mileage uses full-tank to full-tank odometer readings, never GPS guesses."
        right={<div className="flex gap-2">{bikeList.length > 1 && <Select className="w-40" value={bikeId} onChange={(e) => setBikeId(e.target.value)}><option value="">All bikes</option>{bikeList.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}
          <Button onClick={() => setModal({ open: true })}><Plus className="h-4 w-4" />Add fuel entry</Button></div>} />
      <div className="space-y-4">
        <Async state={an}>{(a) => (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <DashboardCard label="Total petrol expenses" value={money(a.total_spent)} sub={`${a.entries} fill-ups`} /><DashboardCard label="Litres purchased" value={`${a.total_litres} L`} />
              <DashboardCard label="Average mileage" value={a.average_mileage_kmpl ? `${a.average_mileage_kmpl} km/l` : "—"} sub={a.reliable ? `from ${a.measured_distance_km} km, full-to-full` : "not enough data"} />
              <DashboardCard label="Fuel cost per km" value={a.cost_per_km ? money(a.cost_per_km, { maximumFractionDigits: 2 }) : "—"} />
            </div>
            {!a.reliable && a.note && <Card className="border-warning/40 bg-warning/5 text-sm">{a.note}</Card>}
            <div className="grid gap-4 lg:grid-cols-2">
              <Card><SectionTitle title="Monthly fuel spending" /><AnalyticsChart data={a.monthly} xKey="label" series={[{ key: "amount", name: "Spend", color: "hsl(var(--warning))" }]} empty="No fuel entries yet." /></Card>
              <Card><SectionTitle title="Mileage between full tanks" />
                {a.segments.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1">Period</th><th>km (odometer)</th><th>Litres</th><th>km/l</th><th>GPS km</th></tr></thead>
                  <tbody className="divide-y">{[...a.segments].reverse().map((s, i) => <tr key={i}><td className="py-1.5">{fmtDate(s.from_date)} → {fmtDate(s.to_date)}</td><td className="tabular-nums">{s.distance_km}</td><td className="tabular-nums">{s.litres}</td><td className="font-medium tabular-nums">{s.mileage_kmpl}</td><td className="tabular-nums text-muted-foreground">{s.gps_km}</td></tr>)}</tbody></table>
                  <p className="mt-2 text-xs text-muted-foreground">GPS km is shown only as a cross-check of the odometer; it is never used to estimate fuel use.</p></div> : <Empty text="Add two full-tank fill-ups to see mileage." />}</Card>
            </div>
          </>
        )}</Async>
        <Card className="p-0">
          <div className="p-4 pb-0"><SectionTitle title="Fuel entries" /></div>
          <Async state={fuel} empty={(d) => !d.length && "No fuel entries yet. Add your first fill-up."}>{(d) => (
            <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="border-b text-left text-xs text-muted-foreground"><tr><th className="p-3">Date</th><th className="p-3">Odometer</th><th className="p-3">Litres</th><th className="p-3">₹/L</th><th className="p-3">Total</th><th className="hidden p-3 md:table-cell">Station</th><th className="p-3" /></tr></thead>
              <tbody className="divide-y">{d.map((e) => (
                <tr key={e.id} className="hover:bg-muted/50"><td className="whitespace-nowrap p-3">{fmtDate(e.date)}</td><td className="p-3 tabular-nums">{e.odometer_km.toLocaleString("en-IN")} km</td><td className="p-3 tabular-nums">{e.litres} {e.is_full_tank ? <Badge tone="success">full</Badge> : <Badge>partial</Badge>}</td>
                  <td className="p-3 tabular-nums">{e.price_per_litre.toFixed(2)}</td><td className="p-3 font-medium tabular-nums">{money(e.total_amount, { maximumFractionDigits: 2 })}{e.transaction_id && <span title="Recorded in RubiCore expenses" className="ml-1 text-xs text-muted-foreground">· in expenses</span>}</td>
                  <td className="hidden p-3 text-muted-foreground md:table-cell">{e.station || "—"}</td>
                  <td className="p-3 text-right whitespace-nowrap"><button aria-label="Edit" className="mr-2 text-muted-foreground hover:text-foreground" onClick={() => setModal({ open: true, editing: e })}><Pencil className="h-4 w-4" /></button>
                    <button aria-label="Delete" className="text-muted-foreground hover:text-danger" onClick={async () => { if (confirm(e.transaction_id ? "Delete this fuel entry and its linked expense?" : "Delete this fuel entry?")) { await api.del(`/fuel/${e.id}`); reload(); } }}><Trash2 className="h-4 w-4" /></button></td></tr>))}</tbody></table></div>
          )}</Async>
        </Card>
        <Maintenance bikes={bikeList} />
      </div>
      <FuelEntryModal open={modal.open} editing={modal.editing} bikes={bikeList} lastOdometer={fuel.data?.[0]?.odometer_km} onClose={() => setModal({ open: false })} onSaved={reload} />
    </>
  );
}
