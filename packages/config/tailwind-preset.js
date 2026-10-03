/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [],
  theme: {
    extend: {
      colors: {
        // Warm Clinical Editorial Color System
        plum: {
          50: "#F7EEF5",
          100: "#EEDBEA",
          200: "#DEB8D5",
          300: "#CB92BD",
          400: "#A95E95",
          500: "#7E326C",
          600: "#632654",
          700: "#4A1D3F", // Primary brand dominant
          800: "#36142D",
          900: "#240C1E",
          950: "#160713",
          DEFAULT: "#4A1D3F",
        },
        coral: {
          50: "#FDF4F2",
          100: "#FBEAE6", // Surface tint
          200: "#F7CFC6",
          300: "#F3C9BF", // Soft coral sub-accent
          400: "#EE9883",
          500: "#E8735A", // Single sharp accent
          600: "#D3543A",
          700: "#B03E27",
          800: "#8D3220",
          900: "#702A1C",
          DEFAULT: "#E8735A",
        },
        blush: {
          50: "#FEFAF9",
          100: "#FDF5F3",
          200: "#FBEAE6", // Hero surface
          300: "#F6D7D0",
          DEFAULT: "#FBEAE6",
        },
        ink: {
          50: "#ECEAEF",
          100: "#DAD6E0",
          200: "#B5ADC3",
          300: "#8F85A5",
          400: "#6A5D86",
          500: "#4F4468",
          600: "#3D3452",
          700: "#2B2230", // Primary text ink
          800: "#1E1722",
          900: "#130E16",
          DEFAULT: "#2B2230",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      fontFamily: {
        serif: ["var(--font-fraunces)", "Georgia", "serif"],
        sans: [
          "var(--font-figtree)",
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        "card-tactile":
          "0 8px 30px -4px rgba(74, 29, 63, 0.12), 0 2px 6px -1px rgba(74, 29, 63, 0.06)",
        "card-hover":
          "0 14px 40px -6px rgba(74, 29, 63, 0.18), 0 4px 10px -2px rgba(74, 29, 63, 0.08)",
        "emergency-pulse": "0 0 0 4px rgba(232, 115, 90, 0.25)",
      },
    },
  },
  plugins: [],
};
