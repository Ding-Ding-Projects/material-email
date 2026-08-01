import net, { type AddressInfo, type Socket } from "node:net";

const source = [
  "From: Nadia Chan <nadia@example.test>",
  "To: Demo User <demo@example.test>",
  "Subject: IMAP socket fixture",
  "Message-ID: <imap-fixture@example.test>",
  "Date: Fri, 31 Jul 2026 12:30:00 +0000",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "This message crossed a real local IMAP socket.",
].join("\r\n");

export class ImapFixture {
  readonly commands: string[] = [];
  readonly server = net.createServer(socket => this.#connect(socket));
  #sockets = new Set<Socket>();
  #authChallengeTags = new Map<Socket, string>();
  #messageExists = true;
  #seen = false;
  #flagged = false;

  async listen(): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        this.server.off("error", reject);
        resolve();
      });
    });
    return (this.server.address() as AddressInfo).port;
  }

  async close(): Promise<void> {
    for (const socket of this.#sockets) socket.destroy();
    await new Promise<void>(resolve => this.server.close(() => resolve()));
  }

  #connect(socket: Socket): void {
    this.#sockets.add(socket);
    socket.setEncoding("utf8");
    socket.on("close", () => this.#sockets.delete(socket));
    socket.write("* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR MOVE UIDPLUS] Material Email fixture ready\r\n");
    let input = "";
    socket.on("data", chunk => {
      input += chunk;
      while (input.includes("\r\n")) {
        const index = input.indexOf("\r\n");
        const line = input.slice(0, index);
        input = input.slice(index + 2);
        if (line) this.#command(socket, line);
      }
    });
  }

  #command(socket: Socket, line: string): void {
    this.commands.push(line);
    const authTag = this.#authChallengeTags.get(socket);
    if (authTag) {
      this.#authChallengeTags.delete(socket);
      const decoded = Buffer.from(line, "base64").toString("utf8");
      if (decoded.includes("demo@example.test") && decoded.includes("fixture-password")) {
        socket.write(`${authTag} OK [CAPABILITY IMAP4rev1 MOVE UIDPLUS] Authenticated\r\n`);
      } else socket.write(`${authTag} NO Authentication failed\r\n`);
      return;
    }
    const [tag = "", command = "", ...rest] = line.split(" ");
    const upper = command.toUpperCase();
    const args = rest.join(" ");
    const ok = (label = upper) => socket.write(`${tag} OK ${label} completed\r\n`);

    if (upper === "CAPABILITY") {
      socket.write("* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR MOVE UIDPLUS\r\n");
      ok();
      return;
    }
    if (upper === "ID") {
      socket.write('* ID ("name" "Material Email fixture")\r\n');
      ok();
      return;
    }
    if (upper === "AUTHENTICATE") {
      if (rest.length === 1) {
        this.#authChallengeTags.set(socket, tag);
        socket.write("+ \r\n");
        return;
      }
      const encoded = rest.at(-1) ?? "";
      const decoded = Buffer.from(encoded, "base64").toString("utf8");
      if (decoded.includes("demo@example.test") && decoded.includes("fixture-password")) {
        socket.write(`${tag} OK [CAPABILITY IMAP4rev1 MOVE UIDPLUS] Authenticated\r\n`);
      } else socket.write(`${tag} NO Authentication failed\r\n`);
      return;
    }
    if (upper === "LOGIN") {
      if (args.includes("demo@example.test") && args.includes("fixture-password")) ok("LOGIN");
      else socket.write(`${tag} NO Authentication failed\r\n`);
      return;
    }
    if (upper === "NAMESPACE") {
      socket.write('* NAMESPACE (("" "/")) NIL NIL\r\n');
      ok();
      return;
    }
    if (upper === "LIST" || upper === "LSUB") {
      const count = this.#messageExists ? 1 : 0;
      const unseen = this.#messageExists && !this.#seen ? 1 : 0;
      socket.write('* LIST (\\HasNoChildren \\Inbox) "/" "Inbox"\r\n');
      socket.write(`* STATUS "Inbox" (MESSAGES ${count} UNSEEN ${unseen} UIDVALIDITY 777)\r\n`);
      socket.write('* LIST (\\HasNoChildren \\Sent) "/" "Sent"\r\n');
      socket.write('* STATUS "Sent" (MESSAGES 0 UNSEEN 0 UIDVALIDITY 888)\r\n');
      ok();
      return;
    }
    if (upper === "STATUS") {
      const isSent = /sent/i.test(args);
      const count = isSent || !this.#messageExists ? 0 : 1;
      const unseen = !isSent && this.#messageExists && !this.#seen ? 1 : 0;
      socket.write(`* STATUS "${isSent ? "Sent" : "Inbox"}" (MESSAGES ${count} UNSEEN ${unseen} UIDVALIDITY ${isSent ? 888 : 777})\r\n`);
      ok();
      return;
    }
    if (upper === "SELECT" || upper === "EXAMINE") {
      const exists = /sent/i.test(args) || !this.#messageExists ? 0 : 1;
      socket.write("* FLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft)\r\n");
      socket.write(`* ${exists} EXISTS\r\n`);
      socket.write(`* OK [UIDVALIDITY ${/sent/i.test(args) ? 888 : 777}] UIDs valid\r\n`);
      socket.write(`* OK [UIDNEXT ${exists + 1}] Predicted next UID\r\n`);
      socket.write("* OK [PERMANENTFLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft \\*)] Flags permitted\r\n");
      socket.write(`${tag} OK [READ-WRITE] ${upper} completed\r\n`);
      return;
    }
    if (upper === "FETCH" || (upper === "UID" && rest[0]?.toUpperCase() === "FETCH")) {
      if (!this.#messageExists) {
        ok(upper === "UID" ? "UID FETCH" : "FETCH");
        return;
      }
      const query = rest.slice(upper === "UID" ? 2 : 1).join(" ").toUpperCase();
      const flags = [this.#seen ? "\\Seen" : "", this.#flagged ? "\\Flagged" : ""].filter(Boolean).join(" ");
      if (query.includes("BODY.PEEK[]") || query.includes("BODY[]")) {
        socket.write(`* 1 FETCH (UID 1 FLAGS (${flags}) RFC822.SIZE ${Buffer.byteLength(source)} BODY[] {${Buffer.byteLength(source)}}\r\n${source})\r\n`);
      } else {
        const envelope = '("Fri, 31 Jul 2026 12:30:00 +0000" "IMAP socket fixture" (("Nadia Chan" NIL "nadia" "example.test")) NIL NIL (("Demo User" NIL "demo" "example.test")) NIL NIL NIL "<imap-fixture@example.test>")';
        socket.write(`* 1 FETCH (UID 1 FLAGS (${flags}) INTERNALDATE "31-Jul-2026 12:30:00 +0000" RFC822.SIZE ${Buffer.byteLength(source)} ENVELOPE ${envelope} BODYSTRUCTURE ("TEXT" "PLAIN" ("CHARSET" "UTF-8") NIL NIL "7BIT" 48 1))\r\n`);
      }
      ok(upper === "UID" ? "UID FETCH" : "FETCH");
      return;
    }
    if (upper === "UID" && rest[0]?.toUpperCase() === "STORE") {
      const operation = rest.slice(2).join(" ").toUpperCase();
      if (operation.includes("+FLAGS") && operation.includes("\\SEEN")) this.#seen = true;
      if (operation.includes("-FLAGS") && operation.includes("\\SEEN")) this.#seen = false;
      if (operation.includes("+FLAGS") && operation.includes("\\FLAGGED")) this.#flagged = true;
      if (operation.includes("-FLAGS") && operation.includes("\\FLAGGED")) this.#flagged = false;
      ok("UID STORE");
      return;
    }
    if (upper === "UID" && rest[0]?.toUpperCase() === "MOVE") {
      this.#messageExists = false;
      socket.write("* OK [COPYUID 888 1 1] Moved\r\n");
      socket.write("* 0 EXISTS\r\n");
      ok("UID MOVE");
      return;
    }
    if (upper === "UNSELECT" || upper === "CLOSE") {
      ok();
      return;
    }
    if (upper === "NOOP") {
      ok();
      return;
    }
    if (upper === "LOGOUT") {
      socket.write("* BYE Closing connection\r\n");
      socket.write(`${tag} OK LOGOUT completed\r\n`, () => socket.end());
      return;
    }
    socket.write(`${tag} BAD Unsupported fixture command: ${upper}\r\n`);
  }
}
