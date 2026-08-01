import type { Preferences } from "../../shared/contracts";
import { DEFAULT_APPEARANCE_PREFERENCES } from "../../shared/appearance";
export const DEFAULT_APPEARANCE = DEFAULT_APPEARANCE_PREFERENCES;

export const resetAppearancePreferences = (current: Preferences): Preferences => ({ ...current, ...DEFAULT_APPEARANCE });
