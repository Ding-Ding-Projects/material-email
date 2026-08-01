import type { Preferences } from "./contracts.js";

export const DEFAULT_APPEARANCE_PREFERENCES: Pick<Preferences, "theme" | "density" | "accent" | "fontFamily" | "fontScale" | "fontWeight"> = {
  theme: "system", density: "comfortable", accent: "#6750A4", fontFamily: "Segoe UI Variable", fontScale: 1, fontWeight: 400,
};
