import { AlertCircle, Inbox, Loader2 } from "lucide-react";
import { Button, Card } from "@/components/ui";

export const Loading = ({ label = "Loading…" }: { label?: string }) => (
  <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground" role="status">
    <Loader2 className="h-4 w-4 animate-spin" /> {label}
  </div>
);

export const ErrorState = ({ message, retry }: { message: string; retry?: () => void }) => (
  <div className="flex flex-col items-center gap-2 py-8 text-center text-sm">
    <AlertCircle className="h-5 w-5 text-danger" />
    <p className="text-muted-foreground">{message}</p>
    {retry && (
      <Button variant="outline" size="sm" onClick={retry}>
        Try again
      </Button>
    )}
  </div>
);

export const Empty = ({ text, action }: { text: string; action?: React.ReactNode }) => (
  <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
    <Inbox className="h-6 w-6" /> <p>{text}</p> {action}
  </div>
);

/** Renders loading / error / empty / data for a useFetch result. */
export function Async<T>({ state, children, empty }: {
  state: { data: T | null; error: string | null; loading: boolean; reload: () => void };
  children: (d: T) => React.ReactNode;
  empty?: (d: T) => boolean | string;
}) {
  if (state.loading && !state.data) return <Loading />;
  if (state.error && !state.data) return <ErrorState message={state.error} retry={state.reload} />;
  if (!state.data) return null;
  const e = empty?.(state.data);
  if (e) return <Empty text={typeof e === "string" ? e : "Nothing here yet."} />;
  return <>{children(state.data)}</>;
}

export const SectionTitle = ({ title, right, sub }: { title: string; right?: React.ReactNode; sub?: string }) => (
  <div className="mb-3 flex items-start justify-between gap-2">
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
    {right}
  </div>
);

export const PageHeader = ({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) => (
  <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {sub && <p className="text-sm text-muted-foreground">{sub}</p>}
    </div>
    {right}
  </div>
);

export const StatCard = ({ label, value, sub, tone, icon }: { label: string; value: string; sub?: string; tone?: "success" | "danger"; icon?: React.ReactNode }) => (
  <Card>
    <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
      {label}
      {icon}
    </div>
    <div className={`mt-1 text-2xl font-bold tracking-tight ${tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : ""}`}>{value}</div>
    {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
  </Card>
);

export const AiNotice = ({ children }: { children?: React.ReactNode }) => (
  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">✨ {children ?? "AI-generated"}</span>
);
