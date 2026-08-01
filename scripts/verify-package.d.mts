export interface WindowsInstallerArtifact {
  installerPath: string;
  installerName: string;
  version: string;
  size: number;
  sha256: string;
}

export function sha256File(filePath: string): Promise<string>;
export function verifyPortableExecutable(filePath: string): Promise<void>;
export function inspectWindowsInstallerFile(
  filePath: string,
  options?: { minimumSize?: number },
): Promise<WindowsInstallerArtifact>;
export function inspectWindowsPackage(): Promise<WindowsInstallerArtifact & { retainsUserData: boolean }>;
