"use client";
import { User } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip, Treemap, XAxis, YAxis } from "recharts";
import { Empty } from "@/components/common/states";
import { CORAL, MINT, PALETTE, PINK, PINK_RAMP, SKY, SUN, money } from "@/lib/utils";

const axis = { stroke: "hsl(var(--muted-foreground))", fontSize: 11, tickLine: false, axisLine: false } as const;
const tip = { contentStyle: { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 } };
const compact = (v: number) => new Intl.NumberFormat("en-IN", { notation: "compact" }).format(v);
const ink = "hsl(var(--foreground))";
const quiet = "hsl(var(--muted-foreground))";

/* ---------------- donut with a centre label ---------------- */
export function DonutChart({ data, centerValue, centerLabel, fmt = money, height = 210 }:
  { data: { name: string; value: number }[]; centerValue?: string; centerLabel?: string; fmt?: (n: number) => string; height?: number }) {
  const rows = data.filter((d) => d.value > 0);
  if (!rows.length) return <Empty text="No data for this period." />;
  const total = rows.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row">
      <div className="relative w-full sm:w-1/2" style={{ height }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={rows} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={2} cornerRadius={4} stroke="none">
              {rows.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
            </Pie>
            <Tooltip {...tip} formatter={(v: number) => fmt(v)} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div><div className="text-xl font-bold tabular-nums">{centerValue ?? fmt(total)}</div><div className="text-[11px] text-muted-foreground">{centerLabel ?? "total"}</div></div>
        </div>
      </div>
      <ul className="w-full space-y-1.5 text-sm sm:w-1/2">
        {rows.slice(0, 7).map((d, i) => (
          <li key={d.name} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 truncate"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />{d.name}</span>
            <span className="tabular-nums text-muted-foreground">{Math.round((d.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------- progress ring (circle infographic) ---------------- */
export function ProgressRing({ value, max = 100, label, sub, color = PINK, size = 96, display }:
  { value: number; max?: number; label?: string; sub?: string; color?: string; size?: number; display?: string }) {
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const r = (size - 14) / 2, c = 2 * Math.PI * r;
  return (
    <div className="flex flex-col items-center text-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label ?? "progress"} ${Math.round(pct * 100)} percent`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="9" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        <text x="50%" y="50%" dy="0.35em" textAnchor="middle" fontSize={size / 5} fontWeight="700" fill={ink}>{display ?? `${Math.round(pct * 100)}%`}</text>
      </svg>
      {label && <div className="mt-1 text-xs font-medium">{label}</div>}
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

/* ---------------- funnel ---------------- */
export function FunnelViz({ stages, fmt = money }: { stages: { label: string; value: number; color?: string }[]; fmt?: (n: number) => string }) {
  const first = stages[0]?.value ?? 0;
  if (!first) return <Empty text="Nothing to show yet." />;
  const W = 360, H = 62, gap = 6, mid = 120;
  const width = (v: number) => Math.max(34, (Math.max(0, v) / first) * 220);
  return (
    <svg viewBox={`0 0 ${W + 120} ${stages.length * (H + gap)}`} className="w-full" role="img" aria-label="Money funnel">
      {stages.map((s, i) => {
        const y = i * (H + gap), top = width(s.value), bottom = i + 1 < stages.length ? width(stages[i + 1].value) : top * 0.8;
        const x = mid;
        const pts = `${x - top / 2},${y} ${x + top / 2},${y} ${x + bottom / 2},${y + H} ${x - bottom / 2},${y + H}`;
        return (
          <g key={s.label}>
            <polygon points={pts} fill={s.color ?? PALETTE[i % PALETTE.length]} fillOpacity={0.9} />
            <text x={x} y={y + H / 2 + 4} textAnchor="middle" fontSize="13" fontWeight="700" fill="#2b1620">{fmt(s.value)}</text>
            <text x={x + 138} y={y + H / 2 - 2} fontSize="13" fontWeight="600" fill={ink}>{s.label}</text>
            <text x={x + 138} y={y + H / 2 + 15} fontSize="11" fill={quiet}>{first ? Math.round((Math.max(0, s.value) / first) * 100) : 0}% of {stages[0].label.toLowerCase()}</text>
          </g>
        );
      })}
    </svg>
  );
}

/* ---------------- pyramid ---------------- */
export function PyramidViz({ levels, fmt = money }: { levels: { label: string; value: number; color?: string }[]; fmt?: (n: number) => string }) {
  const total = levels.reduce((s, l) => s + Math.max(0, l.value), 0);
  if (!total) return <Empty text="Nothing to show yet." />;
  const n = levels.length, H = 62, W = 300, baseX = 20, peak = 150;
  const halfAt = (t: number) => (W / 2) * t;        // half-width at fraction t from the apex
  return (
    <svg viewBox={`0 0 ${W + 190} ${n * H + 4}`} className="w-full" role="img" aria-label="Spending pyramid">
      {levels.map((l, i) => {
        const t0 = i / n, t1 = (i + 1) / n, y0 = i * H, y1 = (i + 1) * H;
        const pts = `${baseX + peak - halfAt(t0)},${y0} ${baseX + peak + halfAt(t0)},${y0} ${baseX + peak + halfAt(t1)},${y1 - 3} ${baseX + peak - halfAt(t1)},${y1 - 3}`;
        return (
          <g key={l.label}>
            <polygon points={pts} fill={l.color ?? PALETTE[i % PALETTE.length]} fillOpacity={0.92} />
            <text x={baseX + peak} y={y0 + H / 2 + 3} textAnchor="middle" fontSize="12" fontWeight="700" fill="#2b1620">{Math.round((Math.max(0, l.value) / total) * 100)}%</text>
            <text x={baseX + W + 14} y={y0 + H / 2 - 3} fontSize="13" fontWeight="600" fill={ink}>{l.label}</text>
            <text x={baseX + W + 14} y={y0 + H / 2 + 13} fontSize="11" fill={quiet}>{fmt(l.value)}</text>
          </g>
        );
      })}
    </svg>
  );
}

/* ---------------- radar (this vs previous) ---------------- */
export function RadarViz({ data, aName, bName, height = 280 }: { data: { axis: string; a: number; b?: number }[]; aName: string; bName?: string; height?: number }) {
  if (!data.length || data.every((d) => !d.a && !d.b)) return <Empty text="No data for this period." />;
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid stroke="hsl(var(--border))" />
          <PolarAngleAxis dataKey="axis" tick={{ fill: quiet, fontSize: 11 }} />
          <PolarRadiusAxis tick={false} axisLine={false} />
          {bName && <Radar name={bName} dataKey="b" stroke={SKY} fill={SKY} fillOpacity={0.35} strokeWidth={2} />}
          <Radar name={aName} dataKey="a" stroke={PINK} fill={PINK} fillOpacity={0.3} strokeWidth={2} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Tooltip {...tip} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------------- calendar heatmap ---------------- */
export function HeatmapCalendar({ days, unit = "", fmt = (n: number) => String(Math.round(n)) }: { days: { date: string; value: number }[]; unit?: string; fmt?: (n: number) => string }) {
  if (!days.length) return <Empty text="No data for this period." />;
  const max = Math.max(...days.map((d) => d.value), 0);
  const level = (v: number) => (!v || !max ? 0 : Math.min(4, 1 + Math.floor((v / max) * 3.999)));
  const first = new Date(days[0].date + "T00:00:00");
  const lead = (first.getDay() + 6) % 7;                       // Monday = 0
  const cells: ({ date: string; value: number } | null)[] = [...Array(lead).fill(null), ...days];
  const weeks = Math.ceil(cells.length / 7);
  return (
    <div>
      <div className="flex gap-1.5">
        <div className="grid grid-rows-7 gap-1 pr-1 text-[10px] text-muted-foreground" aria-hidden>{["M", "", "W", "", "F", "", "S"].map((d, i) => <span key={i} className="flex h-4 items-center">{d}</span>)}</div>
        <div className="grid grid-flow-col grid-rows-7 gap-1" style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` }}>
          {cells.map((c, i) => c ? (
            <div key={i} title={`${c.date}: ${fmt(c.value)}${unit}`} className="h-4 min-w-[1rem] rounded-[4px]" style={{ background: PINK_RAMP[level(c.value)] }} />
          ) : <div key={i} className="h-4 min-w-[1rem]" />)}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">less{PINK_RAMP.map((c) => <span key={c} className="h-3 w-3 rounded-[3px]" style={{ background: c }} />)}more</div>
    </div>
  );
}

/* ---------------- vertical timeline ---------------- */
export function VerticalTimeline({ items }: { items: { title: string; sub?: string; value?: string; color?: string; positive?: boolean }[] }) {
  if (!items.length) return <Empty text="Nothing here yet." />;
  return (
    <ol className="relative ml-2 space-y-4 border-l-2 pl-6" style={{ borderColor: "hsl(var(--border))" }}>
      {items.map((it, i) => (
        <li key={i} className="relative">
          <span className="absolute -left-[33px] top-1 h-3.5 w-3.5 rounded-full border-[3px]" style={{ background: "hsl(var(--card))", borderColor: it.color ?? PALETTE[i % PALETTE.length] }} />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><div className="truncate text-sm font-medium">{it.title}</div>{it.sub && <div className="text-xs text-muted-foreground">{it.sub}</div>}</div>
            {it.value && <div className={`whitespace-nowrap text-sm font-semibold tabular-nums ${it.positive ? "text-success" : ""}`}>{it.value}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ---------------- treemap ---------------- */
export function TreemapViz({ data, height = 240, fmt = money }: { data: { name: string; value: number }[]; height?: number; fmt?: (n: number) => string }) {
  const rows = data.filter((d) => d.value > 0).map((d, i) => ({ ...d, fill: PALETTE[i % PALETTE.length] }));
  if (!rows.length) return <Empty text="No data for this period." />;
  const Cell2 = (p: any) => {
    const { x, y, width, height: h, name, fill, value } = p;
    if (!name) return <g />;
    return (
      <g>
        <rect x={x + 1} y={y + 1} width={Math.max(0, width - 2)} height={Math.max(0, h - 2)} rx={8} fill={fill} fillOpacity={0.92} />
        {width > 64 && h > 38 && (<><text x={x + 10} y={y + 22} fontSize="12" fontWeight="700" fill="#2b1620">{String(name).length > Math.floor(width / 8) ? String(name).slice(0, Math.floor(width / 8) - 1) + "…" : name}</text>
          <text x={x + 10} y={y + 38} fontSize="11" fill="#2b1620" fillOpacity={0.8}>{fmt(value)}</text></>)}
      </g>
    );
  };
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <Treemap data={rows} dataKey="value" nameKey="name" stroke="none" content={<Cell2 />} isAnimationActive={false}>
          <Tooltip {...tip} formatter={(v: number) => fmt(v)} />
        </Treemap>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------------- people-style unit chart ---------------- */
export function UnitChart({ filled, total = 10, color = CORAL, restColor, caption }: { filled: number; total?: number; color?: string; restColor?: string; caption?: string }) {
  const n = Math.round(Math.min(total, Math.max(0, filled)));
  return (
    <div>
      <div className="flex flex-wrap gap-1" role="img" aria-label={caption ?? `${n} of ${total}`}>
        {Array.from({ length: total }).map((_, i) => <User key={i} className="h-7 w-7" fill={i < n ? color : "transparent"} stroke={i < n ? color : restColor ?? "hsl(var(--border))"} strokeWidth={1.5} />)}
      </div>
      {caption && <p className="mt-1.5 text-xs text-muted-foreground">{caption}</p>}
    </div>
  );
}

/* ---------------- sparkline ---------------- */
export function Sparkline({ data, dataKey, color = PINK, height = 36 }: { data: any[]; dataKey: string; color?: string; height?: number }) {
  if (data.length < 2 || data.every((d) => !d[dataKey])) return <div style={{ height }} />;
  const id = `sp-${dataKey}-${color.replace("#", "")}`;
  return (
    <div style={{ height }} aria-hidden>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 2, bottom: 0, left: 0, right: 0 }}>
          <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.45} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
          <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} fill={`url(#${id})`} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------------- stacked bars (e.g. categories by month) ---------------- */
export function StackedBars({ data, xKey, keys, height = 260, fmt = money, colors }: { data: any[]; xKey: string; keys: string[]; height?: number; fmt?: (n: number) => string; colors?: string[] }) {
  if (!data.length || !keys.length) return <Empty text="No data for this period." />;
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: -8, right: 4 }}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey={xKey} {...axis} />
          <YAxis {...axis} tickFormatter={compact} />
          <Tooltip {...tip} formatter={(v: number) => fmt(v)} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {keys.map((k, i) => <Bar key={k} dataKey={k} stackId="s" fill={(colors ?? PALETTE)[i % (colors ?? PALETTE).length]} radius={i === keys.length - 1 ? [4, 4, 0, 0] : 0} />)}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------------- bars + line (income, expense, net) ---------------- */
export function FlowChart({ data, xKey, height = 260 }: { data: any[]; xKey: string; height?: number }) {
  if (!data.length) return <Empty text="No data for this period." />;
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ left: -8, right: 4 }}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey={xKey} {...axis} />
          <YAxis {...axis} tickFormatter={compact} />
          <Tooltip {...tip} formatter={(v: number) => money(v)} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="income" name="Income" fill={MINT} radius={[4, 4, 0, 0]} />
          <Bar dataKey="expense" name="Expenses" fill={CORAL} radius={[4, 4, 0, 0]} />
          <Line type="monotone" dataKey="savings" name="Net savings" stroke={PINK} strokeWidth={3} dot={{ r: 3, fill: PINK }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export const TONES = { SKY, MINT, SUN, CORAL, PINK };
