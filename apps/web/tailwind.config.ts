import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-poppins)", "ui-sans-serif", "system-ui", "sans-serif"]
      },
      colors: {
        pi: {
          bg: "#101010",
          primary: "#157aff",
          accent: "#31ba96",
          warn: "#f59e0b",
          danger: "#ef4444"
        }
      }
    }
  },
  plugins: []
} satisfies Config;
