import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...i: ClassValue[]) => twMerge(clsx(i));

export const money = (n: number | null | undefined, opts: Intl.NumberFormatOptions = {}) =>
  n == null ? "—" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0, ...opts }).format(n);

export const num = (n: number | null | undefined, d = 2) =>
  n == null ? "—" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: d }).format(n);

export const pct = (n: number | null | undefined) => (n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`);

export const iso = (d: Date) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};

export const fmtDate = (s: string) =>
  new Date(s.length === 10 ? s + "T00:00:00" : s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

// Chart colours: dark pink first, then light blue, green, yellow, red, and softer tints of the same family.
export const PINK = "#be185d";
export const SKY = "#7cc4e6";
export const MINT = "#8bd2a6";
export const SUN = "#f3cf6a";
export const CORAL = "#f08c8c";
export const PALETTE = [PINK, SKY, MINT, SUN, CORAL, "#e8a3c4", "#5aaedb", "#5dbd88", "#e6b94a", "#d96a6a"];
// Single-hue pink ramp for heatmaps (none -> strongest)
export const PINK_RAMP = ["#efe7e2", "#f4cfdf", "#e99bbd", "#d1558c", "#be185d"];
