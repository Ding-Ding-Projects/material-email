import { describe, expect, it } from "vitest";
import { parseMessageSource, sanitizeMessageContent, sanitizeMessageHtml } from "../src/main/mail-service";

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

  it("keeps a separate bounded remote-image variant and a factual origin summary", () => {
    const content = sanitizeMessageContent(`
      <p>Newsletter</p>
      <img src="https://media.example.test/news.png?message=42" alt="News" onerror="steal()" srcset="https://tracker.example.test/2x.png 2x">
      <img src="http://tracker.example.test:8080/pixel.gif" alt="Tracker">
      <img src="https://user:secret@private.example.test/pixel.gif" alt="Credential URL">
      <img src="//protocol-relative.example.test/pixel.gif" alt="Relative URL">
      <iframe src="https://frames.example.test/"></iframe>
      <script>steal()</script>
    `);

    expect(content.html).not.toContain("<img");
    expect(content.remoteContentHtml).toContain('src="https://media.example.test/news.png?message=42"');
    expect(content.remoteContentHtml).toContain('src="http://tracker.example.test:8080/pixel.gif"');
    expect(content.remoteContentHtml).toContain('referrerpolicy="no-referrer"');
    expect(content.remoteContentHtml).not.toMatch(/onerror|srcset|iframe|script|user:secret|protocol-relative/i);
    expect(content.remoteContentSources).toEqual([
      { kind: "image", origin: "https://media.example.test", hostname: "media.example.test", protocol: "https:" },
      { kind: "image", origin: "http://tracker.example.test:8080", hostname: "tracker.example.test", protocol: "http:" },
    ]);
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
    expect(parsed.remoteContentAllowed).toBe(false);
    expect(parsed.remoteContentSources).toEqual([]);
    expect(parsed.attachments).toEqual([
      expect.objectContaining({ filename: "notes.txt", contentType: "text/plain", size: 5 }),
    ]);
  });
});
