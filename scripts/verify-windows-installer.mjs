import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspectWindowsPackage } from "./verify-package.mjs";

if (process.platform !== "win32") throw new Error("Windows installer lifecycle verification requires Windows.");

const exists = async filePath => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const runExecutable = (filePath, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(filePath, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: "inherit",
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${path.basename(filePath)} exceeded the ${options.timeoutMs || 120_000} ms timeout.`));
    }, options.timeoutMs || 120_000);
    child.once("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(filePath)} exited with code ${code ?? "none"}${signal ? ` and signal ${signal}` : ""}.`));
    });
  });

const waitUntilMissing = async (filePath, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await exists(filePath))) return true;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return !(await exists(filePath));
};

const reportArgumentIndex = process.argv.findIndex(argument => argument === "--report");
const inlineReportArgument = process.argv.find(argument => argument.startsWith("--report="));
const reportPath = inlineReportArgument
  ? path.resolve(inlineReportArgument.slice("--report=".length))
  : reportArgumentIndex >= 0 && process.argv[reportArgumentIndex + 1]
    ? path.resolve(process.argv[reportArgumentIndex + 1])
    : path.resolve("release", "installer-qa.json");

const artifact = await inspectWindowsPackage();
const metadata = JSON.parse(await readFile(path.resolve("dist", "release-metadata.json"), "utf8"));
if (metadata.version !== artifact.version) {
  throw new Error(`Packaged metadata version ${metadata.version} does not match installer version ${artifact.version}.`);
}
if (process.env.MATERIAL_EMAIL_RELEASE_VERSION && metadata.version !== process.env.MATERIAL_EMAIL_RELEASE_VERSION) {
  throw new Error("Packaged metadata version does not match MATERIAL_EMAIL_RELEASE_VERSION.");
}
if (process.env.MATERIAL_EMAIL_CODE_NAME && metadata.codeName !== process.env.MATERIAL_EMAIL_CODE_NAME) {
  throw new Error("Packaged metadata code name does not match MATERIAL_EMAIL_CODE_NAME.");
}
if (process.env.MATERIAL_EMAIL_RELEASE_DATE && metadata.releaseDate !== process.env.MATERIAL_EMAIL_RELEASE_DATE) {
  throw new Error("Packaged metadata release date does not match MATERIAL_EMAIL_RELEASE_DATE.");
}
if (typeof metadata.codeName !== "string" || !metadata.codeName.trim()) throw new Error("Packaged metadata code name is missing.");
if (typeof metadata.releaseDate !== "string") throw new Error("Packaged metadata release date must be a string.");
if (metadata.releaseDate) {
  const parsedReleaseDate = new Date(`${metadata.releaseDate}T00:00:00.000Z`);
  if (Number.isNaN(parsedReleaseDate.valueOf()) || parsedReleaseDate.toISOString().slice(0, 10) !== metadata.releaseDate) {
    throw new Error(`Packaged metadata release date is invalid: ${metadata.releaseDate}.`);
  }
}

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "material-email-installer-qa-"));
const installDirectory = path.join(temporaryRoot, "installed");
const userDataDirectory = path.join(temporaryRoot, "retained-user-data");
const smokePath = path.join(temporaryRoot, "ci-smoke.json");
const retentionProbe = path.join(userDataDirectory, "installer-qa-retention-probe.txt");
const executablePath = path.join(installDirectory, "Material Email.exe");
let uninstallerPath = "";
let installed = false;
let uninstalled = false;
let result;

const uninstall = async () => {
  await runExecutable(uninstallerPath, ["/S"]);
  if (!(await waitUntilMissing(executablePath))) throw new Error("Installed executable remained after silent uninstall.");
  uninstalled = true;
};

try {
  await runExecutable(artifact.installerPath, ["/S", `/D=${installDirectory}`]);
  installed = true;
  if (!(await exists(executablePath))) throw new Error(`Installed executable is missing: ${executablePath}.`);
  const installEntries = await readdir(installDirectory, { withFileTypes: true });
  const uninstallers = installEntries.filter(entry => entry.isFile() && /^Uninstall.*\.exe$/i.test(entry.name));
  if (uninstallers.length !== 1) {
    throw new Error(`Expected exactly one installed uninstaller, found ${uninstallers.length}.`);
  }
  uninstallerPath = path.join(installDirectory, uninstallers[0].name);

  await mkdir(userDataDirectory, { recursive: true });
  await writeFile(retentionProbe, `${randomUUID()}\n`, "utf8");
  await runExecutable(
    executablePath,
    ["--ci-smoke", `--ci-smoke-output=${smokePath}`],
    { env: { ...process.env, MATERIAL_EMAIL_USER_DATA_DIR: userDataDirectory } },
  );
  if (!(await exists(smokePath))) throw new Error("Installed application did not write its CI smoke result.");
  const smoke = JSON.parse(await readFile(smokePath, "utf8"));
  if (smoke.ok !== true) throw new Error("Installed application CI smoke result did not report success.");
  if (smoke.version !== artifact.version || smoke.version !== metadata.version) {
    throw new Error(`Installed application reported version ${smoke.version}; expected ${artifact.version}.`);
  }
  if (smoke.codeName !== metadata.codeName) {
    throw new Error(`Installed application reported code name ${smoke.codeName}; expected ${metadata.codeName}.`);
  }
  if (smoke.releaseDate !== metadata.releaseDate) {
    throw new Error(`Installed application reported release date ${smoke.releaseDate}; expected ${metadata.releaseDate}.`);
  }

  await uninstall();
  if (!(await exists(retentionProbe))) throw new Error("Silent uninstall removed the retained user-data probe.");

  result = {
    ok: true,
    installerPath: artifact.installerPath,
    installerName: artifact.installerName,
    installerSize: artifact.size,
    installerSha256: artifact.sha256,
    version: artifact.version,
    codeName: metadata.codeName,
    releaseDate: metadata.releaseDate,
    installedExecutableRemoved: true,
    retainedUserData: true,
    baselineVersion: null,
    candidateVersion: artifact.version,
    upgradeVerified: false,
    retainedAfterUpgrade: false,
    deleteAppDataOnUninstall: false,
  };
} finally {
  if (installed && !uninstalled && uninstallerPath && (await exists(uninstallerPath))) {
    try {
      await uninstall();
    } catch (error) {
      console.error(`Cleanup uninstall failed; retained diagnostic directory: ${temporaryRoot}`, error);
    }
  }
  if (!installed || uninstalled) await rm(temporaryRoot, { recursive: true, force: true });
}

await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`PASS installed ${result.installerName} silently and launched its packaged executable`);
console.log(`PASS metadata ${result.version} · ${result.codeName}${result.releaseDate ? ` · ${result.releaseDate}` : " · development build (no release date)"}`);
console.log("PASS silent uninstall removed the executable and retained isolated user data by policy");
console.log(`PASS lifecycle report ${reportPath}`);
