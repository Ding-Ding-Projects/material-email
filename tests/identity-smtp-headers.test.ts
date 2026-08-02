import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { SMTPServer } from "smtp-server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MailService, type RuntimeAccount } from "../src/main/mail-service";
import { buildIdentity, type MailIdentity, type MailIdentityInput } from "../src/shared/identities";

/**
 * These assertions read the bytes the local SMTP server received, not the object handed to
 * nodemailer, because the header text is the only place an identity actually becomes mail. No mail
 * server here verifies that the sender owns the identity's address; this is header composition
 * evidence, not interoperability or authentication evidence.
 */
describe("identity SMTP headers", () => {
  let server: SMTPServer | undefined;
  let port = 0;
  let received: { source: string; envelopeFrom?: string; envelopeTo: string[] }[] = [];

  beforeEach(async () => {
    received = [];
    server = new SMTPServer({
      banner: "Material Email identity header fixture",
      closeTimeout: 100,
      authOptional: false,
      disabledCommands: ["STARTTLS"],
      onAuth(auth, _session, callback) {
        if (auth.username === "demo@example.test" && auth.password === "correct horse battery staple") {
          callback(null, { user: auth.username });
        } else callback(new Error("Invalid fixture credentials"));
      },
      onData(stream, session, callback) {
        const chunks: Buffer[] = [];
        stream.on("data", chunk => chunks.push(Buffer.from(chunk)));
        stream.on("end", () => {
          received.push({
            source: Buffer.concat(chunks).toString("utf8"),
            ...(session.envelope.mailFrom ? { envelopeFrom: session.envelope.mailFrom.address } : {}),
            envelopeTo: session.envelope.rcptTo.map(item => item.address),
          });
          callback(null, "Queued in the local fixture");
        });
      },
    });
    server.listen(0, "127.0.0.1");
    await once(server.server, "listening");
    port = (server.server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>(resolve => server?.close(resolve));
    server = undefined;
  });

  const account = (): RuntimeAccount => ({
    id: "identity-header-test",
    displayName: "Demo User",
    email: "demo@example.test",
    incoming: { host: "127.0.0.1", port: 1, security: "plain", username: "demo@example.test" },
    outgoing: { host: "127.0.0.1", port, security: "plain", username: "demo@example.test" },
    authMode: "password",
    kind: "imap",
    createdAt: "2026-08-02T00:00:00.000Z",
    secret: "correct horse battery staple",
  });

  /** Built through the real model so normalization is exercised rather than hand-written around. */
  const identity = (overrides: Partial<MailIdentityInput> = {}): MailIdentity => {
    const built = buildIdentity([], {
      accountId: "identity-header-test",
      displayName: "Mat Day",
      email: "mat@example.test",
      ...overrides,
    }, () => "identity-1");
    return built[0] as MailIdentity;
  };

  const send = async (chosen: MailIdentity | null, subject: string): Promise<void> => {
    await new MailService().sendMessage(
      account(),
      {
        accountId: "identity-header-test",
        to: ["friend@example.test"],
        cc: [],
        bcc: [],
        subject,
        text: "Header composition fixture.",
        attachments: [],
      },
      chosen,
    );
  };

  /**
   * Unfolds the header block, so a value continued onto an indented line stays part of its own
   * header instead of being counted as a separate one — the difference between a folded name and a
   * genuinely injected header.
   */
  const headers = (source: string): { name: string; value: string }[] => {
    const block = source.split(/\r?\n\r?\n/u)[0] ?? "";
    const lines: string[] = [];
    for (const line of block.split(/\r?\n/u)) {
      if (/^[ \t]/u.test(line) && lines.length) lines[lines.length - 1] += line.replace(/^[ \t]+/u, " ");
      else lines.push(line);
    }
    return lines
      .filter(line => line.includes(":"))
      .map(line => ({
        name: line.slice(0, line.indexOf(":")).trim().toLocaleLowerCase("en-US"),
        value: line.slice(line.indexOf(":") + 1).trim(),
      }));
  };

  const headerValues = (source: string, name: string): string[] =>
    headers(source).filter(header => header.name === name).map(header => header.value);

  it("keeps the account's own name and address in From when no identity is chosen", async () => {
    await send(null, "No identity");
    expect(received).toHaveLength(1);
    expect(headerValues(received[0]?.source ?? "", "from")).toEqual(["Demo User <demo@example.test>"]);
    expect(headerValues(received[0]?.source ?? "", "reply-to")).toEqual([]);
    expect(received[0]?.envelopeFrom).toBe("demo@example.test");
  });

  it("writes the identity's display name and address into From", async () => {
    await send(identity({ displayName: "Mat (Work)", email: "work@example.test" }), "With identity");
    expect(headerValues(received[0]?.source ?? "", "from")).toEqual(['"Mat (Work)" <work@example.test>']);
    // The envelope sender follows the From address, so the identity reaches the transaction too.
    expect(received[0]?.envelopeFrom).toBe("work@example.test");
  });

  it("writes Reply-To only when it differs from the identity's own address", async () => {
    await send(identity({ replyTo: "" }), "Empty reply-to");
    await send(identity({ replyTo: "MAT@example.test" }), "Same reply-to");
    await send(identity({ replyTo: "desk@example.test" }), "Different reply-to");

    expect(received.map(item => item.source).map(source => headerValues(source, "reply-to"))).toEqual([
      [],
      [],
      ["Mat Day <desk@example.test>"],
    ]);
  });

  const expectNoInjectedHeader = (index: number): void => {
    const source = received[index]?.source ?? "";
    const names = headers(source).map(header => header.name);
    expect(names).not.toContain("bcc");
    expect(names.filter(name => name === "from")).toHaveLength(1);
    expect(names.filter(name => name === "to")).toHaveLength(1);
    expect(headerValues(source, "to")).toEqual(["friend@example.test"]);
    expect(received[index]?.envelopeTo).toEqual(["friend@example.test"]);
  };

  it("cannot inject a header through a display name that arrived with a newline", async () => {
    // The model is the first defence: the newline folds to a space before the name is ever stored.
    const folded = identity({ displayName: "Mat Day\nBcc: attacker@example.test" });
    expect(folded.displayName).toBe("Mat Day Bcc: attacker@example.test");
    await send(folded, "Folded name");
    expect(headerValues(received[0]?.source ?? "", "from")).toEqual(['"Mat Day Bcc: attacker@example.test" <mat@example.test>']);
    expectNoInjectedHeader(0);

    // The MIME encoder is a second, independent defence, so the wire assertions above are not on
    // their own evidence that the model normalized anything. Sending a name that still carries a
    // raw newline is what proves the encoded-word encoding, not a header break, is what results.
    await send({ ...folded, displayName: "Mat Day\nBcc: attacker@example.test" }, "Raw newline");
    expectNoInjectedHeader(1);
  });
});
