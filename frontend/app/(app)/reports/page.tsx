"use client";
import { Download, Printer } from "lucide-react";
import { useState } from "react";
import { CategoryPie } from "@/components/charts";
import { Async, PageHeader, SectionTitle } from "@/components/common/states";
import { Button, Card, Input, Label, Select } from "@/components/ui";
import { useFetch } from "@/hooks/useApi";
import { qs } from "@/lib/api";
import { iso, money } from "@/lib/utils";

export default function ReportsPage() {
  const now = new Date();
  const [ym, setYm] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [start, setStart] = useState(iso(new Date(now.getTime() - 89 * 864e5)));
  const [end, setEnd] = useState(iso(now));
  const [y, m] = ym.split("-");
  const rep = useFetch<any>(`/analytics/monthly?year=${y}&month=${Number(m)}`);
  const link = (kind: string, extra: Record<string, any> = {}) => `/api/reports/export${qs({ kind, ...extra })}`;

  return (
    <>
      <PageHeader title="Reports" sub="Download your data or print a monthly summary." right={<Button variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4" />Print / save as PDF</Button>} />
      <div className="mb-4 grid gap-4 md:grid-cols-3 print:hidden">
        <Card>
          <SectionTitle title="Transactions (CSV)" />
          <div className="grid grid-cols-2 gap-2"><div><Label>From</Label><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div><div><Label>To</Label><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></div></div>
          <a href={link("transactions", { start, end })} download><Button className="mt-3 w-full"><Download className="h-4 w-4" />Download</Button></a>
        </Card>
        <Card>
          <SectionTitle title="Monthly report (CSV)" />
          <Label>Month</Label><Input type="month" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)} />
          <a href={link("monthly", { year: y, month: Number(m) })} download><Button className="mt-3 w-full"><Download className="h-4 w-4" />Download</Button></a>
        </Card>
        <Card>
          <SectionTitle title="Yearly report (CSV)" />
          <Label>Year</Label><Select defaultValue={y} id="yr" onChange={(e) => ((document.getElementById("yl") as HTMLAnchorElement).href = link("yearly", { year: e.target.value }))}>{[0, 1, 2, 3].map((i) => <option key={i}>{now.getFullYear() - i}</option>)}</Select>
          <a id="yl" href={link("yearly", { year: y })} download><Button className="mt-3 w-full"><Download className="h-4 w-4" />Download</Button></a>
        </Card>
      </div>
      <Async state={rep}>{(d) => (
        <Card>
          <h2 className="mb-1 text-lg font-semibold">Monthly summary — {ym}</h2>
          <div className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><div className="text-muted-foreground">Income</div><div className="text-xl font-bold text-success">{money(d.total_income)}</div></div>
            <div><div className="text-muted-foreground">Expenses</div><div className="text-xl font-bold text-danger">{money(d.total_expenses)}</div></div>
            <div><div className="text-muted-foreground">Savings</div><div className="text-xl font-bold">{money(d.savings)}</div></div>
            <div><div className="text-muted-foreground">Savings rate</div><div className="text-xl font-bold">{d.savings_rate}%</div></div>
          </div>
          <CategoryPie data={d.distribution} />
        </Card>
      )}</Async>
    </>
  );
}
