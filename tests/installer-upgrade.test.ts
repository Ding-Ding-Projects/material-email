import { mkdtemp, open, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertInstallerProfileSmoke,
  assertStrictUpgrade,
  compareNumericVersions,
  installerDefaultProfileExpectation,
  installerEvidenceLimitations,
  installerRetainedProfileExpectation,
  parseInstallerVerifierArguments,
  parseWindowsInstallerName,
  prepareRetainedInstallerProfileState,
} from "../scripts/installer-upgrade.mjs";
import { inspectWindowsInstallerFile } from "../scripts/verify-package.mjs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe("installer upgrade contract", () => {
  it("recognizes only versioned Windows x64 installer names", () => {
    expect(parseWindowsInstallerName("Material-Email-0.19.1-Windows-x64.exe")).toEqual({
      installerName: "Material-Email-0.19.1-Windows-x64.exe",
      version: "0.19.1",
    });
    expect(() => parseWindowsInstallerName("Material-Email-latest-Windows-x64.exe")).toThrow(/must match/);
    expect(() => parseWindowsInstallerName("Material-Email-01.2.3-Windows-x64.exe")).toThrow(/must match/);
    expect(() => parseWindowsInstallerName("Material-Email-1.2.3-Windows-arm64.exe")).toThrow(/must match/);
  });

  it("requires a candidate that is strictly newer than the baseline", () => {
    expect(compareNumericVersions("0.20.1", "0.19.1")).toBe(1);
    expect(compareNumericVersions("1.0.0", "0.99.99")).toBe(1);
    expect(compareNumericVersions("0.19.1", "0.19.1")).toBe(0);
    expect(compareNumericVersions("0.18.9", "0.19.1")).toBe(-1);
    expect(() => assertStrictUpgrade("0.19.1", "0.20.1")).not.toThrow();
    expect(() => assertStrictUpgrade("0.19.1", "0.19.1")).toThrow(/not an upgrade/);
    expect(() => assertStrictUpgrade("0.19.1", "0.18.9")).toThrow(/not an upgrade/);
  });

  it("parses explicit baseline, candidate, metadata, and report paths without hidden defaults", () => {
    const cwd = path.join(os.tmpdir(), "installer-arguments");
    expect(
      parseInstallerVerifierArguments(
        ["--baseline", "previous.exe", "--candidate=next.exe", "--metadata", "meta.json", "--report=proof.json"],
        cwd,
      ),
    ).toEqual({
      baselinePath: path.resolve(cwd, "previous.exe"),
      candidatePath: path.resolve(cwd, "next.exe"),
      metadataPath: path.resolve(cwd, "meta.json"),
      reportPath: path.resolve(cwd, "proof.json"),
    });
    expect(() => parseInstallerVerifierArguments(["--baseline"], cwd)).toThrow(/requires a path/);
    expect(() => parseInstallerVerifierArguments(["--baseline=a", "--baseline=b"], cwd)).toThrow(/only once/);
    expect(() => parseInstallerVerifierArguments(["--mystery", "value"], cwd)).toThrow(/Unknown/);
  });

  it("hashes and validates the PE structure of an explicitly named installer", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-pe-test-"));
    temporaryDirectories.push(directory);
    const installerPath = path.join(directory, "Material-Email-2.3.4-Windows-x64.exe");
    const handle = await open(installerPath, "w+");
    try {
      await handle.truncate(4096);
      const dosHeader = Buffer.alloc(64);
      dosHeader.write("MZ", 0, "ascii");
      dosHeader.writeUInt32LE(0x80, 0x3c);
      await handle.write(dosHeader, 0, dosHeader.length, 0);
      await handle.write(Buffer.from([0x50, 0x45, 0, 0]), 0, 4, 0x80);
    } finally {
      await handle.close();
    }

    const inspected = await inspectWindowsInstallerFile(installerPath, { minimumSize: 4096 });
    expect(inspected).toMatchObject({
      installerPath,
      installerName: "Material-Email-2.3.4-Windows-x64.exe",
      version: "2.3.4",
      size: 4096,
    });
    expect(inspected.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("patches only the deterministic retained settings fixture into an existing version-1 profile", () => {
    const original = {
      schemaVersion: 1,
      accounts: [],
      preferences: {
        ...installerDefaultProfileExpectation.preferences,
        selectedAccountId: "fixture-account",
      },
      history: [{ id: "preserved-history" }],
    };

    const prepared = prepareRetainedInstallerProfileState(original);

    expect(prepared).toEqual({
      ...original,
      preferences: {
        ...original.preferences,
        ...installerRetainedProfileExpectation.preferences,
      },
    });
    expect(original.preferences).toMatchObject(installerDefaultProfileExpectation.preferences);
    expect(() => prepareRetainedInstallerProfileState({ schemaVersion: 2, preferences: {} })).toThrow(/schema version 1/i);
    expect(() => prepareRetainedInstallerProfileState({ schemaVersion: 1 })).toThrow(/preferences must be an object/i);
  });

  it("accepts only exact isolated-profile default and retained smoke evidence", () => {
    const smokeFor = (expectation: typeof installerDefaultProfileExpectation) => ({
      profile: {
        mode: "isolated-user-data",
        isFirstRun: expectation.isFirstRun,
        preferences: { ...expectation.preferences },
        windowState: { ...expectation.windowState, bounds: { ...expectation.windowState.bounds } },
      },
    });

    expect(assertInstallerProfileSmoke(
      smokeFor(installerDefaultProfileExpectation),
      installerDefaultProfileExpectation,
      "clean fixture",
    )).toEqual(smokeFor(installerDefaultProfileExpectation).profile);
    expect(assertInstallerProfileSmoke(
      smokeFor(installerRetainedProfileExpectation),
      installerRetainedProfileExpectation,
      "retained fixture",
    )).toEqual(smokeFor(installerRetainedProfileExpectation).profile);

    const defaultProfileClaim = smokeFor(installerDefaultProfileExpectation);
    defaultProfileClaim.profile.mode = "windows-default-user-data";
    expect(() => assertInstallerProfileSmoke(defaultProfileClaim, installerDefaultProfileExpectation, "claim guard")).toThrow(
      /isolated user-data profile boundary/i,
    );

    const changedSettings = smokeFor(installerRetainedProfileExpectation);
    changedSettings.profile.preferences.theme = "light";
    expect(() => assertInstallerProfileSmoke(changedSettings, installerRetainedProfileExpectation, "settings guard")).toThrow(
      /preferences did not match/i,
    );

    const changedWindow = smokeFor(installerRetainedProfileExpectation);
    changedWindow.profile.windowState.bounds.width += 1;
    expect(() => assertInstallerProfileSmoke(changedWindow, installerRetainedProfileExpectation, "window guard")).toThrow(
      /window state did not match/i,
    );
  });

  it("keeps stronger Windows delivery claims explicitly outside the local harness", () => {
    expect(installerEvidenceLimitations()).toEqual({
      cleanMachine: false,
      defaultWindowsProfile: false,
      interactiveFirstLaunch: false,
      authenticodeSignatureChecked: false,
    });
  });
});
