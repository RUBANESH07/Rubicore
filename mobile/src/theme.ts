import { useColorScheme } from "react-native";

// Same palette as the website: warm off-white surface (#fbf9f7), dark pink accent, light blue / green / yellow / red.
export const light = {
  bg: "#f3f0ec", card: "#fbf9f7", text: "#2b1620", muted: "#6b5a62", border: "#e5ddd6", primary: "#be185d", onPrimary: "#fbf9f7",
  success: "#1f7a4d", danger: "#c0392b", warning: "#b7791f", sky: "#7cc4e6", mint: "#8bd2a6", sun: "#f3cf6a", coral: "#f08c8c", field: "#fbf9f7",
};
export const dark: typeof light = {
  bg: "#150f11", card: "#1f1819", text: "#f6efe9", muted: "#a89aa0", border: "#33292c", primary: "#ee4f96", onPrimary: "#150f11",
  success: "#5ec28e", danger: "#f0807a", warning: "#e0b24a", sky: "#5aaedb", mint: "#5dbd88", sun: "#e6b94a", coral: "#e07a7a", field: "#261d1f",
};
export type Theme = typeof light;
export const useTheme = (): Theme => (useColorScheme() === "dark" ? dark : light);

export const PALETTE = ["#be185d", "#7cc4e6", "#8bd2a6", "#f3cf6a", "#f08c8c", "#e8a3c4"];

export const inr = (n: number | null | undefined, max = 0) =>
  n == null ? "—" : `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: max }).format(n)}`;
