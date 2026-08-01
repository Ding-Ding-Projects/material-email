import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  assertInstallerProfileSmoke,
  assertStrictUpgrade,
  installerDefaultProfileExpectation,
  installerEvidenceLimitations,
  installerRetainedProfileExpectation,
  parseInstallerVerifierArguments,
  prepareRetainedInstallerProfileState,
} from "./installer-upgrade.mjs";
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
  for (const [metadataKey, environmentKey] of [
    ["codeName", "MATERIAL_EMAIL_CODE_NAME"],
    ["dishId", "MATERIAL_EMAIL_DISH_ID"],
    ["imageAsset", "MATERIAL_EMAIL_DISH_ASSET"],
    ["catalogCommit", "MATERIAL_EMAIL_CATALOG_COMMIT"],
  ]) {
    if (Object.hasOwn(process.env, environmentKey) && metadata[metadataKey] !== (process.env[environmentKey]?.trim() ?? "")) {
      throw new Error(`Packaged metadata ${metadataKey} does not match ${environmentKey}.`);
    }
  }
  if (process.env.MATERIAL_EMAIL_RELEASE_DATE && metadata.releaseDate !== process.env.MATERIAL_EMAIL_RELEASE_DATE) {
    throw new Error("Packaged metadata release date does not match MATERIAL_EMAIL_RELEASE_DATE.");
  }
  for (const key of ["codeName", "dishId", "imageAsset", "catalogCommit"]) {
    if (typeof metadata[key] !== "string") throw new Error(`Packaged metadata ${key} must be a string.`);
  }
  const decorationValues = [metadata.codeName, metadata.dishId, metadata.imageAsset, metadata.catalogCommit].map(value => value.trim());
  const hasDecoration = decorationValues.some(Boolean);
  if (hasDecoration && !decorationValues.every(Boolean)) {
    throw new Error("Packaged release decoration must include code name, dish ID, image asset, and catalog commit together.");
  }
  if (hasDecoration) {
    if (!/^hk-dish-\d{4}$/u.test(metadata.dishId)) throw new Error("Packaged metadata dish ID is invalid.");
    if (!/^hk-dish-\d{4}-[a-z0-9-]+\.png$/u.test(metadata.imageAsset)) throw new Error("Packaged metadata image asset is invalid.");
    if (!/^[0-9a-f]{40}$/u.test(metadata.catalogCommit)) throw new Error("Packaged metadata catalog commit is invalid.");
  }
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
const cleanCandidateUserDataDirectory = baseline ? path.join(temporaryRoot, "candidate-clean-user-data") : userDataDirectory;
const smokePath = path.join(temporaryRoot, "ci-smoke.json");
const retentionProbe = path.join(userDataDirectory, "installer-qa-retention-probe.txt");
const profileStatePath = path.join(userDataDirectory, "material-email-state-v1.json");
const windowStatePath = path.join(userDataDirectory, "window-state.json");
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

const launchSmoke = async (artifact, expectedMetadata, profileDirectory, profileExpectation = null, label = "Installed application") => {
  await rm(smokePath, { force: true });
  await runExecutable(
    executablePath,
    ["--ci-smoke", `--ci-smoke-output=${smokePath}`],
    { env: { ...process.env, MATERIAL_EMAIL_USER_DATA_DIR: profileDirectory } },
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
  const profile = profileExpectation ? assertInstallerProfileSmoke(smoke, profileExpectation, label) : null;
  return {
    version: smoke.version,
    codeName: typeof smoke.codeName === "string" ? smoke.codeName : null,
    releaseDate: typeof smoke.releaseDate === "string" ? smoke.releaseDate : null,
    profile,
  };
};

const requireAbsentProfile = async (profileDirectory, label) => {
  if (await exists(profileDirectory)) throw new Error(`${label} must not exist before its first packaged launch.`);
};

const seedRetainedProfile = async () => {
  if (!(await exists(profileStatePath))) throw new Error("The packaged first launch did not create its isolated settings state.");
  const currentState = JSON.parse(await readFile(profileStatePath, "utf8"));
  const retainedState = prepareRetainedInstallerProfileState(currentState);
  await writeFile(profileStatePath, `${JSON.stringify(retainedState, null, 2)}\n`, "utf8");
  await writeFile(windowStatePath, `${JSON.stringify(installerRetainedProfileExpectation.windowState, null, 2)}\n`, "utf8");
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
  let candidateInstalledExecutableSha256 = null;
  let candidateCleanProfileSmoke = null;
  let candidateSmoke = null;
  let candidateCleanProfileWasAbsent = false;
  await requireAbsentProfile(userDataDirectory, baseline ? "Baseline isolated profile" : "Candidate isolated profile");
  if (baseline) {
    baselineInstalledExecutableSha256 = await install(baseline);
    baselineSmoke = await launchSmoke(baseline, null, userDataDirectory);
  } else {
    candidateInstalledExecutableSha256 = await install(candidate);
    candidateCleanProfileWasAbsent = true;
    candidateCleanProfileSmoke = await launchSmoke(
      candidate,
      metadata,
      cleanCandidateUserDataDirectory,
      installerDefaultProfileExpectation,
      "Candidate clean isolated profile",
    );
  }

  await mkdir(userDataDirectory, { recursive: true });
  await writeFile(retentionProbe, `${randomUUID()}\n`, "utf8");
  const retentionProbeSha256 = await sha256File(retentionProbe);
  await seedRetainedProfile();
  const settingsStateSeedSha256 = await sha256File(profileStatePath);
  const windowStateSeedSha256 = await sha256File(windowStatePath);

  if (baseline) {
    candidateInstalledExecutableSha256 = await install(candidate);
    candidateCleanProfileWasAbsent = !(await exists(cleanCandidateUserDataDirectory));
    if (!candidateCleanProfileWasAbsent) throw new Error("Candidate clean isolated profile existed before its first packaged launch.");
    candidateCleanProfileSmoke = await launchSmoke(
      candidate,
      metadata,
      cleanCandidateUserDataDirectory,
      installerDefaultProfileExpectation,
      "Candidate clean isolated profile",
    );
  }
  const retainedAfterUpgradeSha256 = baseline ? await readVerifiedProbeHash(retentionProbeSha256) : null;
  const settingsStateAfterUpgradeSha256 = baseline ? await sha256File(profileStatePath) : null;
  const windowStateAfterUpgradeSha256 = baseline ? await sha256File(windowStatePath) : null;
  if (baseline && settingsStateAfterUpgradeSha256 !== settingsStateSeedSha256) {
    throw new Error("The retained settings state changed during candidate installation.");
  }
  if (baseline && windowStateAfterUpgradeSha256 !== windowStateSeedSha256) {
    throw new Error("The retained window state changed during candidate installation.");
  }
  candidateSmoke = await launchSmoke(
    candidate,
    metadata,
    userDataDirectory,
    installerRetainedProfileExpectation,
    "Candidate retained isolated profile",
  );
  await readVerifiedProbeHash(retentionProbeSha256);
  const settingsStateAfterCandidateLaunchSha256 = await sha256File(profileStatePath);
  if (settingsStateAfterCandidateLaunchSha256 !== settingsStateSeedSha256) {
    throw new Error("The retained settings state changed during candidate launch.");
  }
  const windowStateAfterCandidateLaunchSha256 = await sha256File(windowStatePath);

  await uninstall();
  const retainedAfterUninstallSha256 = await readVerifiedProbeHash(retentionProbeSha256);
  const settingsStateAfterUninstallSha256 = await sha256File(profileStatePath);
  const windowStateAfterUninstallSha256 = await sha256File(windowStatePath);
  if (settingsStateAfterUninstallSha256 !== settingsStateAfterCandidateLaunchSha256) {
    throw new Error("The retained settings state changed during uninstall.");
  }
  if (windowStateAfterUninstallSha256 !== windowStateAfterCandidateLaunchSha256) {
    throw new Error("The retained window state changed during uninstall.");
  }

  result = {
    ok: true,
    verificationMode: baseline ? "baseline-to-candidate-upgrade" : "single-installer-lifecycle",
    verificationEnvironment: {
      platform: process.platform,
      architecture: process.arch,
      windowsRelease: os.release(),
      isolatedInstallDirectory: true,
      isolatedUserDataDirectory: true,
      ...installerEvidenceLimitations(),
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
    candidateCleanProfileSmoke,
    candidateSmoke,
    candidateCleanProfileWasAbsent,
    cleanIsolatedProfileLaunchVerified: candidateCleanProfileWasAbsent && candidateCleanProfileSmoke?.profile?.mode === "isolated-user-data",
    defaultSettingsVerifiedInIsolatedProfile: candidateCleanProfileSmoke?.profile?.isFirstRun === true,
    retainedSettingsVerifiedInIsolatedProfile: candidateSmoke?.profile?.isFirstRun === true,
    retainedWindowStateVerifiedInIsolatedProfile: candidateSmoke?.profile?.isFirstRun === true,
    upgradeVerified: baseline !== null,
    upgradeInstallDirectoryReused: baseline !== null,
    retainedAfterUpgrade: baseline !== null && retainedAfterUpgradeSha256 === retentionProbeSha256,
    retainedSettingsAfterUpgrade: baseline !== null && settingsStateAfterUpgradeSha256 === settingsStateSeedSha256,
    retainedWindowStateAfterUpgrade: baseline !== null && windowStateAfterUpgradeSha256 === windowStateSeedSha256,
    retentionProbeSha256,
    retainedAfterUpgradeSha256,
    retainedAfterUninstallSha256,
    settingsStateSeedSha256,
    settingsStateAfterUpgradeSha256,
    settingsStateAfterCandidateLaunchSha256,
    settingsStateAfterUninstallSha256,
    windowStateSeedSha256,
    windowStateAfterUpgradeSha256,
    windowStateAfterCandidateLaunchSha256,
    windowStateAfterUninstallSha256,
    retainedSettingsAfterUninstall: settingsStateAfterUninstallSha256 === settingsStateAfterCandidateLaunchSha256,
    retainedWindowStateAfterUninstall: windowStateAfterUninstallSha256 === windowStateAfterCandidateLaunchSha256,
    authenticode: {
      checked: false,
      status: "not-verified",
    },
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
console.log("PASS candidate launched once from an absent isolated profile with default settings and window state");
console.log("PASS deterministic settings and window state survived candidate launch and uninstall in isolated user data");
console.log(`PASS metadata ${result.version} · ${result.codeName || "no code name assigned"}${result.releaseDate ? ` · ${result.releaseDate}` : " · development build (no release date)"}`);
console.log("PASS silent uninstall removed the executable and retained isolated user data by policy");
console.log("LIMIT clean machine, default Windows profile, interactive first launch, and Authenticode signature were not verified");
console.log(`PASS lifecycle report ${options.reportPath}`);
