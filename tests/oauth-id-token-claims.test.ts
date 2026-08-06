import { describe, expect, it } from "vitest";
import { decodeOAuthIdTokenAccountHint } from "../src/main/oauth-id-token-claims";

const fakeIdToken = (claims: Record<string, unknown>): string => {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" }), "utf8").toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${header}.${payload}.signature`;
};

describe("decodeOAuthIdTokenAccountHint", () => {
  it("decodes email and name without checking the signature segment", () => {
    expect(decodeOAuthIdTokenAccountHint(fakeIdToken({ email: "alex@example.test", name: "Alex Wong" })))
      .toEqual({ email: "alex@example.test", displayName: "Alex Wong" });
  });

  it("falls back to preferred_username when email is absent", () => {
    expect(decodeOAuthIdTokenAccountHint(fakeIdToken({ preferred_username: "alex@example.test" })))
      .toEqual({ email: "alex@example.test", displayName: null });
  });

  it("prefers email over preferred_username when both are present", () => {
    expect(decodeOAuthIdTokenAccountHint(fakeIdToken({ email: "email-claim@example.test", preferred_username: "upn-claim@example.test" })))
      .toEqual({ email: "email-claim@example.test", displayName: null });
  });

  it("returns null for a non-string input", () => {
    // @ts-expect-error deliberately testing a wrong-typed input
    expect(decodeOAuthIdTokenAccountHint(undefined)).toBeNull();
    expect(decodeOAuthIdTokenAccountHint("")).toBeNull();
  });

  it("returns null for a string that is not JWT-shaped", () => {
    expect(decodeOAuthIdTokenAccountHint("not-a-jwt")).toBeNull();
    expect(decodeOAuthIdTokenAccountHint("one.two")).toBeNull();
    expect(decodeOAuthIdTokenAccountHint("one.two.three.four")).toBeNull();
  });

  it("returns null for a payload segment that is not valid base64url JSON", () => {
    expect(decodeOAuthIdTokenAccountHint("header.not-valid-base64url-json!!!.signature")).toBeNull();
  });

  it("returns null for a payload whose JSON is not an object", () => {
    const payload = Buffer.from(JSON.stringify(["not", "an", "object"]), "utf8").toString("base64url");
    expect(decodeOAuthIdTokenAccountHint(`header.${payload}.signature`)).toBeNull();
  });

  it("returns null when neither claim is present", () => {
    expect(decodeOAuthIdTokenAccountHint(fakeIdToken({ sub: "user-id", aud: "client-1" }))).toBeNull();
  });

  it("returns null for a token over the bounded length", () => {
    expect(decodeOAuthIdTokenAccountHint("a".repeat(20_000))).toBeNull();
  });

  it("ignores an oversized claim value rather than returning it truncated", () => {
    const result = decodeOAuthIdTokenAccountHint(fakeIdToken({ email: "a".repeat(400) + "@example.test", name: "Alex Wong" }));
    expect(result).toEqual({ email: null, displayName: "Alex Wong" });
  });

  it("ignores a claim value carrying a control character", () => {
    const result = decodeOAuthIdTokenAccountHint(fakeIdToken({ email: "alex@example.test", name: "Alex\nWong" }));
    expect(result).toEqual({ email: "alex@example.test", displayName: null });
  });

  it("ignores a non-string claim value", () => {
    const result = decodeOAuthIdTokenAccountHint(fakeIdToken({ email: 12345, name: "Alex Wong" }));
    expect(result).toEqual({ email: null, displayName: "Alex Wong" });
  });
});
