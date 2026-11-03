"use client";
import { MapPin, ShieldCheck, Smartphone } from "lucide-react";
import { useState } from "react";
import { Async, PageHeader, SectionTitle } from "@/components/common/states";
import { Badge, Button, Card, Dialog, Input, Label, Switch } from "@/components/ui";
import { useFetch } from "@/hooks/useApi";
import { api } from "@/lib/api";
import type { Bike } from "@/lib/ride";

type Prefs = { distance_unit: string; max_accuracy_m: number; reverse_geocode: boolean; retention_days: number | null; keep_screen_on: boolean };
const blank = { name: "", make: "", model: "", year: "", registration: "", is_default: false, tank: "", mileage: "", odo: "", service: "" };

function Bikes() {
  const bikes = useFetch<Bike[]>("/bikes");
  const [edit, setEdit] = useState<{ id?: number } & typeof blank | null>(null);
  const [err, setErr] = useState("");
  const num = (v: string) => (v === "" ? null : Number(v));
  async function save() {
    if (!edit) return;
    setErr("");
    const body = { name: edit.name, make: edit.make, model: edit.model, year: num(edit.year), registration: edit.registration, is_default: edit.is_default,
      tank_capacity_l: num(edit.tank), expected_mileage_kmpl: num(edit.mileage), initial_odometer_km: num(edit.odo), service_interval_km: num(edit.service) };
    try { edit.id ? await api.put(`/bikes/${edit.id}`, body) : await api.post("/bikes", body); setEdit(null); bikes.reload(); } catch (e: any) { setErr(e.message); }
  }
  return (
    <Card>
      <SectionTitle title="Bikes" right={<Button size="sm" onClick={() => setEdit({ ...blank })}>Add bike</Button>} />
      <Async state={bikes} empty={(d) => !d.length && "No bikes yet. Add one to track mileage per bike."}>{(d) => (
        <ul className="divide-y">{d.map((b) => (
          <li key={b.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
            <div><span className="font-medium">{b.name}</span> {b.is_default && <Badge tone="primary">default</Badge>}<div className="text-xs text-muted-foreground">{[b.make, b.model, b.year, b.registration].filter(Boolean).join(" · ") || "—"}{b.tank_capacity_l ? ` · ${b.tank_capacity_l} L tank` : ""}</div></div>
            <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setEdit({ id: b.id, name: b.name, make: b.make, model: b.model, year: b.year ? String(b.year) : "", registration: b.registration, is_default: b.is_default,
              tank: b.tank_capacity_l?.toString() ?? "", mileage: b.expected_mileage_kmpl?.toString() ?? "", odo: b.initial_odometer_km?.toString() ?? "", service: b.service_interval_km?.toString() ?? "" })}>Edit</Button>
              <Button size="sm" variant="ghost" onClick={async () => { if (confirm(`Delete ${b.name}? Its rides and fuel entries are kept.`)) { await api.del(`/bikes/${b.id}`); bikes.reload(); } }}>Delete</Button></div>
          </li>))}</ul>
      )}</Async>
      <Dialog open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit bike" : "Add bike"}>
        {edit && (
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={80} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Make</Label><Input value={edit.make} onChange={(e) => setEdit({ ...edit, make: e.target.value })} /></div><div><Label>Model</Label><Input value={edit.model} onChange={(e) => setEdit({ ...edit, model: e.target.value })} /></div>
              <div><Label>Year</Label><Input type="number" value={edit.year} onChange={(e) => setEdit({ ...edit, year: e.target.value })} /></div><div><Label>Registration</Label><Input value={edit.registration} onChange={(e) => setEdit({ ...edit, registration: e.target.value })} /></div>
              <div><Label>Tank capacity (L)</Label><Input type="number" step="0.1" value={edit.tank} onChange={(e) => setEdit({ ...edit, tank: e.target.value })} /></div><div><Label>Expected mileage (km/l)</Label><Input type="number" step="0.1" value={edit.mileage} onChange={(e) => setEdit({ ...edit, mileage: e.target.value })} /></div>
              <div><Label>Starting odometer (km)</Label><Input type="number" value={edit.odo} onChange={(e) => setEdit({ ...edit, odo: e.target.value })} /></div><div><Label>Service interval (km)</Label><Input type="number" value={edit.service} onChange={(e) => setEdit({ ...edit, service: e.target.value })} /></div>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.is_default} onChange={(e) => setEdit({ ...edit, is_default: e.target.checked })} />Use as my default bike</label>
            {err && <p className="text-sm text-danger" role="alert">{err}</p>}
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button disabled={!edit.name.trim()} onClick={save}>Save</Button></div>
          </div>
        )}
      </Dialog>
    </Card>
  );
}

function Preferences() {
  const p = useFetch<Prefs>("/ride-preferences");
  const set = async (patch: Partial<Prefs>) => { await api.put("/ride-preferences", patch); p.reload(); };
  return (
    <Card>
      <SectionTitle title="Tracking preferences" />
      <Async state={p}>{(d) => (
        <div className="space-y-4 text-sm">
          <div className="flex items-center justify-between gap-3"><div><div className="font-medium">Ignore GPS fixes less accurate than</div><div className="text-xs text-muted-foreground">Fixes are always stored; this only decides which count towards distance. Lower is stricter.</div></div>
            <div className="flex items-center gap-1"><Input type="number" min={10} max={200} className="w-20" defaultValue={d.max_accuracy_m} onBlur={(e) => { const v = Number(e.target.value); if (v >= 10 && v <= 200 && v !== d.max_accuracy_m) set({ max_accuracy_m: v }); }} /> m</div></div>
          <div className="flex items-center justify-between gap-3"><div><div className="font-medium">Look up place names for start and end</div><div className="text-xs text-muted-foreground">Sends only a ride's start and end coordinates (rounded) to OpenStreetMap Nominatim when a ride finishes. Off by default; you can always type names yourself.</div></div>
            <Switch checked={d.reverse_geocode} onChange={(v) => set({ reverse_geocode: v })} /></div>
          <div className="flex items-center justify-between gap-3"><div><div className="font-medium">Keep the screen on while riding</div><div className="text-xs text-muted-foreground">Requests a screen wake lock so the browser keeps receiving GPS.</div></div>
            <Switch checked={d.keep_screen_on} onChange={(v) => set({ keep_screen_on: v })} /></div>
        </div>
      )}</Async>
    </Card>
  );
}

function Data() {
  const [msg, setMsg] = useState("");
  const [days, setDays] = useState("90");
  return (
    <Card>
      <SectionTitle title="Your data" sub="Location history is private to your account and is never shared with the public MCP data services." />
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-end gap-2"><div><Label>Thin GPS points of rides older than (days)</Label><Input className="w-28" type="number" min={7} value={days} onChange={(e) => setDays(e.target.value)} /></div>
          <Button variant="outline" onClick={async () => { const r = await api.post<{ rides_compacted: number; points_removed: number }>("/rides/compact", { older_than_days: Number(days) }); setMsg(`Simplified ${r.rides_compacted} rides, removed ${r.points_removed} points. Totals and route shapes are kept.`); }}>Compact old rides</Button></div>
        <div className="border-t pt-3"><Button variant="danger" onClick={async () => {
          if (prompt("This permanently deletes ALL rides and GPS points. Type DELETE to confirm.") === "DELETE") { const r = await api.del("/rides?confirm=DELETE") as any; setMsg("All ride history deleted."); void r; }
        }}>Delete all ride history</Button><p className="mt-1 text-xs text-muted-foreground">Fuel entries, parking spots and finance records are not affected.</p></div>
        {msg && <p className="text-success" role="status">{msg}</p>}
      </div>
    </Card>
  );
}

export default function RideSettings() {
  return (
    <>
      <PageHeader title="RubiRide settings" sub="Bikes, tracking and privacy" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Bikes /><Preferences />
        <Card>
          <SectionTitle title="Location permission & reliability" />
          <ul className="space-y-2.5 text-sm text-muted-foreground">
            <li className="flex gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />Your browser asks permission the first time. Location is read only while a ride is recording, when you press “Check GPS signal”, or when you save a parking spot.</li>
            <li className="flex gap-2"><Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-primary" />Accuracy and uptime depend on your phone: GPS hardware, sky view, power-saving modes, battery optimisation and browser rules can all pause or degrade tracking. In a browser, a locked screen or hidden tab stops GPS; a force-stopped browser records nothing.</li>
            <li className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />Always-on background tracking (Android foreground service, iOS background location) needs a native app. This site's API is ready for one, but it's not built yet.</li>
          </ul>
        </Card>
        <Data />
      </div>
    </>
  );
}
