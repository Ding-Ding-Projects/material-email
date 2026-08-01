import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { Pop3AccountOptions } from "../src/shared/contracts";
import { Pop3StateMachine, runPop3Foundation } from "../src/main/pop3-foundation";

const options = (overrides: Partial<Pop3AccountOptions> = {}): Pop3AccountOptions => ({
  transport: "local-demo",
  retrievalMode: "new-only",
  leaveOnServer: true,
  messageLimit: 3,
  ...overrides,
});

describe("bounded POP3 foundation", () => {
  it("follows one deterministic local-demo transition trace and rejects out-of-order events", () => {
    const machine = new Pop3StateMachine();
    expect(() => machine.transition("retrieve-list")).toThrow(/not valid while the session is idle/iu);
    for (const event of ["start", "greeting", "demo-authorized", "retrieve-list", "quit", "disconnect"] as const) machine.transition(event);
    expect(machine.state).toBe("disconnected");
    expect(machine.transitions()).toEqual([
      { sequence: 1, from: "idle", event: "start", to: "connecting" },
      { sequence: 2, from: "connecting", event: "greeting", to: "authorization" },
      { sequence: 3, from: "authorization", event: "demo-authorized", to: "transaction" },
      { sequence: 4, from: "transaction", event: "retrieve-list", to: "transaction" },
      { sequence: 5, from: "transaction", event: "quit", to: "update" },
      { sequence: 6, from: "update", event: "disconnect", to: "disconnected" },
    ]);
  });

  it("returns stable bounded fixture messages and never claims network, credentials, deletion, or complete sync", () => {
    const first = runPop3Foundation(options({ messageLimit: 2 }));
    const second = runPop3Foundation(options({ messageLimit: 2 }));
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      transport: "local-demo",
      state: "disconnected",
      boundary: "local-demo-only",
      serverContacted: false,
      credentialsUsed: false,
      deletionAttempted: false,
      fullSynchronization: false,
    });
    expect(first.messages.map(message => message.uidl)).toEqual(["material-pop3-demo-001", "material-pop3-demo-002"]);
    expect(first.capabilities).toContainEqual({ name: "UIDL", available: true, used: true });
    expect(first.capabilities).toContainEqual({ name: "DELE", available: false, used: false });
  });

  it("rejects the live-network route in the idle state before advertising or using any capability", () => {
    const snapshot = runPop3Foundation(options({ transport: "live-network" }));
    expect(snapshot).toMatchObject({
      state: "unsupported",
      boundary: "live-network-unsupported",
      messages: [],
      serverContacted: false,
      credentialsUsed: false,
      deletionAttempted: false,
      fullSynchronization: false,
      transitions: [{ sequence: 1, from: "idle", event: "reject-live-network", to: "unsupported" }],
    });
    expect(snapshot.capabilities.every(capability => !capability.available && !capability.used)).toBe(true);
  });

  it("contains no socket, TLS, provider, credential, or production mail-transport dependency", async () => {
    const source = await readFile("src/main/pop3-foundation.ts", "utf8");
    expect(source).not.toMatch(/from\s+["']node:(?:net|tls|dns|http|https)["']|\b(?:fetch|ImapFlow|nodemailer|safeStorage|JsonStore|writeFile|readFile|console)\b/u);
    expect(source).not.toContain("mail-service");
  });
});
