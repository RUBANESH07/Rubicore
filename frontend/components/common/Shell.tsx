"use client";
import { BarChart3, Bell, Bike, Bot, Calculator, Cpu, FileText, Folder, Fuel, History, Landmark, LayoutDashboard, LineChart, Map as MapIcon, ParkingCircle, Play, Radio, SlidersHorizontal, Lock, LogOut, Menu, Moon, Newspaper, Plus, Receipt, Search, Settings, Sparkles, Sun, TrendingUp, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChatPanel } from "@/components/chatbot/ChatPanel";
import { LockScreen } from "@/components/common/LockScreen";
import { Loading } from "@/components/common/states";
import { TransactionModal } from "@/components/transactions/TransactionModal";
import { Button } from "@/components/ui";
import { AppCtx, useMeta } from "@/hooks/useApp";
import { useFetch } from "@/hooks/useApi";
import { api } from "@/lib/api";
import { cn, fmtDate } from "@/lib/utils";
import type { Transaction, User } from "@/types";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/transactions", label: "Transactions", icon: Receipt },
  { href: "/finance", label: "Financial Analysis", icon: LineChart },
  { href: "/stocks", label: "Stocks", icon: TrendingUp, module: "stocks" },
  { href: "/news", label: "News", icon: Newspaper, module: "news" },
  { href: "/deposits", label: "FD & RD Calculator", icon: Landmark, module: "deposits" },
  { href: "/assistant", label: "AI Assistant", icon: Bot, module: "assistant" },
  { href: "/reports", label: "Reports", icon: Calculator },
  { href: "/categories", label: "Categories", icon: Folder },
  { href: "/integrations", label: "MCP Integrations", icon: Cpu },
  { href: "/settings", label: "Settings", icon: Settings },
];

// RubiRide: bike & ride intelligence (its own module, toggled by modules.rides)
const RIDE_NAV = [
  { href: "/ride", label: "Overview", icon: Bike },
  { href: "/ride/live", label: "Live Tracking", icon: Radio },
  { href: "/ride/start", label: "Start a Ride", icon: Play },
  { href: "/ride/history", label: "Ride History", icon: History },
  { href: "/ride/routes", label: "Route Maps", icon: MapIcon },
  { href: "/ride/analytics", label: "Ride Analytics", icon: BarChart3 },
  { href: "/ride/fuel", label: "Fuel & Mileage", icon: Fuel },
  { href: "/ride/parking", label: "Parking Location", icon: ParkingCircle },
  { href: "/ride/reports", label: "Reports", icon: FileText },
  { href: "/ride/settings", label: "Settings", icon: SlidersHorizontal },
];

function useTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("theme", next ? "dark" : "light"); } catch {}
  };
  return { dark, toggle };
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const { data, reload } = useFetch<{ items: { id: number; title: string; body: string; is_read: boolean; kind: string; created_at: string }[]; unread: number }>("/notifications");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    api.post("/news/check-important").then(reload).catch(() => {});
    return () => document.removeEventListener("mousedown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="relative" ref={ref}>
      <Button variant="ghost" size="icon" aria-label="Notifications" onClick={async () => { setOpen(!open); if (!open) { reload(); } }}>
        <Bell className="h-4 w-4" />
        {!!data?.unread && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-danger" />}
      </Button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 max-w-[90vw] rounded-lg border bg-card shadow-lg">
          <div className="flex items-center justify-between border-b px-3 py-2 text-sm font-semibold">
            Notifications
            <button className="text-xs font-normal text-primary" onClick={async () => { await api.post("/notifications/read"); reload(); }}>Mark all read</button>
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {!data?.items.length && <li className="p-4 text-center text-sm text-muted-foreground">You're all caught up.</li>}
            {data?.items.map((n) => (
              <li key={n.id} className={cn("border-b px-3 py-2 text-sm last:border-0", !n.is_read && "bg-primary/5")}>
                <div className="font-medium">{n.title}</div>
                <div className="line-clamp-2 text-xs text-muted-foreground">{n.body}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function NavLink({ n, path }: { n: { href: string; label: string; icon: React.ComponentType<{ className?: string }> }; path: string }) {
  const active = path === n.href || (n.href !== "/ride" && path.startsWith(n.href + "/"));
  return (
    <Link href={n.href} className={cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition", active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
      <n.icon className="h-4 w-4" /> {n.label}
    </Link>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const meta = useMeta();
  const theme = useTheme();
  const [user, setUser] = useState<User | null>(null);
  const [nav, setNav] = useState(false);
  const [adding, setAdding] = useState<{ open: boolean; tx?: Transaction | null }>({ open: false });
  const [ask, setAsk] = useState(false);
  const [q, setQ] = useState("");
  const [faceOn, setFaceOn] = useState(false);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    api.get<User>("/auth/me").then(setUser).catch(() => router.replace("/login"));
  }, [router]);

  // Face lock: the server decides when a session is locked (idle timeout / manual lock). Any 423 shows the lock screen,
  // and a light poll notices an idle timeout while the page sits untouched.
  useEffect(() => {
    const check = () => api.get<{ enrolled: boolean; locked: boolean }>("/face/status")
      .then((s) => { setFaceOn(s.enrolled); if (s.locked) setLocked(true); }).catch(() => {});
    const onLocked = () => { setLocked(true); setFaceOn(true); };
    check();
    window.addEventListener("rp-locked", onLocked);
    window.addEventListener("rp-face-changed", check);
    const t = setInterval(check, 30000);
    return () => { window.removeEventListener("rp-locked", onLocked); window.removeEventListener("rp-face-changed", check); clearInterval(t); };
  }, []);
  useEffect(() => setNav(false), [path]);
  useEffect(() => { if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {}); }, []);

  if (!user) return <div className="grid min-h-screen place-items-center"><Loading label="Loading RubiCore…" /></div>;

  const items = NAV.filter((n) => !n.module || meta.modules[n.module] !== false);
  return (
    <AppCtx.Provider value={{ user, ...meta, openAdd: (tx) => setAdding({ open: true, tx }), openAsk: () => setAsk(true) }}>
      <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
        {nav && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setNav(false)} />}
        <aside className={cn("fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r bg-card p-3 transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0", nav ? "translate-x-0" : "-translate-x-full")}>
          <div className="mb-4 flex items-center justify-between px-2 pt-1">
            <Link href="/dashboard" className="flex items-center gap-2 text-lg font-bold tracking-tight">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground"><Sparkles className="h-4 w-4" /></span>
              RubiCore
            </Link>
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setNav(false)} aria-label="Close menu"><X className="h-4 w-4" /></Button>
          </div>
          <nav className="flex-1 space-y-0.5 overflow-y-auto">
            {items.map((n) => <NavLink key={n.href} n={n} path={path} />)}
            {meta.modules.rides !== false && (
              <>
                <div className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">RubiRide</div>
                {RIDE_NAV.map((n) => <NavLink key={n.href} n={n} path={path} />)}
              </>
            )}
          </nav>
          <p className="px-2 pt-3 text-[11px] leading-snug text-muted-foreground">Track Your Day. Understand Your Money. Explore the World.</p>
        </aside>

        <div className="min-w-0">
          <header className="sticky top-0 z-20 flex items-center gap-2 border-b bg-background/80 px-4 py-2.5 backdrop-blur">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setNav(true)} aria-label="Open menu"><Menu className="h-4 w-4" /></Button>
            <form className="relative max-w-sm flex-1" onSubmit={(e) => { e.preventDefault(); if (q.trim()) router.push(`/transactions?q=${encodeURIComponent(q.trim())}`); }}>
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search transactions…" aria-label="Search"
                className="h-9 w-full rounded-md border bg-card pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/40" />
            </form>
            <div className="ml-auto flex items-center gap-1">
              <span className="mr-2 hidden text-sm text-muted-foreground md:block">{fmtDate(new Date().toISOString())}</span>
              <Notifications />
              <Button variant="ghost" size="icon" aria-label="Lock now" title="Lock now" onClick={async () => { await api.post("/auth/lock"); setLocked(true); }}><Lock className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" onClick={theme.toggle} aria-label="Toggle theme">{theme.dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</Button>
              <div className="ml-1 flex items-center gap-2 rounded-full border bg-card py-1 pl-1 pr-3">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{user.name[0]?.toUpperCase()}</span>
                <span className="hidden text-sm font-medium sm:block">{user.name}</span>
              </div>
              <Button variant="ghost" size="icon" aria-label="Lock and sign out" onClick={async () => { await api.post("/auth/logout"); router.replace("/login"); }}><LogOut className="h-4 w-4" /></Button>
            </div>
          </header>
          <main className="mx-auto max-w-7xl p-4 pb-28 md:p-6 md:pb-28" key={meta.version}>{children}</main>
        </div>
      </div>

      <div className="fixed bottom-5 right-5 z-30 flex flex-col items-end gap-2">
        {modules(meta.modules, "assistant") && (
          <Button variant="outline" className="rounded-full shadow-lg" onClick={() => setAsk(true)}><Sparkles className="h-4 w-4 text-primary" /> Ask AI</Button>
        )}
        <Button className="h-12 rounded-full px-5 shadow-lg" onClick={() => setAdding({ open: true })}><Plus className="h-5 w-5" /> Add Transaction</Button>
      </div>

      {locked && <LockScreen name={user.name} email={user.email} onUnlocked={() => { setLocked(false); meta.bump(); }} />}
      <TransactionModal open={adding.open} editing={adding.tx} onClose={() => setAdding({ open: false })} />
      {ask && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onMouseDown={() => setAsk(false)}>
          <div className="flex h-full w-full max-w-md flex-col gap-3 border-l bg-background p-4 shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between"><h2 className="font-semibold">RubiCore AI</h2>
              <Button variant="ghost" size="icon" onClick={() => setAsk(false)} aria-label="Close"><X className="h-4 w-4" /></Button></div>
            <div className="min-h-0 flex-1 rounded-lg border bg-card"><ChatPanel compact /></div>
          </div>
        </div>
      )}
    </AppCtx.Provider>
  );
}

const modules = (m: Record<string, boolean>, k: string) => m[k] !== false;
