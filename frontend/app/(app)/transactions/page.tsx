"use client";
import { Pencil, Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { CashflowChart } from "@/components/charts";
import { Async, Empty, PageHeader, SectionTitle } from "@/components/common/states";
import { Badge, Button, Card, Dialog, Input, Label, Select, Tabs } from "@/components/ui";
import { useFetch } from "@/hooks/useApi";
import { useApp } from "@/hooks/useApp";
import { api, qs } from "@/lib/api";
import { fmtDate, money } from "@/lib/utils";
import type { Transaction } from "@/types";

const PAGE = 25;

function History() {
  const { categories, accounts, openAdd, bump, version } = useApp();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [type, setType] = useState("");
  const [cat, setCat] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [page, setPage] = useState(0);
  const path = `/transactions${qs({ q, type, category_id: cat, start, end, limit: PAGE, offset: page * PAGE })}`;
  const list = useFetch<{ items: Transaction[]; total: number }>(path + `&v=${version}`);
  const accName = (id: number | null) => accounts.find((a) => a.id === id)?.name ?? "";

  return (
    <div className="space-y-3">
      <Card className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="col-span-2 md:col-span-1"><Label>Search</Label><Input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Description or notes" /></div>
        <div><Label>Type</Label><Select value={type} onChange={(e) => { setType(e.target.value); setPage(0); }}><option value="">All</option><option value="expense">Expense</option><option value="income">Income</option><option value="transfer">Transfer</option></Select></div>
        <div><Label>Category</Label><Select value={cat} onChange={(e) => { setCat(e.target.value); setPage(0); }}><option value="">All</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
        <div><Label>From</Label><Input type="date" value={start} onChange={(e) => { setStart(e.target.value); setPage(0); }} /></div>
        <div><Label>To</Label><Input type="date" value={end} onChange={(e) => { setEnd(e.target.value); setPage(0); }} /></div>
      </Card>
      <Card className="overflow-x-auto p-0">
        <Async state={list} empty={(d) => !d.items.length && "No transactions match. Use “Add Transaction” to create one."}>{(d) => (
          <>
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr><th className="p-3">Date</th><th className="p-3">Description</th><th className="hidden p-3 md:table-cell">Category</th><th className="hidden p-3 md:table-cell">Account</th><th className="p-3 text-right">Amount</th><th className="w-20 p-3" /></tr>
              </thead>
              <tbody className="divide-y">
                {d.items.map((t) => (
                  <tr key={t.id} className="hover:bg-muted/50">
                    <td className="whitespace-nowrap p-3 text-muted-foreground">{fmtDate(t.date)}</td>
                    <td className="p-3"><div className="font-medium">{t.description || "—"}</div><div className="text-xs text-muted-foreground">{t.payment_method}{t.notes ? ` · ${t.notes}` : ""}</div></td>
                    <td className="hidden p-3 md:table-cell">{t.type === "transfer" ? <Badge tone="primary">Transfer</Badge> : <>{t.category_name ?? "Uncategorized"}{t.subcategory_name && <span className="text-muted-foreground"> / {t.subcategory_name}</span>}</>}</td>
                    <td className="hidden p-3 text-muted-foreground md:table-cell">{t.type === "transfer" ? `${accName(t.account_id)} → ${accName(t.transfer_account_id)}` : accName(t.account_id)}</td>
                    <td className={`whitespace-nowrap p-3 text-right font-medium tabular-nums ${t.type === "income" ? "text-success" : ""}`}>{t.type === "income" ? "+" : t.type === "expense" ? "−" : ""}{money(t.amount)}</td>
                    <td className="p-3 text-right">
                      <button aria-label="Edit" className="mr-2 text-muted-foreground hover:text-foreground" onClick={() => openAdd(t)}><Pencil className="h-4 w-4" /></button>
                      <button aria-label="Delete" className="text-muted-foreground hover:text-danger" onClick={async () => { if (confirm("Delete this transaction?")) { await api.del(`/transactions/${t.id}`); bump(); } }}><Trash2 className="h-4 w-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center justify-between border-t p-3 text-sm text-muted-foreground">
              <span>{d.total} transactions</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
                <Button size="sm" variant="outline" disabled={(page + 1) * PAGE >= d.total} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          </>
        )}</Async>
      </Card>
    </div>
  );
}

type Daily = { date: string; opening: number; income: number; expense: number; closing: number; cash: number; bank: number; wallet: number };

function Balances() {
  const { accounts, refreshMeta, bump, version } = useApp();
  const [days, setDays] = useState(14);
  const bal = useFetch<{ accounts: { id: number; name: string; type: string; balance: number }[]; by_type: Record<string, number>; total: number }>(`/balances/accounts?v=${version}`);
  const daily = useFetch<Daily[]>(`/balances/daily?start=${new Date(Date.now() - (days - 1) * 864e5 - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10)}&v=${version}`);
  const [edit, setEdit] = useState<{ id?: number; name: string; type: string; opening_balance: string; opening_date: string } | null>(null);
  const [err, setErr] = useState("");

  async function save() {
    if (!edit) return;
    setErr("");
    try {
      const body = { name: edit.name, opening_balance: Number(edit.opening_balance || 0), opening_date: edit.opening_date || undefined };
      edit.id ? await api.put(`/accounts/${edit.id}`, body) : await api.post("/accounts", { ...body, type: edit.type });
      setEdit(null); await refreshMeta(); bump();
    } catch (e: any) { setErr(e.message); }
  }

  return (
    <div className="space-y-4">
      <Async state={bal}>{(b) => (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card><div className="text-xs text-muted-foreground">Total balance</div><div className="text-2xl font-bold">{money(b.total)}</div></Card>
          {(["cash", "bank", "wallet"] as const).map((k) => <Card key={k}><div className="text-xs capitalize text-muted-foreground">{k} balance</div><div className="text-2xl font-bold">{money(b.by_type[k])}</div></Card>)}
        </div>
      )}</Async>
      <Card>
        <SectionTitle title="Accounts" sub="Opening balance is where your tracking starts. Closing = opening + income − expenses." right={<Button size="sm" onClick={() => setEdit({ name: "", type: "bank", opening_balance: "0", opening_date: "" })}>Add account</Button>} />
        <ul className="divide-y">
          {accounts.map((a) => (
            <li key={a.id} className="flex items-center justify-between py-2 text-sm">
              <div><span className="font-medium">{a.name}</span> <Badge>{a.type}</Badge><div className="text-xs text-muted-foreground">Opening {money(a.opening_balance)} on {fmtDate(a.opening_date)}</div></div>
              <Button size="sm" variant="outline" onClick={() => setEdit({ id: a.id, name: a.name, type: a.type, opening_balance: String(a.opening_balance), opening_date: a.opening_date })}>Edit</Button>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <SectionTitle title="Daily balance comparison" right={<Select className="w-32" value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={7}>7 days</option><option value={14}>14 days</option><option value={30}>30 days</option></Select>} />
        <Async state={daily}>{(rows) => (
          <>
            <CashflowChart data={rows} />
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2">Date</th><th>Opening</th><th>Income</th><th>Expenses</th><th>Closing</th><th className="hidden md:table-cell">Cash / Bank / Wallet</th></tr></thead>
                <tbody className="divide-y">
                  {[...rows].reverse().map((r) => (
                    <tr key={r.date}><td className="py-1.5">{fmtDate(r.date)}</td><td className="tabular-nums">{money(r.opening)}</td><td className="tabular-nums text-success">{money(r.income)}</td><td className="tabular-nums text-danger">{money(r.expense)}</td><td className="font-medium tabular-nums">{money(r.closing)}</td>
                      <td className="hidden text-xs text-muted-foreground md:table-cell">{money(r.cash)} / {money(r.bank)} / {money(r.wallet)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}</Async>
      </Card>
      <Dialog open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit account" : "Add account"}>
        {edit && (
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
            {!edit.id && <div><Label>Type</Label><Select value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value })}><option value="cash">Cash</option><option value="bank">Bank</option><option value="wallet">Wallet</option></Select></div>}
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Opening balance (₹)</Label><Input type="number" step="0.01" value={edit.opening_balance} onChange={(e) => setEdit({ ...edit, opening_balance: e.target.value })} /></div>
              <div><Label>Opening date</Label><Input type="date" value={edit.opening_date} onChange={(e) => setEdit({ ...edit, opening_date: e.target.value })} /></div>
            </div>
            {err && <p className="text-sm text-danger">{err}</p>}
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save} disabled={!edit.name.trim()}>Save</Button></div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

export default function TransactionsPage() {
  const [tab, setTab] = useState<"history" | "balances">("history");
  return (
    <>
      <PageHeader title="Transactions" sub="Every income, expense and transfer in one place." right={<Tabs value={tab} onChange={setTab} tabs={[{ id: "history", label: "History" }, { id: "balances", label: "Balances & accounts" }]} />} />
      {tab === "history" ? <Suspense><History /></Suspense> : <Balances />}
    </>
  );
}
