import { describe, expect, it } from "vitest";
import { userVisibleErrorLimits, userVisibleErrorMessage } from "../src/shared/user-visible-error";

describe("user-visible error redaction", () => {
  it("keeps bounded app-authored guidance while removing the Electron IPC wrapper", () => {
    expect(userVisibleErrorMessage(new Error("Error invoking remote method 'history:list-local': Error: Preview local history again.")))
      .toBe("Preview local history again.");
  });

  it("does not echo host paths, URLs, query values, implementation names, stacks, or oversized detail", () => {
    const leaks = [
      String.raw`Could not read C:\Users\private-user\mail\state.json`,
      "Provider returned https://mail.example.test/auth?token=private-token",
      "query=private-search-text failed inside ImapFlow",
      "Failure at async Queue.run (C:\\private\\queue.ts:12:4)",
      "x".repeat(userVisibleErrorLimits.message + 1),
    ];
    for (const leak of leaks) {
      const visible = userVisibleErrorMessage(new Error(leak));
      expect(visible).toBe("The operation could not complete. Review the current settings and try again.");
      expect(visible).not.toContain("private");
    }
  });

  it("maps mail failures to actionable categories without echoing transport details", () => {
    const refused = Object.assign(new Error(String.raw`connect ECONNREFUSED 127.0.0.1:2525 C:\Users\private\mail.eml`), { code: "ECONNREFUSED" });
    expect(userVisibleErrorMessage(refused, { context: "mail" }))
      .toBe("The server refused the connection. Check the server address, port, security mode, and network, then retry.");
    expect(userVisibleErrorMessage(new Error("535 authentication failed for smtp.example.test"), { context: "mail" }))
      .toBe("The server rejected the account sign-in. Check the credential or provider authorization, then retry.");
    expect(userVisibleErrorMessage(new Error("provider adapter private-debug-detail"), { context: "mail" }))
      .toBe("The mail server operation could not complete. Check the account server settings and network, then retry.");
  });

  it("does not repeat invalid regular-expression text in a separate error surface", () => {
    expect(userVisibleErrorMessage(new Error("Invalid regular expression: /private-search/: Unterminated group")))
      .toBe("The search could not complete. Review the search settings and try again.");
  });
});
