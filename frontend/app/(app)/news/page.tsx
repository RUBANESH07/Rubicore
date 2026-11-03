"use client";
import { Bookmark, BookmarkCheck, ExternalLink } from "lucide-react";
import { useState } from "react";
import { AiNotice, Async, Loading, PageHeader, SectionTitle } from "@/components/common/states";
import { Badge, Button, Card, Input, Tabs } from "@/components/ui";
import { useFetch } from "@/hooks/useApi";
import { api, qs } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Article } from "@/types";

const CATS: [string, string][] = [["technology", "Technology"], ["ai", "AI"], ["business", "Business"], ["finance", "Finance"], ["stock-market", "Stock Market"], ["economy", "Economy"], ["startups", "Startups"], ["science", "Science"], ["global", "Global"], ["india", "India"]];
const ago = (s: string) => {
  if (!s) return "";
  const m = Math.max(0, Math.round((Date.now() - new Date(s).getTime()) / 60000));
  return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};

type Saved = Article & { id: number };

function ArticleCard({ a, saved, onToggle }: { a: Article; saved?: Saved; onToggle: () => void }) {
  return (
    <Card className="flex gap-3">
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{a.source}</span><span>{ago(a.published_at)}</span>
          {a.important && <Badge tone="warning">Important</Badge>}
        </div>
        <a href={a.url} target="_blank" rel="noopener noreferrer" className="font-semibold leading-snug hover:text-primary">{a.title}</a>
        {a.summary && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{a.summary}</p>}
        <a href={a.url} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-xs text-primary">Read source <ExternalLink className="h-3 w-3" /></a>
      </div>
      <button aria-label={saved ? "Remove from saved" : "Save article"} onClick={onToggle} className="self-start text-muted-foreground hover:text-primary">
        {saved ? <BookmarkCheck className="h-5 w-5 text-primary" /> : <Bookmark className="h-5 w-5" />}
      </button>
    </Card>
  );
}

export default function NewsPage() {
  const [view, setView] = useState<"feed" | "saved" | "briefing">("feed");
  const [cat, setCat] = useState("business");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const feed = useFetch<Article[]>(view === "feed" ? `/news${qs({ category: cat, q: query, limit: 24 })}` : null);
  const saved = useFetch<Saved[]>("/news/saved");
  const brief = useFetch<{ briefing: string | null; headlines: Article[] }>(view === "briefing" ? "/news/briefing" : null);
  const find = (a: Article) => saved.data?.find((s) => s.url === a.url);
  const toggle = async (a: Article) => {
    const s = find(a);
    s ? await api.del(`/news/saved/${s.id}`) : await api.post("/news/saved", { title: a.title, url: a.url, source: a.source, category: cat, summary: a.summary, published_at: a.published_at });
    saved.reload();
  };

  return (
    <>
      <PageHeader title="News" sub="Public headlines from RSS feeds and Google News" right={<Tabs value={view} onChange={setView} tabs={[{ id: "feed", label: "Headlines" }, { id: "briefing", label: "Daily briefing" }, { id: "saved", label: "Saved" }]} />} />
      {view === "feed" && (
        <div className="space-y-4">
          <form className="flex max-w-md gap-2" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search news…" maxLength={100} />
            <Button>Search</Button>
            {query && <Button type="button" variant="outline" onClick={() => { setQ(""); setQuery(""); }}>Clear</Button>}
          </form>
          <div className="flex flex-wrap gap-2">
            {CATS.map(([k, l]) => (
              <button key={k} onClick={() => { setCat(k); setQuery(""); setQ(""); }} className={cn("rounded-full border px-3 py-1 text-sm transition", cat === k && !query ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>{l}</button>
            ))}
          </div>
          <Async state={feed} empty={(d) => !d.length && "No headlines found. Try another category or search."}>{(d) => (
            <div className="grid gap-3 lg:grid-cols-2">{d.map((a) => <ArticleCard key={a.url} a={a} saved={find(a)} onToggle={() => toggle(a)} />)}</div>
          )}</Async>
        </div>
      )}
      {view === "briefing" && (
        <div className="space-y-4">
          <Card className="bg-gradient-to-br from-primary/10 to-transparent">
            <SectionTitle title="Today's briefing" right={<AiNotice />} />
            {brief.loading ? <Loading label="Reading the headlines…" /> : brief.data?.briefing ? <div className="whitespace-pre-wrap text-sm leading-relaxed">{brief.data.briefing}</div> : <p className="text-sm text-muted-foreground">AI briefing is unavailable right now. The headlines below are still current.</p>}
          </Card>
          {brief.data && <div className="grid gap-3 lg:grid-cols-2">{brief.data.headlines.slice(0, 12).map((a) => <ArticleCard key={a.url} a={a} saved={find(a)} onToggle={() => toggle(a)} />)}</div>}
        </div>
      )}
      {view === "saved" && (
        <Async state={saved} empty={(d) => !d.length && "No saved articles yet. Tap the bookmark on any story."}>{(d) => (
          <div className="grid gap-3 lg:grid-cols-2">{d.map((a) => <ArticleCard key={a.id} a={a} saved={a} onToggle={() => toggle(a)} />)}</div>
        )}</Async>
      )}
    </>
  );
}
