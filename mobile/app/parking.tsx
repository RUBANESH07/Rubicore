import * as Location from "expo-location";
import { useState } from "react";
import { Alert, Linking, Pressable, View } from "react-native";
import { RideMap } from "@/components/RideMap";
import { Async, Button, Card, Empty, Field, Row, Screen, Txt, useLoad } from "@/components/ui";
import { api } from "@/lib/api";
import { dateOf, timeOf } from "@/lib/format";
import { useTheme } from "@/theme";

type Park = { id: number; latitude: number; longitude: number; accuracy_m: number | null; note: string; saved_at: string; is_active: boolean; navigate_url: string };

export default function Parking() {
  const t = useTheme();
  const data = useLoad<{ current: Park | null; history: Park[] }>("/parking");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    setErr("");
    setBusy(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) throw new Error("Location permission was denied. Allow location for RubiCore in your phone settings.");
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });   // one reading, only now
      await api.post("/parking", { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy_m: pos.coords.accuracy, note });
      setNote("");
      data.reload();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  const collect = (p: Park) => api.put(`/parking/${p.id}`, { is_active: false }).then(data.reload);
  const del = (p: Park) => Alert.alert("Delete this spot?", undefined, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => api.del(`/parking/${p.id}`).then(data.reload) }]);

  return (
    <Screen onRefresh={data.reload}>
      <Card style={{ gap: 10 }}>
        <Txt weight="700">Save parking location</Txt>
        <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="e.g. Basement 2, near the lift" maxLength={300} />
        <Button title="Save my current location" onPress={save} busy={busy} />
        {err ? <Txt color={t.danger} size={13}>{err}</Txt> : null}
        <Txt size={11} muted>Uses your location once, when you tap the button. RubiCore does not watch your bike or send movement alerts; it only knows where you saved it.</Txt>
      </Card>
      <Async state={data}>{(d) => (
        <>
          {d.current ? (
            <>
              <RideMap height={220} markers={[{ latitude: d.current.latitude, longitude: d.current.longitude, color: "#d97706", title: d.current.note || "Parked here" }]} />
              <Card>
                <Txt weight="700">Parked here</Txt>
                <Txt size={12} muted>Saved {dateOf(d.current.saved_at)} {timeOf(d.current.saved_at)}{d.current.accuracy_m != null ? ` · ±${Math.round(d.current.accuracy_m)} m` : ""}</Txt>
                <Txt style={{ marginTop: 6 }}>{d.current.note || "No note"}</Txt>
                <Row style={{ marginTop: 10, flexWrap: "nowrap" }}>
                  <Button style={{ flex: 1 }} title="Navigate back" onPress={() => void Linking.openURL(d.current!.navigate_url)} />
                  <Button style={{ flex: 1 }} variant="outline" title="Collected" onPress={() => void collect(d.current!)} />
                </Row>
              </Card>
            </>
          ) : <Empty text="No bike parked. Save your location when you park." />}
          {d.history.length > 1 && (
            <Card style={{ padding: 4 }}>
              <Txt weight="600" style={{ padding: 10 }}>Earlier spots</Txt>
              {d.history.filter((p) => !p.is_active).slice(0, 10).map((p) => (
                <Pressable key={p.id} onLongPress={() => del(p)} onPress={() => void Linking.openURL(p.navigate_url)} style={{ padding: 12, borderTopWidth: 1, borderColor: t.border }}>
                  <Txt numberOfLines={1}>{p.note || "No note"}</Txt><Txt size={12} muted>{dateOf(p.saved_at)} · tap to navigate · long-press to delete</Txt>
                </Pressable>
              ))}
            </Card>
          )}
        </>
      )}</Async>
    </Screen>
  );
}
