import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { SMTPServer } from "smtp-server";
import { afterEach, describe, expect, it } from "vitest";
import { MailService, type RuntimeAccount } from "../src/main/mail-service";

describe("SMTP integration", () => {
  let server: SMTPServer | undefined;

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>(resolve => server?.close(resolve));
    server = undefined;
  });

  it("authenticates, submits the envelope, and transfers a MIME message", async () => {
    let source = "";
    let envelope: { from?: string; to?: string[] } = {};
    server = new SMTPServer({
      banner: "Material Email test fixture",
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
          source = Buffer.concat(chunks).toString("utf8");
          envelope = {
            ...(session.envelope.mailFrom ? { from: session.envelope.mailFrom.address } : {}),
            to: session.envelope.rcptTo.map(item => item.address),
          };
          callback(null, "Queued in the local fixture");
        });
      },
    });
    server.listen(0, "127.0.0.1");
    await once(server.server, "listening");
    const port = (server.server.address() as AddressInfo).port;

    const account: RuntimeAccount = {
      id: "smtp-test",
      displayName: "Demo User",
      email: "demo@example.test",
      incoming: { host: "127.0.0.1", port: 1, security: "plain", username: "demo@example.test" },
      outgoing: { host: "127.0.0.1", port, security: "plain", username: "demo@example.test" },
      authMode: "password",
      kind: "imap",
      createdAt: new Date().toISOString(),
      secret: "correct horse battery staple",
    };

    const result = await new MailService().sendMessage(account, {
      accountId: account.id,
      to: ["friend@example.test"],
      cc: [],
      bcc: [],
      subject: "SMTP round trip",
      text: "This message crossed a real local SMTP socket.",
      attachments: [],
    });

    expect(result.queued).toBe(false);
    expect(result.accepted).toEqual(["friend@example.test"]);
    expect(result.rejected).toEqual([]);
    expect(envelope).toEqual({ from: "demo@example.test", to: ["friend@example.test"] });
    expect(source).toContain("Subject: SMTP round trip");
    expect(source).toContain("This message crossed a real local SMTP socket.");
  });

  it("returns exact permanent all-recipient rejection instead of queuing it as a transport outage", async () => {
    server = new SMTPServer({
      banner: "Material Email rejection fixture",
      closeTimeout: 100,
      authOptional: true,
      disabledCommands: ["STARTTLS"],
      onAuth(auth, _session, callback) {
        callback(null, { user: auth.username });
      },
      onRcptTo(_address, _session, callback) {
        callback(Object.assign(new Error("Permanent fixture rejection"), { responseCode: 550 }));
      },
    });
    server.listen(0, "127.0.0.1");
    await once(server.server, "listening");
    const port = (server.server.address() as AddressInfo).port;
    const account: RuntimeAccount = {
      id: "smtp-rejection-test",
      displayName: "Demo User",
      email: "demo@example.test",
      incoming: { host: "127.0.0.1", port: 1, security: "plain", username: "demo@example.test" },
      outgoing: { host: "127.0.0.1", port, security: "plain", username: "demo@example.test" },
      authMode: "password",
      kind: "imap",
      createdAt: "2026-07-31T00:00:00.000Z",
      secret: "unused",
    };

    await expect(
      new MailService().sendMessage(account, {
        accountId: account.id,
        to: ["first-rejected@example.test", "second-rejected@example.test"],
        cc: [],
        bcc: [],
        subject: "Permanent rejection",
        text: "This must remain a draft.",
        attachments: [],
      }),
    ).resolves.toMatchObject({
      accepted: [],
      rejected: ["first-rejected@example.test", "second-rejected@example.test"],
      queued: false,
    });
  });

  it("keeps temporary all-recipient rejection as a retryable transport error", async () => {
    server = new SMTPServer({
      banner: "Material Email temporary rejection fixture",
      closeTimeout: 100,
      authOptional: true,
      disabledCommands: ["STARTTLS"],
      onAuth(auth, _session, callback) {
        callback(null, { user: auth.username });
      },
      onRcptTo(_address, _session, callback) {
        callback(Object.assign(new Error("Temporary fixture rejection"), { responseCode: 450 }));
      },
    });
    server.listen(0, "127.0.0.1");
    await once(server.server, "listening");
    const port = (server.server.address() as AddressInfo).port;
    const account: RuntimeAccount = {
      id: "smtp-temporary-test",
      displayName: "Demo User",
      email: "demo@example.test",
      incoming: { host: "127.0.0.1", port: 1, security: "plain", username: "demo@example.test" },
      outgoing: { host: "127.0.0.1", port, security: "plain", username: "demo@example.test" },
      authMode: "password",
      kind: "imap",
      createdAt: "2026-07-31T00:00:00.000Z",
      secret: "unused",
    };

    await expect(
      new MailService().sendMessage(account, {
        accountId: account.id,
        to: ["retry@example.test"],
        cc: [],
        bcc: [],
        subject: "Temporary rejection",
        text: "This may retry.",
        attachments: [],
      }),
    ).rejects.toMatchObject({ code: "EENVELOPE", responseCode: 450 });
  });
});
