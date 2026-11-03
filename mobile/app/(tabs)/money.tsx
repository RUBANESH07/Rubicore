import { useRouter } from "expo-router";
import { Alert, Pressable, View } from "react-native";
import { Async, Button, Card, Empty, Screen, Txt, useLoad } from "@/components/ui";
import { api } from "@/lib/api";
import { dateOf } from "@/lib/format";
import { inr, useTheme } from "@/theme";

type Tx = { id: number; type: "income" | "expense" | "transfer"; amount: number; date: string; category_name: string | null; description: string; payment_method: string };

export default function Money() {
  const t = useTheme();
  const router = useRouter();
  const list = useLoad<{ items: Tx[]; total: number }>("/transactions?limit=50");

  const remove = (x: Tx) =>
    Alert.alert("Delete transaction?", `${inr(x.amount)} on ${dateOf(x.date)}`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => { try { await api.del(`/transactions/${x.id}`); list.reload(); } catch (e: any) { Alert.alert("Couldn't delete", e.message); } } },
    ]);

  return (
    <Screen onRefresh={list.reload}>
      <Button title="+ Add transaction" onPress={() => router.push("/add-transaction")} />
      <Async state={list}>{(d) => d.items.length ? (
        <Card style={{ padding: 4 }}>
          {d.items.map((x, i) => (
            <Pressable key={x.id} onLongPress={() => remove(x)} style={{ flexDirection: "row", justifyContent: "space-between", padding: 12, borderTopWidth: i ? 1 : 0, borderColor: t.border }}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Txt size={15} numberOfLines={1}>{x.description || x.category_name || x.type}</Txt>
                <Txt size={12} muted>{dateOf(x.date)} · {x.type === "transfer" ? "Transfer" : x.category_name ?? "Uncategorized"} · {x.payment_method}</Txt>
              </View>
              <Txt size={15} weight="600" color={x.type === "income" ? t.success : t.text}>{x.type === "income" ? "+" : x.type === "expense" ? "−" : ""}{inr(x.amount, 2)}</Txt>
            </Pressable>
          ))}
          <Txt size={11} muted style={{ textAlign: "center", padding: 8 }}>{d.total} transactions · long-press one to delete</Txt>
        </Card>
      ) : <Empty text="No transactions yet. Tap “Add transaction”." />}</Async>
    </Screen>
  );
}
