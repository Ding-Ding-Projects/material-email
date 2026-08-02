export interface InstallerVerifierArguments {
  baselinePath: string | null;
  candidatePath: string | null;
  metadataPath: string;
  reportPath: string;
}

export interface InstallerPreferenceProbe {
  language: "en" | "yue" | "bilingual";
  funnyEnglish: 1 | 2 | 3 | 4 | 5;
  funnyCantonese: 1 | 2 | 3 | 4 | 5;
  theme: "light" | "dark" | "system";
  density: "compact" | "comfortable" | "relaxed";
  accent: string;
  fontFamily: string;
  fontScale: number;
  fontWeight: number;
  narratorEnabled: boolean;
  narratorLanguage: "en" | "yue" | "bilingual";
  nativeNotificationsEnabled: boolean;
  historyRetentionDays: number;
}

export interface InstallerWindowStateProbe {
  schemaVersion: 1;
  bounds: { x?: number; y?: number; width: number; height: number };
  maximized: boolean;
}

export interface InstallerProfileExpectation {
  isFirstRun: boolean;
  preferences: Readonly<InstallerPreferenceProbe>;
  windowState: Readonly<InstallerWindowStateProbe>;
}

export interface InstallerProfileSmoke {
  profile: {
    mode: string;
    isFirstRun: boolean;
    preferences: Record<string, unknown>;
    windowState: unknown;
  };
}

export const installerDefaultProfileExpectation: Readonly<InstallerProfileExpectation>;
export const installerRetainedProfileExpectation: Readonly<InstallerProfileExpectation>;
export function selectInstallerPreferenceProbe(value: unknown): InstallerPreferenceProbe;
export function prepareRetainedInstallerProfileState(value: unknown): Record<string, unknown>;
export function assertInstallerProfileSmoke(
  smoke: unknown,
  expectation: InstallerProfileExpectation,
  label: string,
): InstallerProfileSmoke["profile"] & { preferences: InstallerPreferenceProbe; windowState: InstallerWindowStateProbe };
export function installerEvidenceLimitations(): {
  cleanMachine: false;
  defaultWindowsProfile: false;
  interactiveFirstLaunch: false;
  authenticodeSignatureChecked: false;
};

export function parseNumericVersion(value: string): number[];
export function compareNumericVersions(left: string, right: string): -1 | 0 | 1;
export function assertStrictUpgrade(baselineVersion: string, candidateVersion: string): void;
export function parseWindowsInstallerName(filePath: string): { installerName: string; version: string };
export function parseInstallerVerifierArguments(argv: string[], cwd?: string): InstallerVerifierArguments;
