import { describe, expect, it } from "vitest";
import { discoverSrvConfiguration } from "../src/main/account-discovery";

describe("provider DNS mail-service discovery", () => {
  it("maps the preferred secure IMAP and submission SRV records", () => {
    expect(
      discoverSrvConfiguration(
        "User@Example.test",
        [
          { name: "backup.example.test.", port: 993, priority: 20, weight: 100 },
          { name: "imap.example.test.", port: 993, priority: 10, weight: 50 },
        ],
        [
          { name: "smtp-low-weight.example.test.", port: 587, priority: 10, weight: 1 },
          { name: "smtp.example.test.", port: 587, priority: 10, weight: 20 },
        ],
      ),
    ).toEqual({
      source: "dns-srv",
      displayName: "user",
      email: "user@example.test",
      incoming: { host: "imap.example.test", port: 993, security: "tls", username: "user@example.test" },
      outgoing: { host: "smtp.example.test", port: 587, security: "starttls", username: "user@example.test" },
      authModes: ["password"],
    });
  });

  it("uses implicit TLS for submission port 465", () => {
    const result = discoverSrvConfiguration(
      "user@example.test",
      [{ name: "imap.example.test", port: 993, priority: 0, weight: 0 }],
      [{ name: "smtp.example.test", port: 465, priority: 0, weight: 0 }],
    );
    expect(result?.outgoing.security).toBe("tls");
  });

  it("requires both incoming and outgoing service records", () => {
    expect(discoverSrvConfiguration("user@example.test", [], [])).toBeNull();
  });
});
