export interface InstallerVerifierArguments {
  baselinePath: string | null;
  candidatePath: string | null;
  metadataPath: string;
  reportPath: string;
}

export function parseNumericVersion(value: string): number[];
export function compareNumericVersions(left: string, right: string): -1 | 0 | 1;
export function assertStrictUpgrade(baselineVersion: string, candidateVersion: string): void;
export function parseWindowsInstallerName(filePath: string): { installerName: string; version: string };
export function parseInstallerVerifierArguments(argv: string[], cwd?: string): InstallerVerifierArguments;
