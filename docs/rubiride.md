# RubiRide: bike and ride intelligence

RubiRide is a module of RubiCore. It records motorcycle rides from a phone's GPS, then shows distance, speed, routes, fuel and mileage. It lives in the same site and API as the finance, stocks and news modules and reuses their login, database, categories and notifications. Switch it off in Settings > Modules (`rides`).

Pages (sidebar group "RubiRide"): Overview, Live Tracking, Start a Ride, Ride History (+ ride detail), Route Maps, Ride Analytics, Fuel & Mileage, Parking Location, Reports, Settings.

## What runs where

| Part | Status |
|---|---|
| Web app (phone browser or desktop) | Built. Records rides with the browser's Geolocation API. Installable to the home screen (PWA). |
| API (`/api/rides`, `/api/fuel`, ...) | Built. Mobile-ready: `POST /api/auth/token` returns a 30-day bearer token for a future native app. |
| Native mobile app (Expo / React Native) | Built in `mobile/` (see `mobile/README.md`). Type-checked and bundled; background tracking needs a development or store build, and it has not been field-tested on a phone yet. |

## Honest limits of browser tracking

- A web page only receives GPS while it is open and the screen is on. RubiCore requests a screen wake lock and keeps an offline queue, but a locked screen, a hidden tab or a closed browser stops location updates. The server records the silence as a gap.
- Accuracy and reliability depend on the phone: GPS hardware, sky view, battery optimisation, power-saving modes and browser rules.
- Always-on tracking (Android foreground service, iOS background location) needs the native app. Nothing here claims tracking continues after a force-stop.
- GPS needs https (or localhost). To use it on a phone during development, serve the site over https.
- Parking is a saved point, not a tracker: there is no theft detection or movement alert.

## GPS engine (`backend/app/ride/gps.py`, mirrored in `frontend/lib/gps.ts`)

Every structurally valid fix is stored raw. The engine labels each one *counted* or *ignored* (with a reason), so a ride can be reprocessed with different settings.

| Rule | Behaviour |
|---|---|
| Invalid values | non-finite, out-of-range, (0,0), negative accuracy: rejected and reported to the client, not stored |
| Poor accuracy | fixes worse than 50 m (setting) are stored but ignored |
| Impossible jumps | implied speed above 250 km/h is ignored |
| Duplicates / out of order | ignored; offline retries can never double count (also de-duplicated by time on upload) |
| Stationary drift | distance counts only when the displacement from the last counted point exceeds the GPS accuracy (min 6 m), and a device reporting "not moving" is believed unless the move is large |
| Gaps | silence over 90 s is counted; the distance across it is kept only if the implied speed is plausible (160 km/h) |
| Pause / resume | each resume starts a new segment; nothing is measured across a pause, and fixes recorded while paused are kept but ignored |
| Speed | the phone's speed when its accuracy is 25 m or better, otherwise computed from consecutive points; never negative |
| Max speed | a 3-point median filter removes single-fix spikes |
| Distance | Haversine between counted anchor points |

The browser shows live numbers using the TypeScript copy; the server recomputes from the raw points on every upload and when the ride stops, and the server result is authoritative.

## Fuel and mileage

- Fuel cost = litres x price per litre (a total that disagrees by more than 1% or 1.00 is rejected).
- Mileage = odometer distance / fuel burned, **only between full-tank fill-ups**: fuel burned = litres at the second full fill plus any partial fills between. GPS is never used to infer consumption; it is shown beside each interval as a cross-check.
- With fewer than two full-tank entries the page says so instead of guessing.
- Integration: saving a fuel entry can also create an expense transaction (category "Petrol / Fuel", account of your choice), so it shows in RubiCore finance, budgets and reports. Editing or deleting the fuel entry updates or removes that expense.

## Data, privacy and retention

- All ride data is tied to the signed-in user and checked on every request; other users get 404.
- Location is read only while a ride is recording, while "Check GPS signal" is on, or when you save a parking spot.
- GPS history, parking and fuel records are never available to the public MCP servers (enforced by tests). The assistant can answer ride questions through a private in-process tool (`get_riding_summary`).
- Place names are optional. When turned on in Settings, a ride's start and end coordinates (rounded) are sent to OpenStreetMap Nominatim when the ride finishes. Off by default.
- Delete one ride (`DELETE /api/rides/{id}`) or everything (`DELETE /api/rides?confirm=DELETE`). Both are audit logged.
- Retention: `POST /api/rides/compact` thins old rides to a simplified route (Douglas-Peucker, 5 m). Distance, speed and duration stay in the `rides` and `ride_statistics` tables, so analytics don't depend on raw points.
- Database: plain latitude/longitude columns with indexes on (ride, time). PostGIS is not required for any current feature; it can be added for spatial queries later.

## Endpoints

| Area | Endpoints |
|---|---|
| Rides | `POST /rides/start`, `POST /rides/{id}/points`, `/pause`, `/resume`, `/stop`; `GET /rides` (`preset=today\|yesterday\|7d\|30d\|custom`), `/rides/active`, `/rides/overview`, `/rides/routes`, `/rides/{id}`, `/rides/{id}/points`; `PUT/DELETE /rides/{id}`; `POST /rides/{id}/reprocess`, `/rides/compact`; `DELETE /rides?confirm=DELETE` |
| Analytics | `GET /ride-analytics/daily`, `/weekly`, `/monthly`, `/yearly` (prefixed `ride-` because `/analytics/*` is the finance module) |
| Bikes | `GET/POST /bikes`, `PUT/DELETE /bikes/{id}` |
| Fuel | `POST/GET /fuel`, `PUT/DELETE /fuel/{id}`, `GET /fuel/analytics` |
| Parking | `POST/GET /parking`, `PUT/DELETE /parking/{id}` |
| Other | `/maintenance`, `/ride-preferences`, `/ride-reports/export?kind=rides\|monthly\|yearly\|fuel&format=csv\|pdf`, `POST /auth/token` |

`start`, `pause`, `resume` and `stop` accept an optional `at` timestamp and are idempotent, so an offline client can replay them safely. Point batches are limited to 500, and each fix is validated.

## Configuration

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_MAP_TILE_URL`, `NEXT_PUBLIC_MAP_ATTRIBUTION` | Map provider. Any XYZ tile server; defaults to OpenStreetMap (check its tile usage policy before heavy use). Keys for Mapbox or similar are public by nature; use a domain-restricted key. |

## Testing

```bash
python -m pytest backend/tests        # GPS engine, ride API, fuel, privacy, isolation
cd frontend && npm test               # TypeScript GPS engine
```

Not yet covered: real-device GPS accuracy, battery use, browser behaviour on locked screens, and any native app. These need field testing on actual phones.
