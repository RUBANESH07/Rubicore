export type RideStats = {
  moving_seconds: number; stationary_seconds: number; moving_average_speed_kmh: number; accepted_points: number; rejected_points: number;
  rejected_by_reason: Record<string, number>; gap_count: number; raw_distance_km: number; min_altitude_m: number | null;
  max_altitude_m: number | null; elevation_gain_m: number; points_compacted: boolean;
};
export type Ride = {
  id: number; bike_id: number | null; title: string; source: string; status: "active" | "paused" | "completed"; started_at: string;
  ended_at: string | null; date: string; start_latitude: number | null; start_longitude: number | null; end_latitude: number | null;
  end_longitude: number | null; start_label: string; end_label: string; total_distance_km: number; average_speed_kmh: number;
  maximum_speed_kmh: number; duration_seconds: number; paused_seconds: number; statistics?: RideStats;
};
export type RideDetail = Ride & {
  track: [number, number, number, number | null, number][]; points_total: number; events: { type: string; at: string }[];
  speed_profile: { t: number; speed: number }[];
};
export type Bike = {
  id: number; name: string; make: string; model: string; year: number | null; registration: string; is_default: boolean;
  tank_capacity_l: number | null; expected_mileage_kmpl: number | null; initial_odometer_km: number | null; service_interval_km: number | null;
};
export type Fuel = {
  id: number; date: string; odometer_km: number; litres: number; price_per_litre: number; total_amount: number; station: string;
  notes: string | null; is_full_tank: boolean; bike_id: number | null; transaction_id: number | null;
};
export type Parking = { id: number; latitude: number; longitude: number; accuracy_m: number | null; note: string; saved_at: string; is_active: boolean; navigate_url: string };

export const km = (n: number | null | undefined, d = 1) => (n == null ? "—" : `${n.toFixed(d)} km`);
export const kmh = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n)} km/h`);

export function duration(s: number): string {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : m ? `${m}m ${String(sec).padStart(2, "0")}s` : `${sec}s`;
}
export const clock = (s: number) => {
  s = Math.max(0, Math.floor(s));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((x) => String(x).padStart(2, "0")).join(":");
};
export const timeOf = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—");
export const place = (label: string, lat: number | null, lon: number | null) =>
  label || (lat != null && lon != null ? `${lat.toFixed(4)}, ${lon.toFixed(4)}` : "—");
