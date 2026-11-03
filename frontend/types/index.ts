export type User = { id: number; email: string; username: string | null; name: string; currency: string };
export type Account = { id: number; name: string; type: "cash" | "bank" | "wallet"; opening_balance: number; opening_date: string; is_active: boolean };
export type Category = { id: number; name: string; type: "income" | "expense"; color: string; is_default: boolean; subcategories: { id: number; name: string }[] };
export type Transaction = {
  id: number; type: "income" | "expense" | "transfer"; amount: number; date: string; account_id: number;
  transfer_account_id: number | null; category_id: number | null; subcategory_id: number | null;
  category_name: string | null; subcategory_name: string | null; payment_method: string; description: string; notes: string | null;
};
export type CatAmount = { category: string; color: string; amount: number; count: number };
export type Quote = {
  symbol: string; name?: string; price?: number; change?: number; change_pct?: number; previous_close?: number;
  day_high?: number; day_low?: number; volume?: number; week52_high?: number; week52_low?: number; currency?: string; error?: string; label?: string;
};
export type Article = { title: string; url: string; source: string; summary: string; published_at: string; category: string; important?: boolean };
export type Source = { type: "private" | "public"; tool: string; server?: string };
export type ChatMsg = { id?: number; role: "user" | "assistant"; content: string; sources?: Source[] };
