import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { Button, Chips, Field, Screen, Txt, useLoad } from "@/components/ui";
import { api } from "@/lib/api";
import { today } from "@/lib/format";
import { useTheme } from "@/theme";

type Cat = { id: number; name: string; type: "income" | "expense" };
type Acc = { id: number; name: string; type: string; is_active: boolean };
const METHODS = ["upi", "cash", "card", "netbanking", "wallet", "other"] as const;

export default function AddTransaction() {
  const t = useTheme();
  const router = useRouter();
  const cats = useLoad<Cat[]>("/categories");
  const accs = useLoad<Acc[]>("/accounts");
  const [type, setType] = useState<"expense" | "income">("expense");
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [date, setDate] = useState(today());
  const [cat, setCat] = useState<number | 0>(0);
  const [acc, setAcc] = useState<number | 0>(0);
  const [method, setMethod] = useState<(typeof METHODS)[number]>("upi");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!acc && accs.data?.length) setAcc(accs.data.find((a) => a.is_active)?.id ?? 0); }, [accs.data, acc]);
  useEffect(() => setCat(0), [type]);

  async function save() {
    setErr("");
    if (!(Number(amount) > 0)) return setErr("Enter an amount greater than zero.");
    if (!acc) return setErr("Choose an account.");
    setBusy(true);
    try {
      await api.post("/transactions", { type, amount: Number(amount), date, account_id: acc, category_id: cat || null, payment_method: method, description: desc });
      router.back();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <Screen>
      <Chips value={type} onChange={setType} options={[{ value: "expense", label: "Expense" }, { value: "income", label: "Income" }]} />
      <Field label="Amount (₹)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" autoFocus placeholder="0.00" />
      <Field label="Description" value={desc} onChangeText={setDesc} placeholder="e.g. Lunch" maxLength={255} />
      <Field label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} autoCapitalize="none" keyboardType="numbers-and-punctuation" />
      <View style={{ gap: 6 }}><Txt size={12} muted weight="600">Category</Txt>
        <Chips value={cat} onChange={setCat} options={[{ value: 0, label: "None" }, ...(cats.data ?? []).filter((c) => c.type === type).map((c) => ({ value: c.id as number, label: c.name }))]} /></View>
      <View style={{ gap: 6 }}><Txt size={12} muted weight="600">Account</Txt>
        <Chips value={acc} onChange={setAcc} options={(accs.data ?? []).filter((a) => a.is_active).map((a) => ({ value: a.id as number, label: a.name }))} /></View>
      <View style={{ gap: 6 }}><Txt size={12} muted weight="600">Payment method</Txt><Chips value={method} onChange={setMethod} options={METHODS.map((m) => ({ value: m, label: m }))} /></View>
      {err ? <Txt color={t.danger} size={13}>{err}</Txt> : null}
      <Button title="Save transaction" onPress={save} busy={busy} />
    </Screen>
  );
}
