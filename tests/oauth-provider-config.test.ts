import { describe, expect, it } from "vitest";
import { OAuthProviderConfigError, resolveMicrosoftOAuthConfig } from "../src/main/oauth-provider-config";

describe("Microsoft OAuth provider configuration", () => {
  it("returns null when no client ID is present, leaving sign-in disabled by default", () => {
    expect(resolveMicrosoftOAuthConfig({})).toBeNull();
    expect(resolveMicrosoftOAuthConfig({ MATERIAL_EMAIL_MICROSOFT_CLIENT_ID: "" })).toBeNull();
    expect(resolveMicrosoftOAuthConfig({ MATERIAL_EMAIL_MICROSOFT_CLIENT_ID: "   " })).toBeNull();
  });

  it("resolves a real configuration from a client ID alone, defaulting the tenant to common", () => {
    const config = resolveMicrosoftOAuthConfig({ MATERIAL_EMAIL_MICROSOFT_CLIENT_ID: "12345678-90ab-cdef-1234-567890abcdef" });
    expect(config).toEqual({
      provider: "microsoft",
      clientId: "12345678-90ab-cdef-1234-567890abcdef",
      authorizationEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      tokenEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      scopes: ["https://outlook.office.com/IMAP.AccessAsUser.All", "https://outlook.office.com/SMTP.Send", "offline_access"],
    });
  });

  it("honours an explicit tenant", () => {
    const config = resolveMicrosoftOAuthConfig({
      MATERIAL_EMAIL_MICROSOFT_CLIENT_ID: "client-1",
      MATERIAL_EMAIL_MICROSOFT_TENANT: "organizations",
    });
    expect(config?.authorizationEndpoint).toBe("https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize");
  });

  it("throws a clear error rather than silently accepting a malformed client ID", () => {
    expect(() => resolveMicrosoftOAuthConfig({ MATERIAL_EMAIL_MICROSOFT_CLIENT_ID: "has a space" })).toThrow(OAuthProviderConfigError);
    expect(() => resolveMicrosoftOAuthConfig({ MATERIAL_EMAIL_MICROSOFT_CLIENT_ID: "has\nnewline" })).toThrow(OAuthProviderConfigError);
    expect(() => resolveMicrosoftOAuthConfig({ MATERIAL_EMAIL_MICROSOFT_CLIENT_ID: "a".repeat(600) })).toThrow(OAuthProviderConfigError);
  });

  it("throws a clear error rather than silently accepting a malformed tenant", () => {
    expect(() => resolveMicrosoftOAuthConfig({
      MATERIAL_EMAIL_MICROSOFT_CLIENT_ID: "client-1",
      MATERIAL_EMAIL_MICROSOFT_TENANT: "not a tenant!",
    })).toThrow(OAuthProviderConfigError);
    expect(() => resolveMicrosoftOAuthConfig({
      MATERIAL_EMAIL_MICROSOFT_CLIENT_ID: "client-1",
      MATERIAL_EMAIL_MICROSOFT_TENANT: "https://evil.example.test/",
    })).toThrow(OAuthProviderConfigError);
  });
});
