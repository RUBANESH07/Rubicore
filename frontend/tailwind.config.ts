import type { Config } from "tailwindcss";

// `<alpha-value>` lets utilities like bg-primary/10 work with the HSL CSS variables.
const c = (v: string) => `hsl(var(--${v}) / <alpha-value>)`;

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: c("border"),
        background: c("background"),
        foreground: c("foreground"),
        card: c("card"),
        muted: { DEFAULT: c("muted"), foreground: c("muted-foreground") },
        primary: { DEFAULT: c("primary"), foreground: c("primary-foreground") },
        success: c("success"),
        danger: c("danger"),
        warning: c("warning"),
        sky: c("sky"),
        mint: c("mint"),
        sun: c("sun"),
        coral: c("coral"),
      },
      borderRadius: { lg: "0.75rem", md: "0.5rem" },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
};
export default config;
