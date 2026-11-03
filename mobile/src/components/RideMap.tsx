import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import MapView, { Marker, Polyline, UrlTile } from "react-native-maps";

// Map tiles are configurable: any XYZ server. OpenStreetMap by default (check its usage policy before heavy use).
const TILE_URL = process.env.EXPO_PUBLIC_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export type LatLon = { latitude: number; longitude: number };

export function RideMap({ path, markers = [], follow, height = 260 }: { path?: [number, number][]; markers?: (LatLon & { color?: string; title?: string })[]; follow?: LatLon | null; height?: number }) {
  const ref = useRef<MapView>(null);
  const coords = (path ?? []).map(([latitude, longitude]) => ({ latitude, longitude }));

  useEffect(() => {
    if (!ref.current) return;
    if (follow) { ref.current.animateToRegion({ ...follow, latitudeDelta: 0.004, longitudeDelta: 0.004 }, 400); return; }
    const pts = [...coords, ...markers];
    if (pts.length > 1) ref.current.fitToCoordinates(pts, { edgePadding: { top: 40, right: 40, bottom: 40, left: 40 }, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow?.latitude, follow?.longitude, coords.length, markers.length]);

  const first = follow ?? markers[0] ?? coords[0] ?? { latitude: 20.59, longitude: 78.96 };
  return (
    <View style={[styles.box, { height }]}>
      <MapView ref={ref} style={StyleSheet.absoluteFill} mapType="none" initialRegion={{ ...first, latitudeDelta: follow || coords.length ? 0.01 : 20, longitudeDelta: follow || coords.length ? 0.01 : 20 }}
        rotateEnabled={false} toolbarEnabled={false}>
        <UrlTile urlTemplate={TILE_URL} maximumZ={19} flipY={false} zIndex={-1} />
        {coords.length > 1 && <Polyline coordinates={coords} strokeColor="#be185d" strokeWidth={5} />}
        {markers.map((m, i) => <Marker key={i} coordinate={m} pinColor={m.color ?? "#be185d"} title={m.title} />)}
        {follow && <Marker coordinate={follow} pinColor="#2563eb" title="You are here" />}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({ box: { borderRadius: 14, overflow: "hidden", backgroundColor: "#e8e2dc" } });
