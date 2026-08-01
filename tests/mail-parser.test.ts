import { describe, expect, it } from "vitest";
import { parseMessageSource, sanitizeMessageContent, sanitizeMessageHtml } from "../src/main/mail-service";
import { MIME_SAFETY_LIMITS, MimeSafetyError } from "../src/main/mime-safety";

const capturedMimeError = async (operation: Promise<unknown>): Promise<MimeSafetyError> => {
  let captured: unknown;
  try {
    await operation;
  } catch (error) {
    captured = error;
  }
  expect(captured).toBeInstanceOf(MimeSafetyError);
  return captured as MimeSafetyError;
};

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

  it("rejects raw MIME above the byte ceiling before parsing and keeps retry guidance stable", async () => {
    const error = await capturedMimeError(parseMessageSource(
      "account",
      "Inbox",
      43,
      Buffer.alloc(MIME_SAFETY_LIMITS.sourceBytes + 1, 0x61),
    ));

    expect(error.code).toBe("MIME_SOURCE_TOO_LARGE");
    expect(error.message).toContain("32.0 MiB raw MIME parsing limit");
    expect(error.message).toContain("left unopened and unchanged");
    expect(error.message).toContain("select it again to retry");
  });

  it.each([
    {
      name: "an overlong physical header line",
      source: `X-Adversarial: ${"a".repeat(MIME_SAFETY_LIMITS.headerLineBytes)}\r\n\r\nbody`,
      code: "MIME_HEADER_LINE_TOO_LONG",
    },
    {
      name: "an oversized header block",
      source: `${"X-A: one\r\n".repeat(Math.ceil(MIME_SAFETY_LIMITS.headerBytes / 10))}\r\nbody`,
      code: "MIME_HEADERS_TOO_LARGE",
    },
    {
      name: "a NUL byte in the header block",
      source: Buffer.from("Subject: broken\0header\r\n\r\nbody"),
      code: "MIME_HEADERS_MALFORMED",
    },
  ])("fails closed on $name without exposing parser internals", async ({ source, code }) => {
    const error = await capturedMimeError(parseMessageSource("account", "Inbox", 44, source));

    expect(error.code).toBe(code);
    expect(error.message).toContain("left unopened and unchanged");
    expect(error.message).not.toMatch(/mailparser|stack|node_modules/iu);
  });

  it("bounds the decoded text body independently of raw source bytes", async () => {
    const source = [
      "From: sender@example.test",
      "Subject: Too much decoded text",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "x".repeat(MIME_SAFETY_LIMITS.textCharacters + 1),
    ].join("\r\n");

    const error = await capturedMimeError(parseMessageSource("account", "Inbox", 45, source));
    expect(error.code).toBe("MIME_TEXT_TOO_LARGE");
    expect(error.message).toContain("2.0 MiB safety limit");
  });

  it("bounds a decoded HTML alternative before sanitization", async () => {
    const source = [
      "From: sender@example.test",
      "Subject: Too much decoded HTML",
      "MIME-Version: 1.0",
      'Content-Type: multipart/alternative; boundary="body-limit"',
      "",
      "--body-limit",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Small fallback",
      "--body-limit",
      "Content-Type: text/html; charset=utf-8",
      "",
      `<p>${"x".repeat(MIME_SAFETY_LIMITS.htmlCharacters + 1)}</p>`,
      "--body-limit--",
    ].join("\r\n");

    const error = await capturedMimeError(parseMessageSource("account", "Inbox", 48, source));
    expect(error.code).toBe("MIME_HTML_TOO_LARGE");
    expect(error.message).toContain("4.0 MiB safety limit");
  });

  it("bounds MIME attachment fan-out even when every part is tiny", async () => {
    const parts = Array.from({ length: MIME_SAFETY_LIMITS.attachmentCount + 1 }, (_, index) => [
      "--many",
      "Content-Type: application/octet-stream",
      `Content-Disposition: attachment; filename=\"tiny-${index}.bin\"`,
      "Content-Transfer-Encoding: base64",
      "",
      "eA==",
    ].join("\r\n"));
    const source = [
      "From: sender@example.test",
      "Subject: Tiny attachment stampede",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="many"',
      "",
      ...parts,
      "--many--",
    ].join("\r\n");

    const error = await capturedMimeError(parseMessageSource("account", "Inbox", 46, source));
    expect(error.code).toBe("MIME_TOO_MANY_ATTACHMENTS");
    expect(error.message).toContain("more than 100 MIME attachments");
  });

  it("handles an unterminated multipart safely and still applies the HTML boundary", async () => {
    const source = [
      "From: sender@example.test",
      "Subject: Unterminated multipart",
      "MIME-Version: 1.0",
      'Content-Type: multipart/alternative; boundary="broken"',
      "",
      "--broken",
      "Content-Type: text/html; charset=utf-8",
      "",
      '<p>Still readable</p><script>steal()</script><img src="https://tracker.example.test/open.gif" onerror="steal()">',
    ].join("\r\n");

    const parsed = await parseMessageSource("account", "Inbox", 47, source);
    expect(parsed.html).toContain("Still readable");
    expect(parsed.html).not.toMatch(/script|img|onerror/iu);
    expect(parsed.remoteContentHtml).not.toMatch(/script|onerror/iu);
    expect(parsed.remoteContentSources).toEqual([
      { kind: "image", origin: "https://tracker.example.test", hostname: "tracker.example.test", protocol: "https:" },
    ]);
  });
});
