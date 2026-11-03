"use client";
import { MapPin } from "lucide-react";
import { useState } from "react";
import { Async, PageHeader, SectionTitle } from "@/components/common/states";
import { RideMap } from "@/components/ride/RideMap";
import { ParkingLocationCard } from "@/components/ride/parts";
import { Button, Card, Input, Label } from "@/components/ui";
import { useFetch } from "@/hooks/useApi";
import { api } from "@/lib/api";
import type { Parking } from "@/lib/ride";

export default function ParkingPage() {
  const data = useFetch<{ current: Parking | null; history: Parking[] }>("/parking");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function save() {
    setErr("");
    if (!navigator.geolocation) return setErr("This browser has no GPS support.");
    if (!window.isSecureContext) return setErr("GPS needs a secure page (https, or localhost).");
    setBusy(true);
    navigator.geolocation.getCurrentPosition(async (p) => {
      try { await api.post("/parking", { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy_m: p.coords.accuracy, note }); setNote(""); data.reload(); }
      catch (e: any) { setErr(e.message); } finally { setBusy(false); }
    }, (e) => { setBusy(false); setErr(e.code === 1 ? "Location permission denied. Allow it in your browser's site settings." : "Couldn't get your location. Move to open sky and try again."); },
    { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 });
  }

  return (
    <>
      <PageHeader title="Parking location" sub="Save where you parked and navigate back to it" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card>
            <SectionTitle title="Save parking location" />
            <Label>Note (optional)</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. Basement 2, near the lift" />
            <Button className="mt-3 w-full" onClick={save} disabled={busy}><MapPin className="h-4 w-4" />{busy ? "Getting GPS fix…" : "Save my current location"}</Button>
            {err && <p className="mt-2 text-sm text-danger" role="alert">{err}</p>}
            <p className="mt-2 text-xs text-muted-foreground">Uses your location once, when you press the button. RubiCore does not watch your bike or send movement alerts: it only knows where you saved it.</p>
          </Card>
          <Async state={data}>{(d) => d.current ? (
            <ParkingLocationCard p={d.current}
              onNote={async () => { const n = prompt("Parking note", d.current!.note); if (n !== null) { await api.put(`/parking/${d.current!.id}`, { note: n }); data.reload(); } }}
              onCollected={async () => { await api.put(`/parking/${d.current!.id}`, { is_active: false }); data.reload(); }} />
          ) : <Card className="text-sm text-muted-foreground">No bike parked. Save your location when you park.</Card>}</Async>
        </div>
        <div className="space-y-4">
          <Async state={data}>{(d) => (
            <>
              <RideMap height={360} markers={d.current ? [{ lat: d.current.latitude, lon: d.current.longitude, kind: "parking", label: d.current.note || "Parked here" }] : d.history.slice(0, 1).map((p) => ({ lat: p.latitude, lon: p.longitude, kind: "parking" as const, label: "Last parking" }))} />
              {d.history.length > 0 && (
                <Card><SectionTitle title="Recent parking spots" />
                  <ul className="divide-y text-sm">{d.history.slice(0, 10).map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 py-2"><div className="min-w-0"><div className="truncate">{p.note || "No note"}</div><div className="text-xs text-muted-foreground">{new Date(p.saved_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</div></div>
                      <span className="flex gap-3 whitespace-nowrap text-xs"><a className="text-primary" href={p.navigate_url} target="_blank" rel="noopener noreferrer">Navigate</a>
                        <button className="text-danger" onClick={async () => { await api.del(`/parking/${p.id}`); data.reload(); }}>Delete</button></span></li>))}</ul></Card>
              )}
            </>
          )}</Async>
        </div>
      </div>
    </>
  );
}
