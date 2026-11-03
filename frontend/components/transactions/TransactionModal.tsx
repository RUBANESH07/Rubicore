"use client";
import { useEffect, useState } from "react";
import { Button, Dialog, Input, Label, Select, Tabs, Textarea } from "@/components/ui";
import { useApp } from "@/hooks/useApp";
import { api } from "@/lib/api";
import { iso } from "@/lib/utils";
import type { Transaction } from "@/types";

const METHODS = ["cash", "upi", "card", "netbanking", "wallet", "other"];

type Form = {
  type: "income" | "expense" | "transfer"; amount: string; date: string; account_id: string; transfer_account_id: string;
  category_id: string; subcategory_id: string; payment_method: string; description: string; notes: string;
};

export function TransactionModal({ open, onClose, editing }: { open: boolean; onClose: () => void; editing?: Transaction | null }) {
  const { accounts, categories, bump } = useApp();
  const blank = (): Form => ({
    type: "expense", amount: "", date: iso(new Date()), account_id: String(accounts[0]?.id ?? ""), transfer_account_id: "",
    category_id: "", subcategory_id: "", payment_method: "upi", description: "", notes: "",
  });
  const [f, setF] = useState<Form>(blank());
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErr("");
    setF(editing ? {
      type: editing.type, amount: String(editing.amount), date: editing.date, account_id: String(editing.account_id),
      transfer_account_id: String(editing.transfer_account_id ?? ""), category_id: String(editing.category_id ?? ""),
      subcategory_id: String(editing.subcategory_id ?? ""), payment_method: editing.payment_method,
      description: editing.description, notes: editing.notes ?? "",
    } : blank());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing, accounts.length]);

  const set = (k: keyof Form, v: string) => setF((p) => ({ ...p, [k]: v }));
  const cats = categories.filter((c) => c.type === f.type);
  const subs = categories.find((c) => String(c.id) === f.category_id)?.subcategories ?? [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (!(Number(f.amount) > 0)) return setErr("Enter an amount greater than zero.");
    if (f.type === "transfer" && !f.transfer_account_id) return setErr("Choose the destination account.");
    setBusy(true);
    const body = {
      type: f.type, amount: Number(f.amount), date: f.date, account_id: Number(f.account_id),
      transfer_account_id: f.type === "transfer" ? Number(f.transfer_account_id) : null,
      category_id: f.category_id ? Number(f.category_id) : null, subcategory_id: f.subcategory_id ? Number(f.subcategory_id) : null,
      payment_method: f.payment_method, description: f.description, notes: f.notes || null,
    };
    try {
      editing ? await api.put(`/transactions/${editing.id}`, body) : await api.post("/transactions", body);
      bump();
      onClose();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={editing ? "Edit transaction" : "Add transaction"}>
      <form onSubmit={submit} className="space-y-3">
        <Tabs value={f.type} onChange={(t) => setF((p) => ({ ...p, type: t, category_id: "", subcategory_id: "" }))}
          tabs={[{ id: "expense", label: "Expense" }, { id: "income", label: "Income" }, { id: "transfer", label: "Transfer" }]} />
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Amount (₹)</Label><Input type="number" step="0.01" min="0" inputMode="decimal" autoFocus required value={f.amount} onChange={(e) => set("amount", e.target.value)} /></div>
          <div><Label>Date</Label><Input type="date" required value={f.date} onChange={(e) => set("date", e.target.value)} /></div>
          <div>
            <Label>{f.type === "transfer" ? "From account" : "Account"}</Label>
            <Select value={f.account_id} onChange={(e) => set("account_id", e.target.value)}>
              {accounts.filter((a) => a.is_active).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}
            </Select>
          </div>
          {f.type === "transfer" ? (
            <div>
              <Label>To account</Label>
              <Select value={f.transfer_account_id} onChange={(e) => set("transfer_account_id", e.target.value)}>
                <option value="">Select…</option>
                {accounts.filter((a) => a.is_active && String(a.id) !== f.account_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </div>
          ) : (
            <div>
              <Label>Payment method</Label>
              <Select value={f.payment_method} onChange={(e) => set("payment_method", e.target.value)}>
                {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            </div>
          )}
          {f.type !== "transfer" && (
            <>
              <div>
                <Label>Category</Label>
                <Select value={f.category_id} onChange={(e) => setF((p) => ({ ...p, category_id: e.target.value, subcategory_id: "" }))}>
                  <option value="">Uncategorized</option>
                  {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </div>
              <div>
                <Label>Subcategory</Label>
                <Select value={f.subcategory_id} onChange={(e) => set("subcategory_id", e.target.value)} disabled={!subs.length}>
                  <option value="">None</option>
                  {subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </div>
            </>
          )}
        </div>
        {f.type === "transfer" && <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">Transfers between your own accounts move money but are not counted as income or expenses.</p>}
        <div><Label>Description</Label><Input maxLength={255} value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="e.g. Lunch with team" /></div>
        <div><Label>Notes (optional)</Label><Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} /></div>
        {err && <p className="text-sm text-danger" role="alert">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Add transaction"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
