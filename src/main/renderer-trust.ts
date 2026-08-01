import { pathToFileURL } from "node:url";

export type RendererLoadTarget =
  | { kind: "file"; filePath: string; trustedUrl: string }
  | { kind: "url"; trustedUrl: string };

const loopbackHosts = new Set(["127.0.0.1", "[::1]"]);

export const parseLoopbackDevelopmentUrl = (value: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("MATERIAL_EMAIL_DEV_URL must be an absolute loopback HTTP URL.");
  }
  if (
    parsed.protocol !== "http:" ||
    !loopbackHosts.has(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("MATERIAL_EMAIL_DEV_URL must use plain HTTP on 127.0.0.1 or [::1], without credentials, query, or fragment.");
  }
  return parsed.href;
};

export const resolveRendererLoadTarget = (input: {
  isPackaged: boolean;
  rendererPath: string;
  developmentUrl?: string | undefined;
}): RendererLoadTarget => {
  if (!input.isPackaged && input.developmentUrl) {
    return { kind: "url", trustedUrl: parseLoopbackDevelopmentUrl(input.developmentUrl) };
  }
  return { kind: "file", filePath: input.rendererPath, trustedUrl: pathToFileURL(input.rendererPath).href };
};

export const isTrustedRendererFrameUrl = (candidate: string, trustedUrl: string): boolean => {
  let actual: URL;
  let expected: URL;
  try {
    actual = new URL(candidate);
    expected = new URL(trustedUrl);
  } catch {
    return false;
  }
  if (expected.protocol === "file:") {
    actual.hash = "";
    expected.hash = "";
    return actual.href === expected.href;
  }
  return actual.protocol === "http:" && actual.origin === expected.origin && actual.pathname === expected.pathname;
};

export const assertTrustedRendererClaim = (claim: {
  hasMainWindow: boolean;
  senderMatchesMainWindow: boolean;
  senderFrameIsMainFrame: boolean;
  senderFrameUrl: string;
  trustedUrl: string;
}): void => {
  if (
    !claim.hasMainWindow ||
    !claim.senderMatchesMainWindow ||
    !claim.senderFrameIsMainFrame ||
    !isTrustedRendererFrameUrl(claim.senderFrameUrl, claim.trustedUrl)
  ) {
    throw new Error("Rejected IPC from an untrusted renderer frame.");
  }
};
