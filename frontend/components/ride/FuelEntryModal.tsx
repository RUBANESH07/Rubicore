"use client";
import { useEffect, useState } from "react";
import { Button, Dialog, Input, Label, Select, Textarea } from "@/components/ui";
import { useApp } from "@/hooks/useApp";
import { api } from "@/lib/api";
import type { Bike, Fuel } from "@/lib/ride";
import { iso, money } from "@/lib/utils";

type Form = { date: string; odometer: string; litres: string; price: string; total: string; station: string; notes: string; full: boolean; bike: string; expense: boolean; account: string };

export function FuelEntryModal({ open, onClose, bikes, editing, lastOdometer, onSaved }:
  { open: boolean; onClose: () => void; bikes: Bike[]; editing?: Fuel | null; lastOdometer?: number; onSaved: () => void }) {
  const { accounts, bump } = useApp();
  const blank = (): Form => ({ date: iso(new Date()), odometer: lastOdometer ? String(lastOdometer) : "", litres: "", price: "", total: "", station: "", notes: "", full: true,
    bike: String(bikes.find((b) => b.is_default)?.id ?? ""), expense: true, account: "" });
  const [f, setF] = useState<Form>(blank());
  const [totalEdited, setTotalEdited] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErr(""); setTotalEdited(!!editing);
    setF(editing ? { date: editing.date, odometer: String(editing.odometer_km), litres: String(editing.litres), price: String(editing.price_per_litre), total: String(editing.total_amount),
      station: editing.station, notes: editing.notes ?? "", full: editing.is_full_tank, bike: String(editing.bike_id ?? ""), expense: !!editing.transaction_id, account: "" } : blank());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const set = (k: keyof Form, v: string | boolean) => setF((p) => {
    const n = { ...p, [k]: v } as Form;
    if ((k === "litres" || k === "price") && !totalEdited) n.total = Number(n.litres) > 0 && Number(n.price) > 0 ? (Number(n.litres) * Number(n.price)).toFixed(2) : "";
    return n;
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setBusy(true);
    const body = { date: f.date, odometer_km: Number(f.odometer), litres: Number(f.litres), price_per_litre: Number(f.price), total_amount: f.total ? Number(f.total) : null,
      station: f.station, notes: f.notes || null, is_full_tank: f.full, bike_id: f.bike ? Number(f.bike) : null, record_expense: f.expense, account_id: f.account ? Number(f.account) : null };
    try {
      editing ? await api.put(`/fuel/${editing.id}`, body) : await api.post("/fuel", body);
      bump(); onSaved(); onClose();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onClose={onClose} title={editing ? "Edit fuel entry" : "Add fuel entry"}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Date</Label><Input type="date" required value={f.date} onChange={(e) => set("date", e.target.value)} /></div>
          <div><Label>Odometer (km)</Label><Input type="number" min="0" step="0.1" required value={f.odometer} onChange={(e) => set("odometer", e.target.value)} /></div>
          <div><Label>Fuel (litres)</Label><Input type="number" min="0.01" step="0.01" required value={f.litres} onChange={(e) => set("litres", e.target.value)} /></div>
          <div><Label>Price per litre</Label><Input type="number" min="0.01" step="0.01" required value={f.price} onChange={(e) => set("price", e.target.value)} /></div>
          <div className="col-span-2">
            <Label>Total amount (litres × price{f.total && !totalEdited ? " — calculated" : ""})</Label>
            <Input type="number" min="0.01" step="0.01" value={f.total} onChange={(e) => { setTotalEdited(true); setF({ ...f, total: e.target.value }); }} />
          </div>
          <div><Label>Fuel station</Label><Input value={f.station} maxLength={120} onChange={(e) => set("station", e.target.value)} /></div>
          <div><Label>Bike</Label><Select value={f.bike} onChange={(e) => set("bike", e.target.value)}><option value="">None</option>{bikes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></div>
        </div>
        <div><Label>Notes</Label><Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} /></div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={f.full} onChange={(e) => set("full", e.target.checked)} />
          <span><b>Filled to full tank.</b> Mileage is only calculated between full-tank fill-ups, because fuel use can't be measured from GPS.</span></label>
        {!editing && (
          <div className="rounded-md border p-3">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.expense} onChange={(e) => set("expense", e.target.checked)} /> Also record {f.total ? money(Number(f.total)) : "it"} as a RubiCore expense (Petrol / Fuel)</label>
            {f.expense && (
              <div className="mt-2"><Label>Paid from</Label>
                <Select value={f.account} onChange={(e) => set("account", e.target.value)}><option value="">Default account</option>{accounts.filter((a) => a.is_active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></div>
            )}
          </div>
        )}
        {err && <p className="text-sm text-danger" role="alert">{err}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button disabled={busy}>{busy ? "Saving…" : "Save entry"}</Button></div>
      </form>
    </Dialog>
  );
}
