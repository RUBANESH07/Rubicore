"""GPS engine: distance, speed, drift, jumps, pauses, reprocessing."""
import math

from app.ride.gps import GpsConfig, Point, RideProcessor, haversine_km, haversine_m, process_points, simplify, validate

LAT0, LON0 = 19.0760, 72.8777  # Mumbai
M_PER_DEG_LAT = 111_195.0


def north(m: float, lat=LAT0, lon=LON0):
    return lat + m / M_PER_DEG_LAT, lon


def drive(speed_kmh=36.0, seconds=60, step=2, acc=8.0, report_speed=True, seg=0, t0=0.0, start_m=0.0):
    """Straight northbound drive at constant speed, one fix every `step` seconds."""
    pts = []
    for i in range(0, seconds + 1, step):
        lat, lon = north(start_m + speed_kmh / 3.6 * i)
        pts.append(Point(lat, lon, t0 + i, speed_kmh if report_speed else None, acc, 10.0, seg))
    return pts


def run(points, cfg=None):
    p = RideProcessor(cfg)
    results = [p.add(x) for x in points]
    return p, results


def test_haversine_known_distances():
    assert abs(haversine_km(0, 10, 1, 10) - 111.195) < 0.05                       # 1 degree of latitude
    assert abs(haversine_km(19.0760, 72.8777, 18.5204, 73.8567) - 120.0) < 3       # Mumbai-Pune air distance ~120 km
    assert haversine_m(10, 10, 10, 10) == 0


def test_constant_speed_distance_and_speed():
    p, _ = run(drive(36.0, 120))                  # 10 m/s for 120 s = 1.2 km
    s = p.summary()
    assert abs(s["distance_km"] - 1.2) < 0.02
    assert abs(s["average_speed_kmh"] - 36.0) < 1.0
    assert abs(s["max_speed_kmh"] - 36.0) < 0.5
    assert s["rejected_points"] == 0


def test_stationary_drift_is_not_distance():
    lat, lon = LAT0, LON0
    pts = []
    for i in range(0, 600, 2):                    # 10 min parked, fixes wander up to ~8 m
        dx = 8 * math.sin(i / 7.0)
        dy = 8 * math.cos(i / 5.0)
        pts.append(Point(lat + dy / M_PER_DEG_LAT, lon + dx / (M_PER_DEG_LAT * math.cos(math.radians(lat))), i, 0.0, 12.0))
    p, _ = run(pts)
    s = p.summary()
    assert s["distance_km"] < 0.01                 # naive summing would give hundreds of metres
    assert s["raw_distance_km"] > s["distance_km"] * 10
    assert s["max_speed_kmh"] == 0
    assert s["stationary_seconds"] > 500


def test_slow_creep_in_traffic_still_counts():
    p, _ = run(drive(5.0, 240, acc=10.0, report_speed=False))   # 5 km/h for 4 minutes = ~333 m
    assert abs(p.summary()["distance_km"] - 0.333) < 0.03


def test_impossible_jump_rejected_but_kept():
    pts = drive(36.0, 60)
    jump = Point(*north(50_000), 31, 36.0, 8.0)                  # 50 km away one second later
    pts.insert(16, jump)
    p, results = run(pts)
    assert not results[16].accepted and results[16].reason == "impossible_jump"
    assert abs(p.summary()["distance_km"] - 0.6) < 0.03          # the real drive is unaffected
    assert p.summary()["rejected_by_reason"] == {"impossible_jump": 1}


def test_low_accuracy_and_invalid_points():
    pts = drive(36.0, 20)
    pts[3].accuracy_m = 400
    pts[5] = Point(91.0, 10.0, pts[5].t)
    pts[6] = Point(0.0, 0.0, pts[6].t, accuracy_m=5)
    pts[7] = Point(float("nan"), 10.0, pts[7].t)
    _, results = run(pts)
    assert [results[i].reason for i in (3, 5, 6, 7)] == ["low_accuracy", "invalid_coordinates", "null_island", "invalid_value"]
    assert validate(Point(10, 10, 1, accuracy_m=-1)) == "invalid_accuracy"


def test_duplicates_and_out_of_order_never_double_count():
    pts = drive(36.0, 60)
    pts += [pts[10], pts[11]]                                    # replayed fixes (e.g. an offline retry)
    pts.append(Point(pts[5].lat, pts[5].lon, pts[5].t))
    p, results = run(pts)
    assert [r.reason for r in results[-3:]] == ["out_of_order", "out_of_order", "out_of_order"]
    assert abs(p.summary()["distance_km"] - 0.6) < 0.02
    dup = RideProcessor()
    dup.add(pts[0])
    assert dup.add(pts[0]).reason == "duplicate"


def test_pause_segments_are_not_joined():
    a = drive(36.0, 60, seg=0)                                   # 600 m
    b = drive(36.0, 60, seg=1, t0=3600, start_m=20_000)          # resumed 20 km north an hour later
    p, results = run(a + b)
    assert all(r.accepted for r in results)
    assert abs(p.summary()["distance_km"] - 1.2) < 0.04         # 20 km teleport across the pause is not counted


def test_negative_or_absurd_reported_speed_falls_back_to_computed():
    pts = drive(36.0, 60, report_speed=False)
    for i in (5, 10, 15):
        pts[i].speed_kmh = -12.0
    pts[20].speed_kmh = 900.0
    p, results = run(pts)
    assert all(r.speed_kmh >= 0 for r in results)
    assert max(r.speed_kmh for r in results) < 60
    assert abs(p.summary()["max_speed_kmh"] - 36.0) < 2


def test_uses_reported_speed_only_when_accurate():
    good = Point(*north(40), 4, 72.0, 10.0)
    poor = Point(*north(40), 4, 72.0, 30.0)                      # accuracy too poor to trust the reported speed
    base = Point(LAT0, LON0, 0, 0.0, 10.0)
    r_good = RideProcessor(); r_good.add(base); res_good = r_good.add(good)
    r_poor = RideProcessor(); r_poor.add(base); res_poor = r_poor.add(poor)
    assert abs(res_good.speed_kmh - 72.0) < 0.1                  # reported
    assert abs(res_poor.speed_kmh - 36.0) < 1.0                  # computed: 40 m in 4 s


def test_single_speed_spike_does_not_set_max_speed():
    pts = drive(40.0, 60)
    pts[10].speed_kmh = 140.0                                    # one bad Doppler reading
    p, _ = run(pts)
    assert p.summary()["max_speed_kmh"] < 45


def test_gap_in_updates_is_counted_and_plausible_gap_accepted():
    a = drive(36.0, 20)
    b = drive(36.0, 20, t0=200, start_m=36.0 / 3.6 * 200)       # 3 minutes of silence (tunnel), same speed
    p, results = run(a + b)
    assert all(r.accepted for r in results)
    assert p.summary()["gap_count"] == 1
    assert abs(p.summary()["distance_km"] - 2.2) < 0.15
    far = RideProcessor(); far.add(a[0]); far.add(Point(*north(80_000), 400, accuracy_m=5))   # 80 km in ~6.7 min = 720 km/h
    assert far.rejected  # rejected


def test_reprocess_is_deterministic_and_order_independent():
    pts = drive(36.0, 120)
    shuffled = list(reversed(pts))
    _, p1 = process_points(pts)
    _, p2 = process_points(shuffled)
    assert p1.summary() == p2.summary()
    strict = GpsConfig(max_accuracy_m=5)
    _, p3 = process_points(pts, strict)
    assert p3.summary()["rejected_points"] == len(pts)           # raw data kept, different outcome under new settings


def test_elevation_gain_ignores_noise():
    pts = drive(36.0, 60)
    for i, p in enumerate(pts):
        p.altitude_m = 100 + (1.0 if i % 2 else -1.0) + (i * 0.5)   # noise +-1 m on a steady 0.5 m/fix climb
    s = run(pts)[0].summary()
    assert 10 < s["elevation_gain_m"] < 20


def test_simplify_keeps_shape_and_endpoints():
    coords = [north(i * 10) for i in range(100)]
    keep = simplify(coords, 2.0)
    assert keep == [0, 99]
    bend = coords[:50] + [(coords[49][0], coords[49][1] + 0.001 * (i + 1)) for i in range(50)]
    assert 49 in simplify(bend, 2.0)
