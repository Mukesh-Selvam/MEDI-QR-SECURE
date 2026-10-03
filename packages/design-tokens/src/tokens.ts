/**
 * MediQR Secure — Warm Clinical Editorial Design Tokens
 *
 * Aesthetic Direction:
 * - Dominant: Deep Plum (#4A1D3F)
 * - Accent: Coral (#E8735A)
 * - Surface: Blush (#FBEAE6)
 * - Ink: Ink (#2B2230)
 * - Sub-accent: Soft Coral (#F3C9BF)
 * - Typography: Fraunces (Headings, Serif) + Figtree (Body/UI, Humanist Sans)
 */

export const colors = {
  plum: {
    50: "#F7EEF5",
    100: "#EEDBEA",
    200: "#DEB8D5",
    300: "#CB92BD",
    400: "#A95E95",
    500: "#7E326C",
    600: "#632654",
    700: "#4A1D3F", // Primary Brand Dominant
    800: "#36142D",
    900: "#240C1E",
    950: "#160713",
    DEFAULT: "#4A1D3F",
  },
  coral: {
    50: "#FDF4F2",
    100: "#FBEAE6", // Hero surface tint
    200: "#F7CFC6",
    300: "#F3C9BF", // Soft Coral sub-accent
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
    200: "#FBEAE6",
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
  status: {
    verified: "#1D6A4F", // Evergreen verified badge
    verifiedBg: "#EBF6F1",
    patientUploaded: "#8A5A12", // Amber patient upload indicator
    patientUploadedBg: "#FDF8ED",
    emergencyAlert: "#C0392B", // Break-glass red
    emergencyAlertBg: "#FDF0EE",
    auditHashGreen: "#2E7D32", // Tamper-evident verified green
  },
} as const;

export const typography = {
  fonts: {
    serif: "'Fraunces', Georgia, serif",
    sans: "'Figtree', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  tracking: {
    tightHeading: "-0.025em",
    normal: "0em",
    wide: "0.05em",
  },
  sizes: {
    hero: "3.5rem", // 56px
    h1: "2.5rem", // 40px
    h2: "2rem", // 32px
    h3: "1.5rem", // 24px
    h4: "1.25rem", // 20px
    bodyLarge: "1.125rem", // 18px
    body: "1rem", // 16px
    bodySmall: "0.875rem", // 14px
    caption: "0.75rem", // 12px
  },
} as const;

export const shadows = {
  tactileCard:
    "0 8px 30px -4px rgba(74, 29, 63, 0.12), 0 2px 6px -1px rgba(74, 29, 63, 0.06)",
  tactileCardHover:
    "0 16px 48px -6px rgba(74, 29, 63, 0.20), 0 6px 12px -2px rgba(74, 29, 63, 0.08)",
  emergencyPulse: "0 0 0 4px rgba(232, 115, 90, 0.25)",
} as const;

export const transitions = {
  fast: "150ms cubic-bezier(0.16, 1, 0.3, 1)",
  standard: "250ms cubic-bezier(0.16, 1, 0.3, 1)",
  keyTurn: "400ms cubic-bezier(0.34, 1.56, 0.64, 1)", // Custom snap curve for consent key turn
} as const;
