import path from "node:path";

const versionPattern = "(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)";
const installerPattern = new RegExp(`^Material-Email-(${versionPattern})-Windows-x64\\.exe$`);

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
