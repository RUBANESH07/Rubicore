import { useState } from "react";
import { Alert, Pressable, Switch, View } from "react-native";
import { Async, Button, Card, Empty, Field, Row, Screen, Stat, Txt, useLoad } from "@/components/ui";
import { api } from "@/lib/api";
import { dateOf, today } from "@/lib/format";
import { inr, useTheme } from "@/theme";

type Fuel = { id: number; date: string; odometer_km: number; litres: number; price_per_litre: number; total_amount: number; station: string; is_full_tank: boolean; transaction_id: number | null };
type Analytics = { total_spent: number; total_litres: number; average_mileage_kmpl: number | null; cost_per_km: number | null; reliable: boolean; note: string | null; measured_distance_km: number };
type Bike = { id: number; is_default: boolean };

export default function FuelScreen() {
  const t = useTheme();
  const an = useLoad<Analytics>("/fuel/analytics");
  const list = useLoad<Fuel[]>("/fuel");
  const bikes = useLoad<Bike[]>("/bikes");
  const [f, setF] = useState({ date: today(), odo: "", litres: "", price: "", station: "" });
  const [full, setFull] = useState(true);
  const [expense, setExpense] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const total = Number(f.litres) > 0 && Number(f.price) > 0 ? Number(f.litres) * Number(f.price) : 0;
  const reload = () => { an.reload(); list.reload(); };

  async function save() {
    setErr("");
    setBusy(true);
    try {
      await api.post("/fuel", { date: f.date, odometer_km: Number(f.odo), litres: Number(f.litres), price_per_litre: Number(f.price), station: f.station, is_full_tank: full,
        bike_id: bikes.data?.find((b) => b.is_default)?.id ?? null, record_expense: expense });
      setF({ ...f, odo: "", litres: "", price: "", station: "" });
      reload();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  const remove = (x: Fuel) => Alert.alert("Delete fuel entry?", x.transaction_id ? "Its linked expense is removed too." : undefined, [
    { text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: async () => { await api.del(`/fuel/${x.id}`); reload(); } }]);

  return (
    <Screen onRefresh={async () => reload()}>
      <Async state={an}>{(a) => (
        <>
          <Row><Stat label="Petrol spent" value={inr(a.total_spent)} /><Stat label="Litres" value={`${a.total_litres} L`} /></Row>
          <Row><Stat label="Average mileage" value={a.average_mileage_kmpl ? `${a.average_mileage_kmpl} km/l` : "—"} sub={a.reliable ? `from ${a.measured_distance_km} km, full-to-full` : undefined} />
            <Stat label="Cost per km" value={a.cost_per_km ? inr(a.cost_per_km, 2) : "—"} /></Row>
          {!a.reliable && a.note ? <Card><Txt size={13} color={t.warning}>{a.note}</Txt></Card> : null}
        </>
      )}</Async>
      <Card style={{ gap: 10 }}>
        <Txt weight="700">Add fuel entry</Txt>
        <Field label="Date (YYYY-MM-DD)" value={f.date} onChangeText={(v) => setF({ ...f, date: v })} autoCapitalize="none" />
        <Row style={{ flexWrap: "nowrap" }}>
          <View style={{ flex: 1 }}><Field label="Odometer (km)" value={f.odo} onChangeText={(v) => setF({ ...f, odo: v })} keyboardType="decimal-pad" /></View>
          <View style={{ flex: 1 }}><Field label="Litres" value={f.litres} onChangeText={(v) => setF({ ...f, litres: v })} keyboardType="decimal-pad" /></View>
        </Row>
        <Row style={{ flexWrap: "nowrap" }}>
          <View style={{ flex: 1 }}><Field label="Price per litre" value={f.price} onChangeText={(v) => setF({ ...f, price: v })} keyboardType="decimal-pad" /></View>
          <View style={{ flex: 1 }}><Field label="Fuel station" value={f.station} onChangeText={(v) => setF({ ...f, station: v })} /></View>
        </Row>
        {total > 0 ? <Txt size={13} muted>Total: {inr(total, 2)} (litres × price)</Txt> : null}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><View style={{ flex: 1, paddingRight: 8 }}><Txt size={14}>Filled to full tank</Txt><Txt size={11} muted>Mileage is only calculated between full-tank fill-ups.</Txt></View><Switch value={full} onValueChange={setFull} trackColor={{ true: t.primary }} /></View>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><Txt size={14} style={{ flex: 1 }}>Also record as an expense</Txt><Switch value={expense} onValueChange={setExpense} trackColor={{ true: t.primary }} /></View>
        {err ? <Txt color={t.danger} size={13}>{err}</Txt> : null}
        <Button title="Save entry" onPress={save} busy={busy} disabled={!(Number(f.odo) >= 0 && f.odo) || !(total > 0)} />
      </Card>
      <Async state={list}>{(d) => d.length ? (
        <Card style={{ padding: 4 }}>{d.map((x, i) => (
          <Pressable key={x.id} onLongPress={() => remove(x)} style={{ padding: 12, borderTopWidth: i ? 1 : 0, borderColor: t.border, flexDirection: "row", justifyContent: "space-between" }}>
            <View><Txt weight="600">{dateOf(x.date)}</Txt><Txt size={12} muted>{x.odometer_km.toLocaleString("en-IN")} km · {x.litres} L{x.is_full_tank ? " · full" : " · partial"}{x.station ? ` · ${x.station}` : ""}</Txt></View>
            <Txt weight="700">{inr(x.total_amount, 2)}</Txt>
          </Pressable>))}
          <Txt size={11} muted style={{ textAlign: "center", padding: 8 }}>Long-press an entry to delete it</Txt></Card>
      ) : <Empty text="No fuel entries yet." />}</Async>
    </Screen>
  );
}
