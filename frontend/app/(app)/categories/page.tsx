"use client";
import { Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { PageHeader, SectionTitle } from "@/components/common/states";
import { Button, Card, Input } from "@/components/ui";
import { useApp } from "@/hooks/useApp";
import { api } from "@/lib/api";
import type { Category } from "@/types";

function Group({ type }: { type: "expense" | "income" }) {
  const { categories, refreshMeta } = useApp();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#6366f1");
  const [err, setErr] = useState("");
  const list = categories.filter((c) => c.type === type);
  const run = async (fn: () => Promise<unknown>) => { setErr(""); try { await fn(); await refreshMeta(); } catch (e: any) { setErr(e.message); } };

  return (
    <Card>
      <SectionTitle title={type === "expense" ? "Expense categories" : "Income categories"} />
      <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); run(async () => { await api.post("/categories", { name, type, color }); setName(""); }); }}>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-10 shrink-0 cursor-pointer rounded-md border bg-card p-1" aria-label="Color" />
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category" maxLength={80} required />
        <Button type="submit"><Plus className="h-4 w-4" />Add</Button>
      </form>
      {err && <p className="mb-2 text-sm text-danger" role="alert">{err}</p>}
      <ul className="divide-y">{list.map((c) => <Row key={c.id} c={c} run={run} />)}</ul>
    </Card>
  );
}

function Row({ c, run }: { c: Category; run: (fn: () => Promise<unknown>) => void }) {
  const [sub, setSub] = useState("");
  return (
    <li className="py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium"><span className="h-3 w-3 rounded-full" style={{ background: c.color }} />{c.name}</span>
        <span className="flex items-center gap-1">
          <button className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted" onClick={() => { const n = prompt("Rename category", c.name); if (n?.trim()) run(() => api.put(`/categories/${c.id}`, { name: n.trim() })); }}>Rename</button>
          <button aria-label={`Delete ${c.name}`} className="rounded p-1 text-muted-foreground hover:text-danger" onClick={() => confirm(`Delete “${c.name}”? Existing transactions become Uncategorized.`) && run(() => api.del(`/categories/${c.id}`))}><Trash2 className="h-4 w-4" /></button>
        </span>
      </div>
      {c.type === "expense" && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-5">
          {c.subcategories.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">{s.name}
              <button aria-label={`Remove ${s.name}`} onClick={() => run(() => api.del(`/categories/${c.id}/subcategories/${s.id}`))}><X className="h-3 w-3" /></button></span>
          ))}
          <form className="inline-flex" onSubmit={(e) => { e.preventDefault(); if (sub.trim()) run(async () => { await api.post(`/categories/${c.id}/subcategories`, { name: sub.trim() }); setSub(""); }); }}>
            <input value={sub} onChange={(e) => setSub(e.target.value)} placeholder="+ subcategory" className="h-6 w-28 rounded-full border bg-transparent px-2 text-xs outline-none focus:ring-1 focus:ring-primary" />
          </form>
        </div>
      )}
    </li>
  );
}

export default function CategoriesPage() {
  return (
    <>
      <PageHeader title="Categories" sub="Create, rename and delete categories and subcategories." />
      <div className="grid gap-4 lg:grid-cols-2"><Group type="expense" /><Group type="income" /></div>
    </>
  );
}
