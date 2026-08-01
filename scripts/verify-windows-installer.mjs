import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertStrictUpgrade, parseInstallerVerifierArguments } from "./installer-upgrade.mjs";
import { inspectWindowsInstallerFile, inspectWindowsPackage, sha256File } from "./verify-package.mjs";

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

const validateReleaseMetadata = (metadata, artifact) => {
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
};

const options = parseInstallerVerifierArguments(process.argv.slice(2));
const candidate = options.candidatePath
  ? await inspectWindowsInstallerFile(options.candidatePath)
  : await inspectWindowsPackage();
const baseline = options.baselinePath ? await inspectWindowsInstallerFile(options.baselinePath) : null;
if (baseline) assertStrictUpgrade(baseline.version, candidate.version);
const metadata = JSON.parse(await readFile(options.metadataPath, "utf8"));
validateReleaseMetadata(metadata, candidate);

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "material-email-installer-qa-"));
const installDirectory = path.join(temporaryRoot, "installed");
const userDataDirectory = path.join(temporaryRoot, "retained-user-data");
const smokePath = path.join(temporaryRoot, "ci-smoke.json");
const retentionProbe = path.join(userDataDirectory, "installer-qa-retention-probe.txt");
const executablePath = path.join(installDirectory, "Material Email.exe");
let installed = false;
let uninstalled = false;
let result;

const findUninstaller = async () => {
  if (!(await exists(installDirectory))) return "";
  const installEntries = await readdir(installDirectory, { withFileTypes: true });
  const uninstallers = installEntries.filter(entry => entry.isFile() && /^Uninstall.*\.exe$/i.test(entry.name));
  if (uninstallers.length !== 1) {
    throw new Error(`Expected exactly one installed uninstaller, found ${uninstallers.length}.`);
  }
  return path.join(installDirectory, uninstallers[0].name);
};

const install = async artifact => {
  await runExecutable(artifact.installerPath, ["/S", `/D=${installDirectory}`]);
  installed = true;
  if (!(await exists(executablePath))) throw new Error(`Installed executable is missing: ${executablePath}.`);
  await findUninstaller();
  return sha256File(executablePath);
};

const launchSmoke = async (artifact, expectedMetadata) => {
  await rm(smokePath, { force: true });
  await runExecutable(
    executablePath,
    ["--ci-smoke", `--ci-smoke-output=${smokePath}`],
    { env: { ...process.env, MATERIAL_EMAIL_USER_DATA_DIR: userDataDirectory } },
  );
  if (!(await exists(smokePath))) throw new Error("Installed application did not write its CI smoke result.");
  const smoke = JSON.parse(await readFile(smokePath, "utf8"));
  if (smoke.ok !== true) throw new Error("Installed application CI smoke result did not report success.");
  if (smoke.version !== artifact.version) {
    throw new Error(`Installed application reported version ${smoke.version}; expected ${artifact.version}.`);
  }
  if (expectedMetadata && smoke.codeName !== expectedMetadata.codeName) {
    throw new Error(`Installed application reported code name ${smoke.codeName}; expected ${expectedMetadata.codeName}.`);
  }
  if (expectedMetadata && smoke.releaseDate !== expectedMetadata.releaseDate) {
    throw new Error(`Installed application reported release date ${smoke.releaseDate}; expected ${expectedMetadata.releaseDate}.`);
  }
  return {
    version: smoke.version,
    codeName: typeof smoke.codeName === "string" ? smoke.codeName : null,
    releaseDate: typeof smoke.releaseDate === "string" ? smoke.releaseDate : null,
  };
};

const readVerifiedProbeHash = async expectedHash => {
  if (!(await exists(retentionProbe))) throw new Error("The isolated user-data retention probe is missing.");
  const actualHash = await sha256File(retentionProbe);
  if (actualHash !== expectedHash) throw new Error("The isolated user-data retention probe changed unexpectedly.");
  return actualHash;
};

const uninstall = async () => {
  const uninstallerPath = await findUninstaller();
  await runExecutable(uninstallerPath, ["/S"]);
  if (!(await waitUntilMissing(executablePath))) throw new Error("Installed executable remained after silent uninstall.");
  uninstalled = true;
};

try {
  let baselineSmoke = null;
  let baselineInstalledExecutableSha256 = null;
  if (baseline) {
    baselineInstalledExecutableSha256 = await install(baseline);
    baselineSmoke = await launchSmoke(baseline);
  }

  await mkdir(userDataDirectory, { recursive: true });
  await writeFile(retentionProbe, `${randomUUID()}\n`, "utf8");
  const retentionProbeSha256 = await sha256File(retentionProbe);

  const candidateInstalledExecutableSha256 = await install(candidate);
  const retainedAfterUpgradeSha256 = baseline ? await readVerifiedProbeHash(retentionProbeSha256) : null;
  const candidateSmoke = await launchSmoke(candidate, metadata);
  if (baseline) await readVerifiedProbeHash(retentionProbeSha256);

  await uninstall();
  const retainedAfterUninstallSha256 = await readVerifiedProbeHash(retentionProbeSha256);

  result = {
    ok: true,
    verificationMode: baseline ? "baseline-to-candidate-upgrade" : "single-installer-lifecycle",
    verificationEnvironment: {
      platform: process.platform,
      architecture: process.arch,
      windowsRelease: os.release(),
      isolatedInstallDirectory: true,
      isolatedUserDataDirectory: true,
      cleanMachine: false,
      defaultWindowsProfile: false,
    },
    installerPath: candidate.installerPath,
    installerName: candidate.installerName,
    installerSize: candidate.size,
    installerSha256: candidate.sha256,
    version: candidate.version,
    codeName: metadata.codeName,
    releaseDate: metadata.releaseDate,
    installedExecutableRemoved: true,
    retainedUserData: true,
    baselineVersion: baseline?.version ?? null,
    baselineInstallerName: baseline?.installerName ?? null,
    baselineInstallerSize: baseline?.size ?? null,
    baselineInstallerSha256: baseline?.sha256 ?? null,
    baselineInstalledExecutableSha256,
    baselineSmoke,
    candidateVersion: candidate.version,
    candidateInstallerSha256: candidate.sha256,
    candidateInstalledExecutableSha256,
    candidateSmoke,
    upgradeVerified: baseline !== null,
    upgradeInstallDirectoryReused: baseline !== null,
    retainedAfterUpgrade: baseline !== null && retainedAfterUpgradeSha256 === retentionProbeSha256,
    retentionProbeSha256,
    retainedAfterUpgradeSha256,
    retainedAfterUninstallSha256,
    deleteAppDataOnUninstall: false,
  };
} finally {
  if (installed && !uninstalled && (await exists(executablePath))) {
    try {
      await uninstall();
    } catch (error) {
      console.error(`Cleanup uninstall failed; retained diagnostic directory: ${temporaryRoot}`, error);
    }
  }
  if (!installed || uninstalled) await rm(temporaryRoot, { recursive: true, force: true });
}

await mkdir(path.dirname(options.reportPath), { recursive: true });
await writeFile(options.reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
if (baseline) {
  console.log(`PASS upgraded ${baseline.installerName} to ${candidate.installerName} in the same isolated install directory`);
  console.log(`PASS isolated user-data hash ${result.retentionProbeSha256} survived upgrade and uninstall unchanged`);
} else {
  console.log(`PASS installed ${candidate.installerName} silently and launched its packaged executable`);
}
console.log(`PASS metadata ${result.version} · ${result.codeName}${result.releaseDate ? ` · ${result.releaseDate}` : " · development build (no release date)"}`);
console.log("PASS silent uninstall removed the executable and retained isolated user data by policy");
console.log(`PASS lifecycle report ${options.reportPath}`);
