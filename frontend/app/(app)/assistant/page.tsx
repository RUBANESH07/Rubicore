"use client";
import { Database, Globe, ShieldCheck } from "lucide-react";
import { ChatPanel } from "@/components/chatbot/ChatPanel";
import { PageHeader } from "@/components/common/states";

export default function AssistantPage() {
  return (
    <>
      <PageHeader title="AI Assistant" sub="One assistant, two separate data systems." />
      <div className="mb-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
        <div className="flex items-start gap-2 rounded-lg border bg-card p-3"><Database className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span><b className="text-foreground">Your data</b> — transactions, balances and budgets are read through the internal finance API.</span></div>
        <div className="flex items-start gap-2 rounded-lg border bg-card p-3"><Globe className="mt-0.5 h-4 w-4 shrink-0 text-success" /><span><b className="text-foreground">Public data</b> — markets, news, weather and economy come from sandboxed MCP servers.</span></div>
        <div className="flex items-start gap-2 rounded-lg border bg-card p-3"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><span><b className="text-foreground">Isolated</b> — MCP servers never receive your financial records or credentials.</span></div>
      </div>
      <ChatPanel />
    </>
  );
}
