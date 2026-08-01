import type { Preferences } from "../../shared/contracts";

export const DEFAULT_APPEARANCE: Pick<Preferences, "theme" | "density" | "accent" | "fontFamily" | "fontScale" | "fontWeight"> = {
  theme: "system", density: "comfortable", accent: "#6750A4", fontFamily: "Segoe UI Variable", fontScale: 1, fontWeight: 400,
};

export const resetAppearancePreferences = (current: Preferences): Preferences => ({ ...current, ...DEFAULT_APPEARANCE });
