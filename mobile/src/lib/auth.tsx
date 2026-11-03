import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { APP_PIN } from "../config";
import { User, api, loadSession, onUnauthorized, signIn, signOut } from "./api";

type Ctx = { ready: boolean; user: User | null; refresh: () => Promise<void> };
const AuthCtx = createContext<Ctx | null>(null);

export const useAuth = () => {
  const c = useContext(AuthCtx);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  /** Load the user; if the phone has no valid token yet, get one with the PIN first. No screen involved. */
  const refresh = useCallback(async () => {
    try { setUser(await api.get<User>("/auth/me")); return; } catch { /* no token, or an expired one */ }
    try { await signIn(APP_PIN); setUser(await api.get<User>("/auth/me")); } catch { setUser(null); }
  }, []);

  useEffect(() => {
    onUnauthorized(() => { signOut().finally(() => void refresh()); });
    (async () => {
      await loadSession();
      await refresh();
      setReady(true);
    })();
    return () => onUnauthorized(null);
  }, [refresh]);

  return <AuthCtx.Provider value={{ ready, user, refresh }}>{children}</AuthCtx.Provider>;
}
