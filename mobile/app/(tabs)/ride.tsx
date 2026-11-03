import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { RideMap } from "@/components/RideMap";
import { Async, Button, Card, Chips, Empty, Row, Screen, Txt, useLoad } from "@/components/ui";
import { clock, dateOf, duration, timeOf } from "@/lib/format";
import * as tracker from "@/lib/tracker";
import { useTracker } from "@/lib/useTracker";
import { useTheme } from "@/theme";

type Ride = { id: number; date: string; started_at: string; ended_at: string | null; title: string; total_distance_km: number; average_speed_kmh: number; maximum_speed_kmh: number; duration_seconds: number };
type Bike = { id: number; name: string; is_default: boolean };

const SIGNAL = { none: ["GPS idle", "muted"], searching: ["Searching for GPS…", "warning"], good: ["Strong GPS", "success"], fair: ["Fair GPS", "warning"], poor: ["Weak GPS", "danger"], lost: ["GPS signal lost", "danger"] } as const;

export default function RideTab() {
  const t = useTheme();
  const router = useRouter();
  const trk = useTracker();
  const bikes = useLoad<Bike[]>("/bikes");
  const rides = useLoad<{ items: Ride[] }>("/rides?preset=30d&limit=8");
  const [bike, setBike] = useState<number | "none">("none");
  const running = trk.phase === "active" || trk.phase === "paused";
  const defaultBike = bikes.data?.find((b) => b.is_default)?.id;
  const chosen = bike === "none" ? defaultBike ?? null : bike;
  const [sigText, sigTone] = SIGNAL[trk.signal];
  const toneColor = { muted: t.muted, warning: t.warning, success: t.success, danger: t.danger }[sigTone];
  const avg = trk.elapsedSeconds > 5 ? trk.distanceKm / (trk.elapsedSeconds / 3600) : 0;

  const confirmStop = () => Alert.alert("Stop this ride?", "It will be saved to your account.", [
    { text: "Keep riding", style: "cancel" }, { text: "Stop and save", style: "destructive", onPress: () => void tracker.stop().then(() => rides.reload()) },
  ]);

  return (
    <Screen onRefresh={async () => { await rides.reload(); await bikes.reload(); }}>
      {trk.error ? <Card style={{ borderColor: t.warning }}><Txt size={13} color={t.warning}>{trk.error}</Txt><Pressable onPress={tracker.clearError}><Txt size={12} color={t.primary} style={{ marginTop: 6 }}>Dismiss</Txt></Pressable></Card> : null}

      {running && (
        <Card><Txt size={12} muted>
          {trk.mode === "background" ? "Recording continues when the screen is locked or you switch apps (you may see a notification). It stops if you force-quit the app." : "Keep this app open with the screen on. In Expo Go, GPS pauses when the screen locks; a development build records in the background."}</Txt></Card>
      )}

      <RideMap height={280} path={trk.path} follow={trk.fix} />

      <Row>
        <Card style={{ flex: 1, alignItems: "center" }}><Txt size={12} muted>Speed</Txt><Txt size={44} weight="700">{Math.round(trk.currentKmh)}</Txt><Txt size={12} muted>km/h · max {Math.round(trk.maxKmh)}{running ? ` · avg ${Math.round(avg)}` : ""}</Txt></Card>
      </Row>
      <Row>
        <Card style={{ flex: 1, alignItems: "center" }}><Txt size={12} muted>Distance</Txt><Txt size={28} weight="700">{trk.distanceKm.toFixed(2)}</Txt><Txt size={12} muted>km</Txt></Card>
        <Card style={{ flex: 1, alignItems: "center" }}><Txt size={12} muted>{trk.phase === "paused" ? "Paused" : "Ride time"}</Txt><Txt size={28} weight="700" color={trk.phase === "paused" ? t.warning : undefined}>{clock(trk.elapsedSeconds)}</Txt><Txt size={12} muted>hh:mm:ss</Txt></Card>
      </Row>
      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}><Txt size={13} color={toneColor} weight="600">{sigText}{trk.accuracy != null && running ? ` · ±${Math.round(trk.accuracy)} m` : ""}</Txt>{trk.pending > 0 ? <Txt size={12} color={t.warning}>{trk.pending} waiting to upload</Txt> : null}</View>
        <Txt size={12} muted style={{ marginTop: 4 }}>{trk.fix ? `${trk.fix.latitude.toFixed(6)}, ${trk.fix.longitude.toFixed(6)}` : "No position yet"}{trk.altitude != null ? ` · ${Math.round(trk.altitude)} m` : ""}</Txt>
      </Card>

      {!running ? (
        <>
          <Async state={bikes}>{(list) => list.length ? <View style={{ gap: 6 }}><Txt size={12} muted weight="600">Bike</Txt>
            <Chips value={bike === "none" ? (defaultBike ?? "none") : bike} onChange={(v) => setBike(v as number)} options={list.map((b) => ({ value: b.id as number | "none", label: b.name }))} /></View> : <></>}</Async>
          <Button title={trk.phase === "starting" ? "Starting…" : "Start ride"} variant="success" busy={trk.phase === "starting"} onPress={() => void tracker.start(typeof chosen === "number" ? chosen : null)} />
          <Txt size={11} muted style={{ textAlign: "center" }}>Location is read only while a ride is recording. Your route is stored in your private account.</Txt>
        </>
      ) : (
        <Row style={{ flexWrap: "nowrap" }}>
          <Button style={{ flex: 1 }} variant="outline" title={trk.phase === "paused" ? "Resume" : "Pause"} onPress={() => void (trk.phase === "paused" ? tracker.resume() : tracker.pause())} />
          <Button style={{ flex: 1 }} variant="danger" title="Stop" busy={trk.phase === "stopping"} onPress={confirmStop} />
        </Row>
      )}

      {trk.summary && (
        <Card style={{ borderColor: t.success }}>
          <Txt weight="700" size={17}>Ride saved</Txt>
          <Row style={{ marginTop: 6 }}>
            <View><Txt size={11} muted>Distance</Txt><Txt weight="700">{trk.summary.total_distance_km.toFixed(2)} km</Txt></View>
            <View><Txt size={11} muted>Time</Txt><Txt weight="700">{duration(trk.summary.duration_seconds)}</Txt></View>
            <View><Txt size={11} muted>Avg</Txt><Txt weight="700">{Math.round(trk.summary.average_speed_kmh)} km/h</Txt></View>
            <View><Txt size={11} muted>Max</Txt><Txt weight="700">{Math.round(trk.summary.maximum_speed_kmh)} km/h</Txt></View>
          </Row>
          <Row style={{ marginTop: 10 }}><Button title="View route" onPress={() => { const id = trk.summary!.id; tracker.clearSummary(); router.push(`/ride/${id}`); }} /><Button title="Close" variant="outline" onPress={tracker.clearSummary} /></Row>
        </Card>
      )}

      <Txt size={17} weight="700" style={{ marginTop: 8 }}>Recent rides</Txt>
      <Async state={rides}>{(d) => d.items.length ? (
        <Card style={{ padding: 4 }}>
          {d.items.map((r, i) => (
            <Pressable key={r.id} onPress={() => router.push(`/ride/${r.id}`)} style={{ padding: 12, borderTopWidth: i ? 1 : 0, borderColor: t.border, flexDirection: "row", justifyContent: "space-between" }}>
              <View><Txt weight="600">{r.title || dateOf(r.date)}</Txt><Txt size={12} muted>{timeOf(r.started_at)}–{timeOf(r.ended_at)} · {duration(r.duration_seconds)}</Txt></View>
              <View style={{ alignItems: "flex-end" }}><Txt weight="700">{r.total_distance_km.toFixed(1)} km</Txt><Txt size={12} muted>avg {Math.round(r.average_speed_kmh)} km/h</Txt></View>
            </Pressable>
          ))}
        </Card>
      ) : <Empty text="No rides yet. Start your first ride." />}</Async>
    </Screen>
  );
}
