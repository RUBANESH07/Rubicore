"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Account, Category, User } from "@/types";

type Ctx = {
  user: User; accounts: Account[]; categories: Category[]; modules: Record<string, boolean>;
  refreshMeta: () => Promise<void>; bump: () => void; version: number; openAdd: (tx?: any) => void; openAsk: () => void;
};
export const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp outside provider");
  return c;
};

/** `version` increments after any data change so pages can refetch. */
export function useMeta() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [modules, setModules] = useState<Record<string, boolean>>({});
  const [version, setVersion] = useState(0);
  const refreshMeta = useCallback(async () => {
    const [a, c, m] = await Promise.all([
      api.get<Account[]>("/accounts"),
      api.get<Category[]>("/categories"),
      api.get<{ key: string; enabled: boolean }[]>("/modules"),
    ]);
    setAccounts(a);
    setCategories(c);
    setModules(Object.fromEntries(m.map((x) => [x.key, x.enabled])));
  }, []);
  useEffect(() => {
    refreshMeta().catch(() => {});
  }, [refreshMeta]);
  return { accounts, categories, modules, refreshMeta, version, bump: () => setVersion((v) => v + 1) };
}
