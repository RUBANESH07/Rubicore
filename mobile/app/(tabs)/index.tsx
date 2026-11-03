import { useRouter } from "expo-router";
import { View } from "react-native";
import { Async, Button, Card, Empty, Row, Screen, Stat, Txt, useLoad } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useTracker } from "@/lib/useTracker";
import { clock } from "@/lib/format";
import { inr, useTheme } from "@/theme";

type Overview = {
  balance: { total: number; by_type: Record<string, number> };
  today: { income: number; expense: number };
  month: { income: number; expense: number; savings: number; savings_rate: number };
  expense_breakdown: { category: string; amount: number }[];
  recent_transactions: { id: number; type: string; amount: number; date: string; category: string | null; description: string }[];
  daily_summary: string;
};

export default function Home() {
  const t = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const ov = useLoad<Overview>("/dashboard/overview");
  const trk = useTracker();
  const riding = trk.phase === "active" || trk.phase === "paused";

  return (
    <Screen onRefresh={ov.reload}>
      <View><Txt size={22} weight="700">Hello, {user?.name.split(" ")[0] ?? "there"}</Txt><Txt size={13} muted>{ov.data?.daily_summary ?? "Track Your Day. Understand Your Money."}</Txt></View>
      {riding && (
        <Card style={{ borderColor: t.primary, backgroundColor: t.card }}>
          <Txt weight="600" color={t.primary}>{trk.phase === "paused" ? "Ride paused" : "Ride in progress"}</Txt>
          <Txt size={22} weight="700">{trk.distanceKm.toFixed(2)} km · {clock(trk.elapsedSeconds)}</Txt>
          <View style={{ marginTop: 8 }}><Button title="Open ride" onPress={() => router.push("/ride")} /></View>
        </Card>
      )}
      <Async state={ov}>{(d) => (
        <>
          <Card>
            <Txt size={12} muted weight="500">Available balance</Txt>
            <Txt size={30} weight="700">{inr(d.balance.total)}</Txt>
            <Txt size={12} muted>Cash {inr(d.balance.by_type.cash)} · Bank {inr(d.balance.by_type.bank)} · Wallet {inr(d.balance.by_type.wallet)}</Txt>
          </Card>
          <Row>
            <Stat label="Today's income" value={inr(d.today.income)} tone="success" />
            <Stat label="Today's expenses" value={inr(d.today.expense)} tone="danger" />
          </Row>
          <Row>
            <Stat label="Saved this month" value={inr(d.month.savings)} tone={d.month.savings >= 0 ? "success" : "danger"} sub={`${d.month.savings_rate}% savings rate`} />
            <Stat label="Spent this month" value={inr(d.month.expense)} sub={`of ${inr(d.month.income)} income`} />
          </Row>
          <Button title="+ Add transaction" onPress={() => router.push("/add-transaction")} />
          <Card>
            <Txt weight="600" style={{ marginBottom: 8 }}>Top spending this month</Txt>
            {d.expense_breakdown.length ? d.expense_breakdown.slice(0, 5).map((c) => {
              const max = d.expense_breakdown[0].amount || 1;
              return (
                <View key={c.category} style={{ marginBottom: 8 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}><Txt size={13}>{c.category}</Txt><Txt size={13} muted>{inr(c.amount)}</Txt></View>
                  <View style={{ height: 6, borderRadius: 3, backgroundColor: t.border, marginTop: 3 }}><View style={{ height: 6, borderRadius: 3, width: `${(c.amount / max) * 100}%`, backgroundColor: t.primary }} /></View>
                </View>
              );
            }) : <Empty text="No spending recorded this month." />}
          </Card>
          <Card>
            <Txt weight="600" style={{ marginBottom: 6 }}>Recent activity</Txt>
            {d.recent_transactions.length ? d.recent_transactions.map((x) => (
              <View key={x.id} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 7, borderTopWidth: 1, borderColor: t.border }}>
                <View style={{ flex: 1, paddingRight: 8 }}><Txt size={14} numberOfLines={1}>{x.description || x.category || x.type}</Txt><Txt size={11} muted>{x.date} · {x.category ?? (x.type === "transfer" ? "Transfer" : "Uncategorized")}</Txt></View>
                <Txt size={14} weight="600" color={x.type === "income" ? t.success : t.text}>{x.type === "income" ? "+" : x.type === "expense" ? "−" : ""}{inr(x.amount)}</Txt>
              </View>
            )) : <Empty text="No transactions yet." />}
          </Card>
        </>
      )}</Async>
    </Screen>
  );
}
