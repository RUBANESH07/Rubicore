import { useLocalSearchParams, useRouter } from "expo-router";
import { Alert, View } from "react-native";
import { RideMap } from "@/components/RideMap";
import { Async, Button, Card, Row, Screen, Stat, Txt, useLoad } from "@/components/ui";
import { api } from "@/lib/api";
import { dateOf, duration, timeOf } from "@/lib/format";

type Detail = {
  id: number; title: string; date: string; started_at: string; ended_at: string | null; total_distance_km: number; average_speed_kmh: number; maximum_speed_kmh: number;
  duration_seconds: number; paused_seconds: number; start_latitude: number | null; start_longitude: number | null; end_latitude: number | null; end_longitude: number | null;
  track: [number, number, number, number | null, number][]; points_total: number; events: { type: string; at: string }[];
  statistics?: { moving_seconds: number; stationary_seconds: number; accepted_points: number; rejected_points: number; elevation_gain_m: number; gap_count: number };
};

export default function RideDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const ride = useLoad<Detail>(`/rides/${id}`);
  return (
    <Screen onRefresh={ride.reload}>
      <Async state={ride}>{(r) => (
        <>
          <View><Txt size={20} weight="700">{r.title || dateOf(r.date)}</Txt><Txt size={13} muted>{timeOf(r.started_at)} – {timeOf(r.ended_at)}</Txt></View>
          <RideMap height={300} path={r.track.map((p) => [p[0], p[1]] as [number, number])}
            markers={[...(r.start_latitude != null ? [{ latitude: r.start_latitude, longitude: r.start_longitude as number, color: "#16a34a", title: "Start" }] : []),
              ...(r.end_latitude != null ? [{ latitude: r.end_latitude, longitude: r.end_longitude as number, color: "#dc2626", title: "End" }] : [])]} />
          <Row><Stat label="Distance" value={`${r.total_distance_km.toFixed(2)} km`} /><Stat label="Duration" value={duration(r.duration_seconds)} sub={r.paused_seconds ? `+ ${duration(r.paused_seconds)} paused` : undefined} /></Row>
          <Row><Stat label="Average speed" value={`${Math.round(r.average_speed_kmh)} km/h`} /><Stat label="Max speed" value={`${Math.round(r.maximum_speed_kmh)} km/h`} /></Row>
          {r.statistics && (
            <Card>
              <Txt weight="600" style={{ marginBottom: 6 }}>Trip details</Txt>
              <Txt size={13} muted>Moving {duration(r.statistics.moving_seconds)} · stopped {duration(r.statistics.stationary_seconds)}</Txt>
              <Txt size={13} muted>GPS points counted {r.statistics.accepted_points} · ignored {r.statistics.rejected_points} · signal gaps {r.statistics.gap_count}</Txt>
              <Txt size={13} muted>Elevation gain {Math.round(r.statistics.elevation_gain_m)} m</Txt>
            </Card>
          )}
          <Button title="Delete this ride" variant="danger" onPress={() => Alert.alert("Delete ride?", "The ride and all its GPS points will be removed.", [
            { text: "Cancel", style: "cancel" },
            { text: "Delete", style: "destructive", onPress: async () => { await api.del(`/rides/${r.id}`); router.back(); } }])} />
        </>
      )}</Async>
    </Screen>
  );
}
