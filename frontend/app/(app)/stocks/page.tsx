"use client";
import { Plus, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { MultiLine, PriceChart } from "@/components/charts";
import { AiNotice, Async, Loading, PageHeader, SectionTitle } from "@/components/common/states";
import { Badge, Button, Card, Input, Select, Tabs } from "@/components/ui";
import { useFetch } from "@/hooks/useApi";
import { api } from "@/lib/api";
import { cn, money, num, pct } from "@/lib/utils";
import type { Article, Quote } from "@/types";

const Disclaimer = ({ text }: { text?: string }) => (
  <p className="text-xs text-muted-foreground">{text ?? "Informational only. Data may be delayed. Not investment advice."}</p>
);
const tone = (n?: number | null) => ((n ?? 0) >= 0 ? "text-success" : "text-danger");

function QuoteRow({ q, onSelect, onRemove }: { q: Quote; onSelect: () => void; onRemove?: () => void }) {
  return (
    <li className="flex items-center justify-between gap-2 py-2 text-sm">
      <button onClick={onSelect} className="min-w-0 text-left"><div className="font-medium">{q.symbol?.replace(/\.(NS|BO)$/, "")}</div><div className="truncate text-xs text-muted-foreground">{q.name}</div></button>
      <div className="flex items-center gap-3">
        {q.error ? <span className="text-xs text-muted-foreground">unavailable</span> : (
          <div className="text-right tabular-nums"><div>{num(q.price)}</div><div className={cn("text-xs", tone(q.change_pct))}>{pct(q.change_pct)}</div></div>
        )}
        {onRemove && <button aria-label="Remove" onClick={onRemove} className="text-muted-foreground hover:text-danger"><Trash2 className="h-4 w-4" /></button>}
      </div>
    </li>
  );
}

function Detail({ symbol }: { symbol: string }) {
  const [range, setRange] = useState("3mo");
  const hist = useFetch<{ points: { t: number; close: number }[]; performance_pct: number | null }>(`/stocks/history/${encodeURIComponent(symbol)}?range=${range}`);
  const an = useFetch<any>(`/stocks/analysis/${encodeURIComponent(symbol)}`);
  const news = useFetch<Article[]>(`/stocks/news/${encodeURIComponent(symbol)}`);
  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle title={`${symbol} price history`} right={<Select className="w-28" value={range} onChange={(e) => setRange(e.target.value)}>{["5d", "1mo", "3mo", "6mo", "1y", "5y"].map((r) => <option key={r}>{r}</option>)}</Select>} />
        <Async state={hist}>{(h) => (<><PriceChart points={h.points} /><p className={cn("mt-1 text-sm", tone(h.performance_pct))}>Period performance {pct(h.performance_pct)}</p></>)}</Async>
      </Card>
      <Async state={an}>{(a) => {
        const q = a.factual.quote, ind = a.factual.indicators, f = a.factual.fundamentals ?? {};
        return (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <SectionTitle title="Market data" right={<Badge tone="muted">Factual</Badge>} />
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                {[["Price", num(q.price)], ["Day change", pct(q.change_pct)], ["Day range", `${num(q.day_low)} – ${num(q.day_high)}`], ["52-week range", `${num(q.week52_low)} – ${num(q.week52_high)}`],
                  ["Volume", num(q.volume, 0)], ["Avg volume (20d)", num(ind.avg_volume_20d, 0)], ["SMA 20 / 50", `${num(ind.sma20)} / ${num(ind.sma50)}`], ["RSI (14)", num(ind.rsi14, 1)],
                  ["MACD hist.", num(ind.macd_hist)], ["Volatility (ann.)", ind.volatility_annual_pct != null ? `${ind.volatility_annual_pct}%` : "—"],
                  ...(f.sector ? [["Sector", f.sector]] : []), ...(f.market_cap ? [["Market cap", money(f.market_cap, { notation: "compact" })]] : []),
                  ...(f.pe_ratio ? [["P/E", num(f.pe_ratio, 1)]] : []), ...(f.price_to_book ? [["P/B", num(f.price_to_book, 1)]] : []),
                  ...(f.roe ? [["ROE", pct(f.roe * 100)]] : []), ...(f.debt_to_equity ? [["Debt/Equity", num(f.debt_to_equity, 1)]] : [])].map(([k, v]) => (
                  <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-medium tabular-nums">{v}</dd></div>
                ))}
              </dl>
              {!f.sector && <p className="mt-2 text-xs text-muted-foreground">Fundamentals unavailable from the free provider right now.</p>}
            </Card>
            <Card>
              <SectionTitle title="Observations" right={<Badge tone="muted">Rule-based</Badge>} />
              {([["Bullish", a.observations.bullish, "success"], ["Bearish", a.observations.bearish, "danger"], ["Risk indicators", a.observations.risk, "warning"]] as const).map(([t, items, c]) => (
                <div key={t} className="mb-2"><Badge tone={c}>{t}</Badge>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">{items.length ? items.map((s: string) => <li key={s}>{s}</li>) : <li className="list-none text-muted-foreground">None flagged</li>}</ul></div>
              ))}
            </Card>
            <Card className="lg:col-span-2">
              <SectionTitle title="AI commentary" right={<AiNotice>AI-generated · not advice</AiNotice>} />
              <p className="text-sm leading-relaxed">{a.ai_commentary.text ?? "AI commentary is unavailable right now."}</p>
              <div className="mt-2"><Disclaimer text={a.disclaimer} /></div>
            </Card>
          </div>
        );
      }}</Async>
      <Card>
        <SectionTitle title="Company news" />
        <Async state={news} empty={(d) => !d.length && "No recent news found."}>{(d) => (
          <ul className="space-y-2">{d.slice(0, 6).map((n) => <li key={n.url}><a href={n.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium hover:text-primary">{n.title}</a><p className="text-xs text-muted-foreground">{n.source}</p></li>)}</ul>
        )}</Async>
      </Card>
    </div>
  );
}

function Compare() {
  const [syms, setSyms] = useState("RELIANCE,TCS,INFY");
  const [go, setGo] = useState("RELIANCE,TCS,INFY");
  const r = useFetch<{ data: any[] }>(`/stocks/compare?symbols=${encodeURIComponent(go)}&range=6mo`);
  return (
    <Card>
      <SectionTitle title="Compare stocks" sub="Percentage change over 6 months (2-5 symbols, comma separated)" />
      <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); setGo(syms); }}><Input value={syms} onChange={(e) => setSyms(e.target.value)} /><Button>Compare</Button></form>
      <Async state={r}>{(d) => (
        <>
          <MultiLine series={d.data.filter((x) => x.series)} />
          <div className="mt-3 grid gap-2 sm:grid-cols-3">{d.data.map((x) => (
            <div key={x.symbol} className="rounded-md border p-2 text-sm"><div className="font-medium">{x.symbol}</div>
              {x.error ? <span className="text-xs text-muted-foreground">{x.error}</span> : <><div className={tone(x.performance_pct)}>{pct(x.performance_pct)}</div><div className="text-xs text-muted-foreground">RSI {x.indicators.rsi14 ?? "—"} · Vol {x.indicators.volatility_annual_pct ?? "—"}%</div></>}</div>
          ))}</div>
        </>
      )}</Async>
    </Card>
  );
}

export default function StocksPage() {
  const [tab, setTab] = useState<"market" | "compare">("market");
  const [selected, setSelected] = useState<string | null>(null);
  const [sym, setSym] = useState("");
  const [exchange, setExchange] = useState("NSE");
  const [err, setErr] = useState("");
  const summary = useFetch<any>("/stocks/market-summary");
  const wl = useFetch<{ id: number; symbol: string; quote: Quote }[]>("/stocks/watchlist");

  async function add(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    try { await api.post("/stocks/watchlist", { symbol: sym, exchange }); setSym(""); wl.reload(); } catch (e: any) { setErr(e.message); }
  }

  return (
    <>
      <PageHeader title="Stock Market" sub="NSE · BSE · NIFTY 50 · SENSEX — delayed public data" right={<Tabs value={tab} onChange={setTab} tabs={[{ id: "market", label: "Market" }, { id: "compare", label: "Compare" }]} />} />
      {tab === "compare" ? <Compare /> : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-1">
            <Card>
              <SectionTitle title="Indices" right={<Badge>Factual</Badge>} />
              <Async state={summary}>{(s) => (
                <ul className="divide-y">{s.indices.map((q: Quote) => <QuoteRow key={q.symbol} q={q} onSelect={() => setSelected(q.symbol)} />)}</ul>
              )}</Async>
            </Card>
            <Card>
              <SectionTitle title="Watchlist" right={<Star className="h-4 w-4 text-warning" />} />
              <form className="mb-3 flex gap-2" onSubmit={add}>
                <Input value={sym} onChange={(e) => setSym(e.target.value.toUpperCase())} placeholder="e.g. HDFCBANK" required />
                <Select className="w-24" value={exchange} onChange={(e) => setExchange(e.target.value)}><option>NSE</option><option>BSE</option></Select>
                <Button aria-label="Add" type="submit"><Plus className="h-4 w-4" /></Button>
              </form>
              {err && <p className="mb-2 text-sm text-danger" role="alert">{err}</p>}
              <Async state={wl} empty={(d) => !d.length && "Your watchlist is empty."}>{(d) => (
                <ul className="divide-y">{d.map((w) => <QuoteRow key={w.id} q={{ ...w.quote, symbol: w.symbol }} onSelect={() => setSelected(w.symbol)} onRemove={async () => { await api.del(`/stocks/watchlist/${w.id}`); wl.reload(); }} />)}</ul>
              )}</Async>
            </Card>
          </div>
          <div className="space-y-4 lg:col-span-2">
            <Card>
              <SectionTitle title="Daily market summary" right={<AiNotice />} />
              {summary.loading ? <Loading /> : <p className="text-sm leading-relaxed">{summary.data?.ai_summary?.text ?? "AI summary unavailable — see the index levels for the factual picture."}</p>}
              {summary.data?.gainers?.length > 0 && (
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div><div className="mb-1 text-xs font-medium text-muted-foreground">Watchlist gainers</div>{summary.data.gainers.map((q: Quote) => <div key={q.symbol} className="flex justify-between"><span>{q.symbol.replace(".NS", "")}</span><span className="text-success">{pct(q.change_pct)}</span></div>)}</div>
                  <div><div className="mb-1 text-xs font-medium text-muted-foreground">Watchlist losers</div>{summary.data.losers.map((q: Quote) => <div key={q.symbol} className="flex justify-between"><span>{q.symbol.replace(".NS", "")}</span><span className="text-danger">{pct(q.change_pct)}</span></div>)}</div>
                </div>
              )}
              <div className="mt-3"><Disclaimer text={summary.data?.disclaimer} /></div>
            </Card>
            {selected ? <Detail key={selected} symbol={selected} /> : <Card className="py-10 text-center text-sm text-muted-foreground">Select an index or a watchlist stock to see its chart, fundamentals, indicators and news.</Card>}
          </div>
        </div>
      )}
    </>
  );
}
