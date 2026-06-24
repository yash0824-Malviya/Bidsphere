/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        /* Single Netlink brand blue — used for all primary/brand accents */
        primary: {
          DEFAULT: "#0EA5E9",
          50: "#f0f9ff",
          100: "#e0f2fe",
          200: "#bae6fd",
          300: "#7dd3fc",
          400: "#38bdf8",
          500: "#0EA5E9",
          600: "#0284C7",
          700: "#0369a1",
          800: "#075985",
          900: "#0c4a6e",
        },
        sidebar: {
          DEFAULT: "#081225",
          hover: "#172554",
          text: "#94a3b8",
          active: "#0EA5E9",
        },
        surface: {
          page: "#f8fafc",
          card: "#ffffff",
          header: "#f1f5f9",
        },
        danger: {
          DEFAULT: "#dc2626",
          50: "#fef2f2",
          100: "#fee2e2",
          500: "#dc2626",
          600: "#b91c1c",
          700: "#991b1b",
        },
        warning: {
          DEFAULT: "#ca8a04",
          50: "#fefce8",
          100: "#fef9c3",
          500: "#ca8a04",
          600: "#a16207",
        },
        success: {
          DEFAULT: "#16a34a",
          50: "#f0fdf4",
          100: "#dcfce7",
          500: "#16a34a",
          600: "#15803d",
        },
        /* Legacy aliases — mapped onto the single Netlink brand blue */
        accent: {
          DEFAULT: "#0EA5E9",
          50: "#f0f9ff",
          100: "#e0f2fe",
          500: "#0EA5E9",
          600: "#0284C7",
          700: "#0369a1",
        },
        neutral: {
          50: "#f8fafc",
          100: "#f1f5f9",
          200: "#e2e8f0",
          300: "#cbd5e1",
          400: "#94a3b8",
          500: "#64748b",
          600: "#475569",
          700: "#334155",
          800: "#1e293b",
          900: "#0f172a",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      fontSize: {
        "page-title": ["24px", { fontWeight: "600", lineHeight: "1.3" }],
        "table-header": ["11px", { letterSpacing: "0.05em", fontWeight: "600" }],
      },
      backgroundColor: {
        "surface-header": "#f1f5f9",
      },
      boxShadow: {
        card: "0 1px 3px rgba(0, 0, 0, 0.08)",
        "card-hover": "0 4px 12px rgba(0, 0, 0, 0.1)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        card: "12px",
      },
    },
  },
  plugins: [],
};
