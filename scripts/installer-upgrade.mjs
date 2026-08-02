import path from "node:path";

const versionPattern = "(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)";
const installerPattern = new RegExp(`^Material-Email-(${versionPattern})-Windows-x64\\.exe$`);

export const installerDefaultProfileExpectation = Object.freeze({
  isFirstRun: true,
  preferences: Object.freeze({
    language: "en",
    funnyEnglish: 2,
    funnyCantonese: 3,
    theme: "system",
    density: "comfortable",
    accent: "#6750A4",
    fontFamily: "Segoe UI Variable",
    fontScale: 1,
    fontWeight: 400,
    narratorEnabled: false,
    narratorLanguage: "en",
    nativeNotificationsEnabled: false,
    historyRetentionDays: 365,
  }),
  windowState: Object.freeze({
    schemaVersion: 1,
    bounds: Object.freeze({ width: 1_500, height: 940 }),
    maximized: false,
  }),
});

export const installerRetainedProfileExpectation = Object.freeze({
  isFirstRun: true,
  preferences: Object.freeze({
    language: "bilingual",
    funnyEnglish: 5,
    funnyCantonese: 1,
    theme: "dark",
    density: "compact",
    accent: "#005AC1",
    fontFamily: "Segoe UI Variable",
    fontScale: 1.15,
    fontWeight: 600,
    narratorEnabled: false,
    narratorLanguage: "yue",
    nativeNotificationsEnabled: false,
    historyRetentionDays: 731,
  }),
  windowState: Object.freeze({
    schemaVersion: 1,
    bounds: Object.freeze({ width: 960, height: 640 }),
    maximized: false,
  }),
});

const preferenceProbeKeys = Object.freeze(Object.keys(installerDefaultProfileExpectation.preferences));

const requireRecord = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
};

export const selectInstallerPreferenceProbe = value => {
  const preferences = requireRecord(value, "Installer profile preferences");
  const selected = {};
  for (const key of preferenceProbeKeys) {
    if (!Object.hasOwn(preferences, key)) throw new Error(`Installer profile preferences are missing ${key}.`);
    selected[key] = preferences[key];
  }
  return selected;
};

export const prepareRetainedInstallerProfileState = value => {
  const state = requireRecord(value, "Installer profile state");
  if (state.schemaVersion !== 1) throw new Error("Installer profile state must use schema version 1.");
  const preferences = requireRecord(state.preferences, "Installer profile state preferences");
  return {
    ...structuredClone(state),
    preferences: {
      ...structuredClone(preferences),
      ...installerRetainedProfileExpectation.preferences,
    },
  };
};

const assertJsonEqual = (actual, expected, label) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} did not match the deterministic installer profile fixture.`);
};

export const assertInstallerProfileSmoke = (smoke, expectation, label) => {
  const smokeRecord = requireRecord(smoke, `${label} smoke result`);
  const profile = requireRecord(smokeRecord.profile, `${label} profile evidence`);
  if (profile.mode !== "isolated-user-data") {
    throw new Error(`${label} did not report the isolated user-data profile boundary.`);
  }
  if (profile.isFirstRun !== expectation.isFirstRun) {
    throw new Error(`${label} first-run state did not match the deterministic installer profile fixture.`);
  }
  const preferences = selectInstallerPreferenceProbe(profile.preferences);
  assertJsonEqual(preferences, expectation.preferences, `${label} preferences`);
  assertJsonEqual(profile.windowState, expectation.windowState, `${label} window state`);
  return {
    mode: profile.mode,
    isFirstRun: profile.isFirstRun,
    preferences,
    windowState: structuredClone(profile.windowState),
  };
};

export const installerEvidenceLimitations = () => ({
  cleanMachine: false,
  defaultWindowsProfile: false,
  interactiveFirstLaunch: false,
  authenticodeSignatureChecked: false,
});

export const parseNumericVersion = value => {
  const match = new RegExp(`^${versionPattern}$`).exec(value);
  if (!match) throw new Error(`Expected a numeric major.minor.patch version, received ${value || "an empty value"}.`);
  return match.slice(1, 4).map(component => Number.parseInt(component, 10));
};

export const compareNumericVersions = (left, right) => {
  const leftParts = parseNumericVersion(left);
  const rightParts = parseNumericVersion(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = leftParts[index] - rightParts[index];
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
};

export const assertStrictUpgrade = (baselineVersion, candidateVersion) => {
  const comparison = compareNumericVersions(candidateVersion, baselineVersion);
  if (comparison <= 0) {
    const relationship = comparison === 0 ? "the same version as" : "older than";
    throw new Error(`Candidate ${candidateVersion} is ${relationship} baseline ${baselineVersion}; this is not an upgrade.`);
  }
};

export const parseWindowsInstallerName = filePath => {
  const installerName = path.basename(filePath);
  const match = installerPattern.exec(installerName);
  if (!match) {
    throw new Error(
      `Installer name must match Material-Email-<major.minor.patch>-Windows-x64.exe, received ${installerName}.`,
    );
  }
  return { installerName, version: match[1] };
};

const takePathArgument = (argv, index, name, inlinePrefix, cwd) => {
  const argument = argv[index];
  if (argument.startsWith(inlinePrefix)) {
    const value = argument.slice(inlinePrefix.length);
    if (!value) throw new Error(`${name} requires a path.`);
    return { path: path.resolve(cwd, value), consumed: 1 };
  }
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a path.`);
  return { path: path.resolve(cwd, value), consumed: 2 };
};

export const parseInstallerVerifierArguments = (argv, cwd = process.cwd()) => {
  const result = {
    baselinePath: null,
    candidatePath: null,
    metadataPath: path.resolve(cwd, "dist", "release-metadata.json"),
    reportPath: path.resolve(cwd, "release", "installer-qa.json"),
  };
  const seen = new Set();
  for (let index = 0; index < argv.length;) {
    const argument = argv[index];
    const definitions = [
      ["--baseline", "--baseline=", "baselinePath"],
      ["--candidate", "--candidate=", "candidatePath"],
      ["--metadata", "--metadata=", "metadataPath"],
      ["--report", "--report=", "reportPath"],
    ];
    const definition = definitions.find(([name, inlinePrefix]) => argument === name || argument.startsWith(inlinePrefix));
    if (!definition) throw new Error(`Unknown installer verifier argument: ${argument}.`);
    const [name, inlinePrefix, property] = definition;
    if (seen.has(name)) throw new Error(`${name} may be provided only once.`);
    const parsed = takePathArgument(argv, index, name, inlinePrefix, cwd);
    result[property] = parsed.path;
    seen.add(name);
    index += parsed.consumed;
  }
  return result;
};
