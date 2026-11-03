"use client";
import { Lock, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Async, PageHeader, SectionTitle } from "@/components/common/states";
import { Badge, Button, Card, Switch } from "@/components/ui";
import { useFetch } from "@/hooks/useApi";
import { api } from "@/lib/api";

type Server = { name: string; title: string; description: string; permissions: string[]; enabled: boolean };

function Tools({ name }: { name: string }) {
  const t = useFetch<{ name: string; description: string }[]>(`/integrations/mcp/${name}/tools`);
  return (
    <Async state={t}>{(d) => (
      <ul className="mt-3 space-y-1.5 border-t pt-3 text-sm">
        {d.map((x) => <li key={x.name}><code className="rounded bg-muted px-1.5 py-0.5 text-xs">{x.name}</code> <span className="text-muted-foreground">{x.description.split(".")[0]}.</span></li>)}
      </ul>
    )}</Async>
  );
}

export default function IntegrationsPage() {
  const s = useFetch<{ servers: Server[]; policy: string }>("/integrations/mcp");
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <PageHeader title="MCP Integrations" sub="Public-information tools the assistant can use." />
      <Card className="mb-4 flex items-start gap-3 border-primary/30 bg-primary/5">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="text-sm"><b>Privacy boundary.</b> {s.data?.policy ?? "Public MCP servers have no access to your financial records."}
          <ul className="mt-1 list-disc pl-5 text-muted-foreground"><li>Servers run as separate processes with a scrubbed environment: no database URL, session secret or API keys.</li><li>Only tools a server advertises can be called; arguments are validated and length-limited.</li><li>Arguments that look like personal identifiers are blocked before leaving the app.</li></ul></div>
      </Card>
      <Async state={s}>{(d) => (
        <div className="grid gap-4 md:grid-cols-2">
          {d.servers.map((srv) => (
            <Card key={srv.name}>
              <div className="flex items-start justify-between gap-3">
                <div><h3 className="font-semibold">{srv.title}</h3><p className="text-sm text-muted-foreground">{srv.description}</p></div>
                <Switch checked={srv.enabled} onChange={async (v) => { await api.put(`/integrations/mcp/${srv.name}`, { enabled: v }); s.reload(); }} />
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">{srv.permissions.map((p) => <Badge key={p}><Lock className="mr-1 h-3 w-3" />{p}</Badge>)}</div>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => setOpen(open === srv.name ? null : srv.name)}>{open === srv.name ? "Hide tools" : "Inspect tools"}</Button>
              {open === srv.name && <Tools name={srv.name} />}
            </Card>
          ))}
        </div>
      )}</Async>
    </>
  );
}
