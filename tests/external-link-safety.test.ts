import { describe, expect, it } from "vitest";
import { assessExternalLink } from "../src/shared/external-link-safety";

describe("external link safety", () => {
  it("accepts ordinary HTTPS", () => expect(assessExternalLink("https://example.com/help").risk).toBe("ordinary"));
  it("flags HTTP, credentials, ports, IPs, and punycode", () => {
    expect(assessExternalLink("http://user:pass@127.0.0.1:8080/a").reasons).toEqual(expect.arrayContaining(["http", "credentials", "ip-literal", "non-default-port"]));
    expect(assessExternalLink("https://xn--e1afmkfd.xn--p1ai").reasons).toContain("punycode");
  });
  it("rejects malformed and control-character URLs", () => {
    expect(assessExternalLink("not a url").risk).toBe("dangerous");
    expect(assessExternalLink("https://example.com/\u202eexe").reasons).toContain("bidi-control");
  });
  it("flags visible host text that differs from the destination", () => {
    expect(assessExternalLink("https://accounts.example.com/login", "https://example.com").reasons).toContain("visible-host-mismatch");
  });
});
