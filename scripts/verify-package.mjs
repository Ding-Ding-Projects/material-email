import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseWindowsInstallerName } from "./installer-upgrade.mjs";

export const sha256File = filePath =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const input = createReadStream(filePath);
    input.on("error", reject);
    input.on("data", chunk => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });

export const verifyPortableExecutable = async filePath => {
  const handle = await open(filePath, "r");
  try {
    const dosHeader = Buffer.alloc(64);
    const dosRead = await handle.read(dosHeader, 0, dosHeader.length, 0);
    if (dosRead.bytesRead !== dosHeader.length || dosHeader.subarray(0, 2).toString("ascii") !== "MZ") {
      throw new Error("Installer does not have a valid DOS/PE header.");
    }
    const peOffset = dosHeader.readUInt32LE(0x3c);
    const peSignature = Buffer.alloc(4);
    const peRead = await handle.read(peSignature, 0, peSignature.length, peOffset);
    if (peRead.bytesRead !== peSignature.length || !peSignature.equals(Buffer.from([0x50, 0x45, 0, 0]))) {
      throw new Error("Installer does not have a valid PE signature.");
    }
  } finally {
    await handle.close();
  }
};

export const inspectWindowsInstallerFile = async (filePath, options = {}) => {
  const installerPath = path.resolve(filePath);
  const { installerName, version } = parseWindowsInstallerName(installerPath);
  const info = await stat(installerPath);
  const minimumSize = options.minimumSize ?? 20_000_000;
  if (info.size < minimumSize) throw new Error(`Installer is unexpectedly small: ${info.size} bytes.`);
  await verifyPortableExecutable(installerPath);
  return {
    installerPath,
    installerName,
    version,
    size: info.size,
    sha256: await sha256File(installerPath),
  };
};

export const inspectWindowsPackage = async () => {
  const packageJson = JSON.parse(await readFile(path.resolve("package.json"), "utf8"));
  const outputDirectory = packageJson.build?.directories?.output;
  const artifactPattern = packageJson.build?.win?.artifactName;
  const targets = packageJson.build?.win?.target;
  const retainsUserData = packageJson.build?.nsis?.deleteAppDataOnUninstall === false;
  if (outputDirectory !== "release") throw new Error(`Expected electron-builder output directory release, received ${outputDirectory}.`);
  if (artifactPattern !== "Material-Email-${version}-Windows-${arch}.${ext}") {
    throw new Error(`Unexpected Windows artifact pattern: ${artifactPattern}.`);
  }
  if (
    !Array.isArray(targets) ||
    targets.length !== 1 ||
    targets[0]?.target !== "nsis" ||
    !Array.isArray(targets[0]?.arch) ||
    targets[0].arch.length !== 1 ||
    targets[0].arch[0] !== "x64"
  ) {
    throw new Error("Windows packaging must produce exactly one x64 NSIS target.");
  }
  if (!retainsUserData) throw new Error("NSIS uninstall must intentionally retain application data.");

  const releaseDirectory = path.resolve(outputDirectory);
  const entries = await readdir(releaseDirectory, { withFileTypes: true });
  const executables = entries.filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith(".exe"));
  if (executables.length !== 1) {
    throw new Error(`Expected exactly one top-level Windows installer, found ${executables.length}: ${executables.map(entry => entry.name).join(", ") || "none"}.`);
  }
  const expectedName = `Material-Email-${packageJson.version}-Windows-x64.exe`;
  if (executables[0].name !== expectedName) {
    throw new Error(`Expected installer ${expectedName}, found ${executables[0].name}.`);
  }
  const inspected = await inspectWindowsInstallerFile(path.join(releaseDirectory, expectedName));
  return {
    ...inspected,
    retainsUserData,
  };
};

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const result = await inspectWindowsPackage();
  console.log(`PASS exactly one x64 NSIS installer: ${result.installerName}`);
  console.log(`PASS portable executable structure (${result.size} bytes)`);
  console.log(`PASS uninstall policy retains application data`);
  console.log(`SHA256 ${result.sha256}`);
}
