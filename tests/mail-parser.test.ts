import { describe, expect, it } from "vitest";
import { parseMessageSource, sanitizeMessageHtml } from "../src/main/mail-service";

describe("mail content boundary", () => {
  it("removes active and remote content while keeping safe message structure", () => {
    const output = sanitizeMessageHtml(`
      <style>body{display:none}</style>
      <script>alert('no')</script>
      <img src="https://tracker.example/pixel.gif" onerror="steal()">
      <p onclick="steal()">Hello <strong>world</strong>.</p>
      <a href="javascript:steal()">bad</a>
      <a href="mailto:friend@example.test" title="Write">safe</a>
    `);

    expect(output).not.toMatch(/script|style|img|onclick|javascript/i);
    expect(output).toContain("<strong>world</strong>");
    expect(output).toContain('href="mailto:friend@example.test"');
  });

  it("parses MIME headers, flags, text, and attachment metadata", async () => {
    const source = [
      "From: Nadia Chan <nadia@example.test>",
      "To: Demo User <demo@example.test>",
      "Subject: MIME fixture",
      "Message-ID: <fixture@example.test>",
      "Date: Fri, 31 Jul 2026 12:30:00 -0400",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="fixture"',
      "",
      "--fixture",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<p>Hello <b>mail</b>.</p><script>bad()</script>",
      "--fixture",
      'Content-Type: text/plain; name="notes.txt"',
      "Content-Disposition: attachment; filename=notes.txt",
      "Content-Transfer-Encoding: base64",
      "",
      "bm90ZXM=",
      "--fixture--",
    ].join("\r\n");

    const parsed = await parseMessageSource("account", "Inbox", 42, source, new Set(["\\Seen", "\\Flagged"]));

    expect(parsed.subject).toBe("MIME fixture");
    expect(parsed.from[0]).toEqual({ name: "Nadia Chan", address: "nadia@example.test" });
    expect(parsed.unread).toBe(false);
    expect(parsed.starred).toBe(true);
    expect(parsed.html).toContain("<b>mail</b>");
    expect(parsed.html).not.toContain("script");
    expect(parsed.attachments).toEqual([
      expect.objectContaining({ filename: "notes.txt", contentType: "text/plain", size: 5 }),
    ]);
  });
});

