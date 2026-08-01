import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertTrustedRendererClaim,
  isTrustedRendererFrameUrl,
  parseLoopbackDevelopmentUrl,
  resolveRendererLoadTarget,
} from "../src/main/renderer-trust";

describe("trusted renderer boundary", () => {
  const rendererPath = "C:\\Program Files\\Material Email\\resources\\app.asar\\dist\\renderer\\index.html";

  it("ignores the development URL in packaged builds and trusts only the bundled entry file", () => {
    const target = resolveRendererLoadTarget({
      isPackaged: true,
      rendererPath,
      developmentUrl: "https://attacker.example/renderer",
    });

    expect(target).toEqual({ kind: "file", filePath: rendererPath, trustedUrl: pathToFileURL(rendererPath).href });
    expect(isTrustedRendererFrameUrl(`${target.trustedUrl}#main-content`, target.trustedUrl)).toBe(true);
    expect(isTrustedRendererFrameUrl(`${target.trustedUrl}?other-file-state=1`, target.trustedUrl)).toBe(false);
    expect(isTrustedRendererFrameUrl("https://attacker.example/renderer", target.trustedUrl)).toBe(false);
  });

  it("accepts only explicit IP loopback HTTP development URLs", () => {
    expect(parseLoopbackDevelopmentUrl("http://127.0.0.1:5173")).toBe("http://127.0.0.1:5173/");
    expect(parseLoopbackDevelopmentUrl("http://[::1]:5173/app")).toBe("http://[::1]:5173/app");
    for (const candidate of [
      "https://127.0.0.1:5173/",
      "http://localhost:5173/",
      "http://0.0.0.0:5173/",
      "http://192.168.1.10:5173/",
      "http://user:password@127.0.0.1:5173/",
      "http://127.0.0.1:5173/?redirect=https://attacker.example",
      "not-a-url",
    ]) {
      expect(() => parseLoopbackDevelopmentUrl(candidate), candidate).toThrow(/loopback|127\.0\.0\.1/u);
    }
  });

  it("requires the configured loopback origin and path exactly", () => {
    const trusted = "http://127.0.0.1:5173/material-email/";
    expect(isTrustedRendererFrameUrl(trusted, trusted)).toBe(true);
    expect(isTrustedRendererFrameUrl(`${trusted}?vite=1`, trusted)).toBe(true);
    expect(isTrustedRendererFrameUrl("http://127.0.0.1:5174/material-email/", trusted)).toBe(false);
    expect(isTrustedRendererFrameUrl("http://127.0.0.1:5173/", trusted)).toBe(false);
    expect(isTrustedRendererFrameUrl("about:srcdoc", trusted)).toBe(false);
  });

  it("rejects child frames and other WebContents even when their URL looks trusted", () => {
    const trustedUrl = "http://127.0.0.1:5173/";
    const trustedClaim = {
      hasMainWindow: true,
      senderMatchesMainWindow: true,
      senderFrameIsMainFrame: true,
      senderFrameUrl: trustedUrl,
      trustedUrl,
    };
    expect(() => assertTrustedRendererClaim(trustedClaim)).not.toThrow();
    expect(() => assertTrustedRendererClaim({ ...trustedClaim, senderMatchesMainWindow: false })).toThrow(/untrusted renderer frame/u);
    expect(() => assertTrustedRendererClaim({ ...trustedClaim, senderFrameIsMainFrame: false })).toThrow(/untrusted renderer frame/u);
    expect(() => assertTrustedRendererClaim({ ...trustedClaim, senderFrameUrl: "about:srcdoc" })).toThrow(/untrusted renderer frame/u);
    expect(() => assertTrustedRendererClaim({ ...trustedClaim, hasMainWindow: false })).toThrow(/untrusted renderer frame/u);
  });
});
