"use client";
import { Download, FileText } from "lucide-react";
import { useState } from "react";
import { PageHeader, SectionTitle } from "@/components/common/states";
import { Button, Card, Input, Label, Select } from "@/components/ui";
import { qs } from "@/lib/api";
import { iso } from "@/lib/utils";

export default function RideReports() {
  const now = new Date();
  const [start, setStart] = useState(iso(new Date(now.getTime() - 89 * 864e5)));
  const [end, setEnd] = useState(iso(now));
  const [ym, setYm] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [year, setYear] = useState(String(now.getFullYear()));
  const [y, m] = ym.split("-");
  const link = (kind: string, format: "csv" | "pdf", extra: Record<string, string | number> = {}) => `/api/ride-reports/export${qs({ kind, format, ...extra })}`;
  const Pair = ({ kind, extra }: { kind: string; extra?: Record<string, string | number> }) => (
    <div className="mt-3 grid grid-cols-2 gap-2">
      <a href={link(kind, "csv", extra)} download><Button variant="outline" className="w-full"><Download className="h-4 w-4" />CSV</Button></a>
      <a href={link(kind, "pdf", extra)} download><Button className="w-full"><FileText className="h-4 w-4" />PDF</Button></a>
    </div>
  );
  return (
    <>
      <PageHeader title="Ride reports" sub="Download your riding data as CSV or PDF" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card><SectionTitle title="Ride log" /><div className="grid grid-cols-2 gap-2"><div><Label>From</Label><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div><div><Label>To</Label><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></div></div><Pair kind="rides" extra={{ start, end }} /></Card>
        <Card><SectionTitle title="Monthly report" /><Label>Month</Label><Input type="month" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)} /><Pair kind="monthly" extra={{ year: y, month: Number(m) }} /></Card>
        <Card><SectionTitle title="Yearly report" /><Label>Year</Label><Select value={year} onChange={(e) => setYear(e.target.value)}>{[0, 1, 2, 3].map((i) => <option key={i}>{now.getFullYear() - i}</option>)}</Select><Pair kind="yearly" extra={{ year }} /></Card>
        <Card><SectionTitle title="Fuel log" /><p className="text-sm text-muted-foreground">Every fill-up with odometer, litres, price and station.</p><Pair kind="fuel" /></Card>
      </div>
    </>
  );
}
