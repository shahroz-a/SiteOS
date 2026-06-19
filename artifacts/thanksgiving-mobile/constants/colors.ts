/**
 * Semantic design tokens for the mobile app.
 *
 * Originally synced from the now-removed Thanksgiving guide web artifact;
 * these tokens are the source of truth for the mobile app's warm, editorial
 * visual identity (the same palette used by the blog at artifacts/blog).
 * HSL values from index.css were converted to hex.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: "#2c2521",
    tint: "#b85814",

    // Core surfaces
    background: "#faf8f5",
    foreground: "#2c2521",

    // Cards / elevated surfaces
    card: "#ffffff",
    cardForeground: "#2c2521",

    // Primary action color (buttons, links, active states)
    primary: "#b85814",
    primaryForeground: "#ffffff",

    // Secondary / less-emphasis interactive surfaces
    secondary: "#ede7de",
    secondaryForeground: "#2c2521",

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: "#efece7",
    mutedForeground: "#7e7167",

    // Accent highlights (badges, selected items, focus rings)
    accent: "#ede7de",
    accentForeground: "#2c2521",

    // Destructive actions (delete, error states)
    destructive: "#df2020",
    destructiveForeground: "#ffffff",

    // Borders and input outlines
    border: "#e0dad1",
    input: "#e0dad1",
  },

  dark: {
    text: "#ebe7e0",
    tint: "#e66e1a",

    background: "#1d1916",
    foreground: "#ebe7e0",

    card: "#231e1a",
    cardForeground: "#ebe7e0",

    primary: "#e66e1a",
    primaryForeground: "#ffffff",

    secondary: "#3b322b",
    secondaryForeground: "#ebe7e0",

    muted: "#3b322b",
    mutedForeground: "#b3a898",

    accent: "#3b322b",
    accentForeground: "#ebe7e0",

    destructive: "#ad1f1f",
    destructiveForeground: "#ffffff",

    border: "#3b322b",
    input: "#493e36",
  },

  // Border radius (in px). Synced from the web artifact's --radius (0.5rem).
  radius: 8,
};

export default colors;
