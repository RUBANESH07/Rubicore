"use client";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Empty } from "@/components/common/states";
import { CORAL, MINT, PALETTE, PINK, money } from "@/lib/utils";
import type { CatAmount } from "@/types";

const axis = { stroke: "hsl(var(--muted-foreground))", fontSize: 11, tickLine: false, axisLine: false } as const;
const tip = {
  contentStyle: { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "hsl(var(--foreground))" },
};
const compact = (v: number) => new Intl.NumberFormat("en-IN", { notation: "compact" }).format(v);

/** Category share as a donut with the total in the middle. Colours follow the app palette by rank. */
export function CategoryPie({ data, height = 240 }: { data: CatAmount[]; height?: number }) {
  if (!data.length) return <Empty text="No data for this period." />;
  const total = data.reduce((s, d) => s + d.amount, 0);
  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row">
      <div className="relative h-[210px] w-full sm:w-1/2">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="amount" nameKey="category" innerRadius="62%" outerRadius="92%" paddingAngle={2} cornerRadius={4} stroke="none">
              {data.map((d, i) => <Cell key={d.category} fill={PALETTE[i % PALETTE.length]} />)}
            </Pie>
            <Tooltip {...tip} formatter={(v: number) => money(v)} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center"><div><div className="text-lg font-bold tabular-nums">{money(total)}</div><div className="text-[11px] text-muted-foreground">total</div></div></div>
      </div>
      <ul className="w-full space-y-1.5 text-sm sm:w-1/2" style={{ maxHeight: height }}>
        {data.slice(0, 7).map((d, i) => (
          <li key={d.category} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 truncate"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />{d.category}</span>
            <span className="tabular-nums text-muted-foreground">{money(d.amount)} · {Math.round((d.amount / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CashflowChart({ data, xKey = "date", height = 240 }: { data: any[]; xKey?: string; height?: number }) {
  if (!data.length) return <Empty text="No data for this period." />;
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: -10, right: 4 }}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey={xKey} {...axis} tickFormatter={(v) => (String(v).length === 10 ? String(v).slice(8) : v)} interval="preserveStartEnd" />
          <YAxis {...axis} tickFormatter={compact} />
          <Tooltip {...tip} formatter={(v: number) => money(v)} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="income" name="Income" fill={MINT} radius={[4, 4, 0, 0]} />
          <Bar dataKey="expense" name="Expense" fill={CORAL} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TrendArea({ data, xKey, yKey, name, color = PINK, height = 220, fmt = money }:
  { data: any[]; xKey: string; yKey: string; name: string; color?: string; height?: number; fmt?: (n: number) => string }) {
  if (!data.length) return <Empty text="No data for this period." />;
  const id = `g-${yKey}`;
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ left: -10, right: 4 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.4} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey={xKey} {...axis} tickFormatter={(v) => (String(v).length === 10 ? String(v).slice(5) : v)} interval="preserveStartEnd" />
          <YAxis {...axis} tickFormatter={compact} domain={["auto", "auto"]} />
          <Tooltip {...tip} formatter={(v: number) => fmt(v)} />
          <Area type="monotone" dataKey={yKey} name={name} stroke={color} strokeWidth={2.5} fill={`url(#${id})`} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PriceChart({ points, height = 280 }: { points: { t: number; close: number }[]; height?: number }) {
  if (!points.length) return <Empty text="No price history." />;
  const data = points.map((p) => ({ d: new Date(p.t * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "short" }), close: p.close }));
  const up = data[data.length - 1].close >= data[0].close;
  return <TrendArea data={data} xKey="d" yKey="close" name="Close" height={height} color={up ? "#3fae6e" : PINK} fmt={(n) => n.toFixed(2)} />;
}

export function MultiLine({ series, height = 280 }: { series: { symbol: string; series: { t: number; pct: number }[] }[]; height?: number }) {
  const base = series.find((s) => s.series?.length);
  if (!base) return <Empty text="No data." />;
  const data = base.series.map((p, i) => {
    const row: any = { d: new Date(p.t * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) };
    series.forEach((s) => (row[s.symbol] = s.series?.[i]?.pct));
    return row;
  });
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ left: -10, right: 4 }}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey="d" {...axis} interval="preserveStartEnd" />
          <YAxis {...axis} tickFormatter={(v) => `${v}%`} />
          <Tooltip {...tip} formatter={(v: number) => `${v}%`} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {series.map((s, i) => <Line key={s.symbol} type="monotone" dataKey={s.symbol} stroke={PALETTE[i % PALETTE.length]} dot={false} strokeWidth={2.5} />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
