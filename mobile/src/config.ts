/**
 * The phone app has no sign-in or PIN screen: it opens straight to Home. Behind the scenes it asks the backend for a 30 day token
 * using this PIN (the backend's APP_PIN, default 1224) and keeps the token in the phone's secure storage.
 * Set EXPO_PUBLIC_APP_PIN in mobile/.env if you changed APP_PIN. Anyone who opens the app sees your data.
 */
export const APP_PIN: string = process.env.EXPO_PUBLIC_APP_PIN || "1224";
