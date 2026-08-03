import { describe, expect, it } from "vitest";
import { MICROSOFT_NATIVE_CLIENT_REDIRECT_URI, OAuthProviderConfigError, resolveMicrosoftOAuthConfig } from "../src/main/oauth-provider-config";

describe("Microsoft OAuth provider configuration", () => {
  it("returns null when no client ID is present, leaving sign-in disabled by default", () => {
    expect(resolveMicrosoftOAuthConfig({})).toBeNull();
    expect(resolveMicrosoftOAuthConfig({ MATERIAL_EMAIL_MICROSOFT_CLIENT_ID: "" })).toBeNull();
    expect(resolveMicrosoftOAuthConfig({ MATERIAL_EMAIL_MICROSOFT_CLIENT_ID: "   " })).toBeNull();
  });

  it("resolves a real configuration from a client ID alone, defaulting the tenant to common and the redirect to Microsoft's own sentinel", () => {
    const config = resolveMicrosoftOAuthConfig({ MATERIAL_EMAIL_MICROSOFT_CLIENT_ID: "12345678-90ab-cdef-1234-567890abcdef" });
    expect(config).toEqual({
      provider: "microsoft",
      clientId: "12345678-90ab-cdef-1234-567890abcdef",
      authorizationEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      tokenEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      scopes: ["https://outlook.office.com/IMAP.AccessAsUser.All", "https://outlook.office.com/SMTP.Send", "offline_access"],
      redirectUri: MICROSOFT_NATIVE_CLIENT_REDIRECT_URI,
    });
  });

  it("honours an explicit tenant", () => {
    const config = resolveMicrosoftOAuthConfig({
      MATERIAL_EMAIL_MICROSOFT_CLIENT_ID: "client-1",
      MATERIAL_EMAIL_MICROSOFT_TENANT: "organizations",
    });
    expect(config?.authorizationEndpoint).toBe("https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize");
  });

  it("honours an explicit redirect URI, for someone who has registered their own stable HTTPS page instead of the default sentinel", () => {
    const config = resolveMicrosoftOAuthConfig({
      MATERIAL_EMAIL_MICROSOFT_CLIENT_ID: "client-1",
      MATERIAL_EMAIL_MICROSOFT_REDIRECT_URI: "https://mail-oauth.example.test/redirect",
    });
    expect(config?.redirectUri).toBe("https://mail-oauth.example.test/redirect");
  });

  it("throws a clear error rather than silently accepting a malformed redirect URI", () => {
    expect(() => resolveMicrosoftOAuthConfig({
      MATERIAL_EMAIL_MICROSOFT_CLIENT_ID: "client-1",
      MATERIAL_EMAIL_MICROSOFT_REDIRECT_URI: "http://not-https.example.test/redirect",
    })).toThrow(OAuthProviderConfigError);
    expect(() => resolveMicrosoftOAuthConfig({
      MATERIAL_EMAIL_MICROSOFT_CLIENT_ID: "client-1",
      MATERIAL_EMAIL_MICROSOFT_REDIRECT_URI: "https://example.test/redirect?with=query",
    })).toThrow(OAuthProviderConfigError);
    expect(() => resolveMicrosoftOAuthConfig({
      MATERIAL_EMAIL_MICROSOFT_CLIENT_ID: "client-1",
      MATERIAL_EMAIL_MICROSOFT_REDIRECT_URI: "not a url",
    })).toThrow(OAuthProviderConfigError);
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
