import { beforeEach, describe, expect, it, vi } from "vitest";

const transportMocks = vi.hoisted(() => ({
  imapUsable: true,
  imapConnect: vi.fn(),
  imapLogout: vi.fn(),
  imapClose: vi.fn(),
  createTransport: vi.fn(),
  smtpVerify: vi.fn(),
  smtpClose: vi.fn(),
}));

vi.mock("imapflow", () => ({
  ImapFlow: class {
    get usable(): boolean {
      return transportMocks.imapUsable;
    }

    connect(): Promise<void> {
      return transportMocks.imapConnect();
    }

    logout(): Promise<void> {
      return transportMocks.imapLogout();
    }

    close(): void {
      transportMocks.imapClose();
    }
  },
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: transportMocks.createTransport,
  },
}));

import { MailService, type RuntimeAccount } from "../src/main/mail-service";

const account: RuntimeAccount = {
  id: "cleanup-test",
  displayName: "Cleanup Test",
  email: "cleanup@example.test",
  incoming: { host: "imap.example.test", port: 993, security: "tls", username: "cleanup@example.test" },
  outgoing: { host: "smtp.example.test", port: 465, security: "tls", username: "cleanup@example.test" },
  authMode: "password",
  kind: "imap",
  createdAt: "2026-07-31T00:00:00.000Z",
  secret: "fixture-only-secret",
};

describe("MailService account-test cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transportMocks.imapUsable = true;
    transportMocks.imapConnect.mockResolvedValue(undefined);
    transportMocks.imapLogout.mockResolvedValue(undefined);
    transportMocks.smtpVerify.mockResolvedValue(true);
    transportMocks.createTransport.mockReturnValue({
      verify: transportMocks.smtpVerify,
      close: transportMocks.smtpClose,
    });
  });

  it("uses the IMAP cleanup path and closes SMTP when verification rejects", async () => {
    transportMocks.smtpVerify.mockRejectedValueOnce(new Error("SMTP verification failed"));

    await expect(new MailService().testAccount(account)).rejects.toThrow("SMTP verification failed");

    expect(transportMocks.imapConnect).toHaveBeenCalledOnce();
    expect(transportMocks.imapLogout).toHaveBeenCalledOnce();
    expect(transportMocks.imapClose).not.toHaveBeenCalled();
    expect(transportMocks.smtpVerify).toHaveBeenCalledOnce();
    expect(transportMocks.smtpClose).toHaveBeenCalledOnce();

    const [imapConnectOrder] = transportMocks.imapConnect.mock.invocationCallOrder;
    const [imapLogoutOrder] = transportMocks.imapLogout.mock.invocationCallOrder;
    const [smtpVerifyOrder] = transportMocks.smtpVerify.mock.invocationCallOrder;
    const [smtpCloseOrder] = transportMocks.smtpClose.mock.invocationCallOrder;
    expect(imapConnectOrder).toBeLessThan(imapLogoutOrder ?? 0);
    expect(imapLogoutOrder).toBeLessThan(smtpVerifyOrder ?? 0);
    expect(smtpVerifyOrder).toBeLessThan(smtpCloseOrder ?? 0);
  });
});
