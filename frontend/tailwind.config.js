/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Dark OLED + azul de dados + âmbar de destaque (design system ui-ux-pro-max)
        bg: "#0A0E14",
        surface: "#11161F",
        "surface-2": "#171E2A",
        border: "#1F2937",
        primary: { DEFAULT: "#3B82F6", fg: "#FFFFFF" },
        accent: { DEFAULT: "#F59E0B", fg: "#0A0E14" },
        muted: "#94A3B8",
        text: "#E2E8F0",
        ok: "#22C55E",
        danger: "#EF4444",
      },
      fontFamily: {
        sans: ["Fira Sans", "system-ui", "sans-serif"],
        mono: ["Fira Code", "ui-monospace", "monospace"],
      },
      borderRadius: { lg: "0.6rem" },
    },
  },
  plugins: [],
};
