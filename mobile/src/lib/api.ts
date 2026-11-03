/**
 * REST client for the RubiCore backend: the same FastAPI service and database the website uses.
 * The phone opens with the PIN via POST /auth/token (a 30 day bearer token kept in the device's secure storage).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

const URL_KEY = "rubicore_api_url";
const TOKEN_KEY = "rubicore_token";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let base = "";
let token: string | null = null;
let unauthorized: (() => void) | null = null;

/** Best guess for the backend address. With Expo on the same Wi-Fi the laptop's address is known from the dev server. */
export function guessApiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  if (host && !/exp\.direct|ngrok|expo\.dev/.test(host)) return `http://${host}:8000`;
  return "http://localhost:8000";
}

export function cleanUrl(u: string): string {
  let s = u.trim().replace(/\/+$/, "").replace(/\/api$/, "");
  if (s && !/^https?:\/\//i.test(s)) s = (/^(localhost|\d+\.\d+\.\d+\.\d+)/.test(s) ? "http://" : "https://") + s;
  return s;
}

export async function loadSession(): Promise<{ url: string; hasToken: boolean }> {
  base = (await AsyncStorage.getItem(URL_KEY)) || guessApiUrl();
  token = await SecureStore.getItemAsync(TOKEN_KEY);
  return { url: base, hasToken: !!token };
}
export const getBaseUrl = () => base;
export const onUnauthorized = (fn: (() => void) | null) => { unauthorized = fn; };
export async function setBaseUrl(u: string) { base = cleanUrl(u); await AsyncStorage.setItem(URL_KEY, base); }

async function request<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
  const ctl = new AbortController();
  // Free hosts (e.g. Render) sleep when idle and need up to about a minute to wake, so be patient.
  const timer = setTimeout(() => ctl.abort(), 70_000);
  let res: Response;
  try {
    res = await fetch(`${base}/api${path}`, {
      method, signal: ctl.signal,
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
        "ngrok-skip-browser-warning": "1",  // lets requests through ngrok's free-plan interstitial
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e: any) {
    throw new ApiError(0, e?.name === "AbortError" ? "The server took too long to answer. If it is hosted on a free plan it may have been asleep: wait a moment and try again." : `Can't reach the server at ${base}. Check the address in Settings and that the backend is running.`);
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 && auth) {
    unauthorized?.();
    throw new ApiError(401, "Please enter your PIN again.");
  }
  if (!res.ok) {
    let msg = res.statusText || `Error ${res.status}`;
    try {
      const j = await res.json();
      msg = typeof j.detail === "string" ? j.detail : Array.isArray(j.detail) ? j.detail.map((d: any) => d.msg).join("; ") : j.detail?.message ?? msg;
    } catch {}
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError(0, `${base} answered, but not like the RubiCore backend. Check the address and the port (the backend is usually port 8000; Expo's own port is different).`);
  }
}

export const api = {
  get: <T,>(p: string) => request<T>("GET", p),
  post: <T,>(p: string, b?: unknown) => request<T>("POST", p, b ?? {}),
  put: <T,>(p: string, b: unknown) => request<T>("PUT", p, b),
  del: (p: string) => request<void>("DELETE", p),
};

export const qs = (o: Record<string, string | number | undefined | null>) => {
  const p = Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return p.length ? `?${p.join("&")}` : "";
};

export async function signIn(pin: string): Promise<void> {
  const r = await request<{ access_token: string }>("POST", "/auth/token", { pin }, false);
  if (!r || typeof r.access_token !== "string" || !r.access_token) {
    throw new ApiError(0, `${base} is not the RubiCore backend (it didn't return a token). Check the address and the port: the backend is usually port 8000.`);
  }
  token = r.access_token;
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function signOut(): Promise<void> {
  token = null;
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

/** Is there a RubiCore backend at this address? */
export async function pingServer(url: string): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 60_000);  // a sleeping free-tier server can take about a minute to wake
    const r = await fetch(`${cleanUrl(url)}/health`, { signal: ctl.signal, headers: { "ngrok-skip-browser-warning": "1" } });
    clearTimeout(t);
    const j = await r.json();
    return r.ok && j.status === "ok";
  } catch {
    return false;
  }
}

export type User = { id: number; email: string; username: string | null; name: string; currency: string };
