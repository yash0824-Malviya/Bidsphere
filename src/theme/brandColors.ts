/**
 * Netlink brand / primary design tokens (JS consumers: charts, Three.js, etc.).
 * CSS source of truth: `:root` variables in `src/index.css`.
 * Keep these hex values in sync with `--color-primary*` tokens.
 */

export const BRAND = {
  primary: "#1F3A6D",
  primaryHover: "#17315D",
  primaryActive: "#12284D",
  primaryLight: "#EEF3FA",
  primaryBorder: "#D6E2F5",
  primaryText: "#1F3A6D",
} as const;

/** Tonal shades of the primary brand for multi-series charts. */
export const PRIMARY_CHART_SCALE = [
  BRAND.primary,
  BRAND.primaryHover,
  "#3D5A8A",
  BRAND.primaryActive,
  "#6B86B0",
  "#0E1F3C",
  BRAND.primaryBorder,
  "#8FA4C4",
] as const;
