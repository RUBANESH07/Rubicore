# RubiCore mobile (Expo / React Native)

One backend, one database, two front ends:

```
 Website (Next.js)      Mobile app (this folder, Expo / React Native)
        \                         /
         \  common REST API, JSON over HTTPS
          \                     /
        Single backend (FastAPI, Python): auth, business logic, services
                          |
                   Single database
```

The app does not have its own server code. It signs in with `POST /api/auth/token` (a 30 day bearer token kept in the phone's secure storage) and calls the same endpoints the website uses. Shared logic is not duplicated: the GPS engine and the FD/RD maths are copied from `frontend/lib` by `npm run sync` (runs automatically before `npm start`).

## What is in the app
Home (balance, today, month, top spending, recent activity) · Money (transactions, add, delete) · Ride (live GPS: start, pause, resume, stop, map, speed, distance, history, ride detail) · Fuel & mileage · Parking (save, navigate back) · FD & RD calculators · Settings (server address).
There is no sign-in or PIN screen on the phone: the app opens straight to Home and quietly gets its token from the backend using the PIN (default 1224; set `EXPO_PUBLIC_APP_PIN` in `mobile/.env` if you changed `APP_PIN`). Anyone who opens the app sees your data.

## Run it on your phone

You need the backend running on your computer, the **Expo Go** app on your phone, and a way for the phone to reach the backend.

### 1. Start the backend so the phone can reach it
From the project root (the folder that contains `backend` and `mobile`):

```bash
python -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000
```

`--host 0.0.0.0` lets other devices on your network reach it. (ngrok connects from the same computer, and uvicorn already trusts forwarded client addresses from there, so rate limits still see the real client.) If Windows asks, allow Python through the firewall for private networks.

### 2. Start the app
```bash
cd mobile
npm install
npm start
```
Scan the QR code with Expo Go (Android) or the Camera app (iPhone).

### 3. Pick how the phone reaches the backend

**A. Same Wi-Fi (quickest).** Phone and computer on the same network. The app guesses your computer's address from the Expo dev server (`http://<your-ip>:8000`). If Home shows "Can't reach the server", open **More > Settings > Server address**, enter `http://<your-ip>:8000` (find it with `ipconfig`), tap **Test connection**.

**B. ngrok (any network, https).** Use this if the phone is on mobile data or a different Wi-Fi, or the network blocks device-to-device traffic.
1. Install ngrok and sign in once (free account): `winget install ngrok.ngrok`, then `ngrok config add-authtoken <your token from dashboard.ngrok.com>`.
2. `ngrok http 8000`. Copy the `https://....ngrok-free.app` address it prints.
3. In the app: **More > Settings > Server address**, paste it, **Test and save**.
4. If Expo itself can't connect over your network, use `npm run tunnel` (Expo's own ngrok tunnel for the app bundle; it installs the helper the first time).

While ngrok runs, your backend is reachable from the internet. It requires a sign-in and rate limits requests, but consider `SINGLE_USER_MODE=true` in `.env` while exposed, and stop ngrok when you're done.

## Limits you should know
- **Expo Go cannot track in the background.** Inside Expo Go, GPS records only while the app is open and the screen is on (the app keeps the screen awake). Settings shows which mode you are in.
- **Background tracking needs a real build** (Android foreground service with a notification, iOS background location). Build one with `npx expo prebuild` then `npx expo run:android` (needs Android Studio), or EAS Build: `npx eas build --profile development --platform android`. Even then, battery optimisation and permission settings can pause tracking, and nothing is recorded after you force-quit the app.
- **Android maps in a real build need a Google Maps API key** (`android.config.googleMaps.apiKey` in `app.json`); Expo Go supplies its own. Map tiles default to OpenStreetMap; change them with `EXPO_PUBLIC_MAP_TILE_URL`.
- **iOS/Android store builds need https**; plain `http://` addresses are for development only.
- Not yet tested on a physical phone by the author of this code: it was type-checked and bundled for Android, and the API behaviour it depends on is covered by backend tests (`backend/tests/test_mobile_client.py`).

## Useful commands
```bash
npm run typecheck   # TypeScript
npm run bundle      # build the Android JS bundle to .export (proves everything compiles)
npm run sync        # refresh shared GPS and FD/RD code from ../frontend/lib
```

Environment (optional, in `mobile/.env`): `EXPO_PUBLIC_API_URL` (default backend address), `EXPO_PUBLIC_MAP_TILE_URL`.
