import { describe, expect, it } from "vitest";
import {
  IDENTITY_LIMIT_PER_ACCOUNT,
  MailIdentityError,
  SIGNATURE_SEPARATOR,
  applySignature,
  buildIdentity,
  defaultIdentityFor,
  identitiesForAccount,
  identityForReply,
  identitySender,
  isMailAddress,
  normalizeIdentityText,
  removeIdentity,
  type MailIdentity,
  type MailIdentityInput,
} from "../src/shared/identities.js";

let counter = 0;
const newId = (): string => `identity-${(counter += 1)}`;

const input = (overrides: Partial<MailIdentityInput> = {}): MailIdentityInput => ({
  accountId: "account-1",
  displayName: "Mat Day",
  email: "mat@example.com",
  ...overrides,
});

const seeded = (): MailIdentity[] => {
  counter = 0;
  let identities = buildIdentity([], input(), newId);
  identities = buildIdentity(identities, input({ displayName: "Mat (Work)", email: "mat@work.example" }), newId);
  return identities;
};

describe("identity validation", () => {
  it("accepts ordinary addresses and rejects malformed ones", () => {
    expect(isMailAddress("mat@example.com")).toBe(true);
    expect(isMailAddress("mat+tag@mail.example.co.uk")).toBe(true);
    expect(isMailAddress("mat@localhost")).toBe(false);
    expect(isMailAddress("mat example.com")).toBe(false);
    expect(isMailAddress("<mat@example.com>")).toBe(false);
    expect(isMailAddress("")).toBe(false);
  });

  it("normalizes text, keeps newlines, and drops control characters", () => {
    const raw = `Line one${String.fromCharCode(0)}\r\nLine two${String.fromCharCode(7)}`;
    expect(normalizeIdentityText(raw, 100)).toBe("Line one\nLine two");
  });

  it("bounds normalized text to its limit", () => {
    expect(normalizeIdentityText("x".repeat(500), 10)).toHaveLength(10);
  });

  it("requires a display name and a valid address", () => {
    expect(() => buildIdentity([], input({ displayName: "   " }), newId)).toThrow(/display name/u);
    expect(() => buildIdentity([], input({ email: "not-an-address" }), newId)).toThrow(/valid email/u);
    expect(() => buildIdentity([], input({ replyTo: "also-bad" }), newId)).toThrow(/reply-to/u);
  });
});

describe("identity storage", () => {
  it("makes the first identity on an account the default", () => {
    counter = 0;
    const identities = buildIdentity([], input(), newId);
    expect(identities).toHaveLength(1);
    expect(identities[0]).toMatchObject({ id: "identity-1", isDefault: true, ordinal: 0, signaturePlacement: "below-body" });
  });

  it("keeps exactly one default per account when another is promoted", () => {
    const identities = seeded();
    const second = identities[1];
    const promoted = buildIdentity(identities, input({ id: second?.id ?? "", displayName: "Mat (Work)", email: "mat@work.example", isDefault: true }), newId);
    expect(promoted.filter(identity => identity.isDefault)).toHaveLength(1);
    expect(defaultIdentityFor(promoted, "account-1")?.email).toBe("mat@work.example");
  });

  it("does not disturb another account's default", () => {
    const identities = buildIdentity(seeded(), input({ accountId: "account-2", email: "mat@second.example" }), newId);
    expect(identitiesForAccount(identities, "account-1").filter(identity => identity.isDefault)).toHaveLength(1);
    expect(identitiesForAccount(identities, "account-2").filter(identity => identity.isDefault)).toHaveLength(1);
  });

  it("updates in place without changing the identifier or ordinal", () => {
    const identities = seeded();
    const first = identities.find(identity => identity.email === "mat@example.com");
    const updated = buildIdentity(identities, input({ id: first?.id ?? "", displayName: "Renamed", email: "mat@example.com" }), newId);
    expect(updated).toHaveLength(2);
    expect(updated.find(identity => identity.id === first?.id)).toMatchObject({ displayName: "Renamed", ordinal: first?.ordinal });
  });

  it("rejects an update for an identity that no longer exists and stops at the ceiling", () => {
    expect(() => buildIdentity(seeded(), input({ id: "missing" }), newId)).toThrow(MailIdentityError);
    let identities = seeded();
    while (identitiesForAccount(identities, "account-1").length < IDENTITY_LIMIT_PER_ACCOUNT) {
      identities = buildIdentity(identities, input({ email: `mat${identities.length}@example.com` }), newId);
    }
    expect(() => buildIdentity(identities, input({ email: "one-too-many@example.com" }), newId)).toThrow(/at most/u);
  });

  it("promotes a sibling when the default is removed, and refuses to remove the last identity", () => {
    const identities = seeded();
    const current = defaultIdentityFor(identities, "account-1");
    const remaining = removeIdentity(identities, current?.id ?? "");
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.isDefault).toBe(true);
    expect(() => removeIdentity(remaining, remaining[0]?.id ?? "")).toThrow(/at least one identity/u);
  });
});

describe("identity selection", () => {
  it("replies from the identity the message was addressed to", () => {
    const identities = seeded();
    const chosen = identityForReply(identities, "account-1", {
      to: [{ name: "", address: "MAT@WORK.EXAMPLE" }],
      cc: [],
    });
    expect(chosen?.email).toBe("mat@work.example");
  });

  it("prefers a To match over a Cc match", () => {
    const identities = seeded();
    const chosen = identityForReply(identities, "account-1", {
      to: [{ name: "", address: "mat@example.com" }],
      cc: [{ name: "", address: "mat@work.example" }],
    });
    expect(chosen?.email).toBe("mat@example.com");
  });

  it("falls back to the account default when nothing matches", () => {
    const identities = seeded();
    const chosen = identityForReply(identities, "account-1", { to: [{ name: "", address: "someone@elsewhere.example" }], cc: [] });
    expect(chosen?.id).toBe(defaultIdentityFor(identities, "account-1")?.id);
  });

  it("returns nothing for an account without identities", () => {
    expect(identityForReply(seeded(), "account-9", null)).toBeNull();
  });

  it("builds a sender address from the identity", () => {
    expect(identitySender(seeded()[0] as MailIdentity)).toEqual({ name: "Mat Day", address: "mat@example.com" });
  });
});

describe("signature application", () => {
  const withSignature = (overrides: Partial<MailIdentity> = {}): MailIdentity => ({
    ...(seeded()[0] as MailIdentity),
    signature: "Mat\nDing Ding Projects",
    signaturePlacement: "below-body",
    ...overrides,
  });

  it("appends a separated signature block", () => {
    const result = applySignature("Hello there.", withSignature());
    expect(result.applied).toBe(true);
    expect(result.text).toBe(`Hello there.\n${SIGNATURE_SEPARATOR}\nMat\nDing Ding Projects`);
  });

  it("replaces the previous signature instead of stacking a second one", () => {
    const first = applySignature("Hello there.", withSignature());
    const second = applySignature(first.text, withSignature({ signature: "Different" }));
    expect(second.text).toBe(`Hello there.\n${SIGNATURE_SEPARATOR}\nDifferent`);
    expect(second.text.split(SIGNATURE_SEPARATOR)).toHaveLength(2);
  });

  it("removes the signature when the chosen identity has none", () => {
    const signed = applySignature("Hello there.", withSignature());
    const cleared = applySignature(signed.text, withSignature({ signature: "" }));
    expect(cleared).toEqual({ text: "Hello there.", applied: false });
  });

  it("places the signature above quoted material by default", () => {
    const body = "My reply.\n\n> quoted line";
    const result = applySignature(body, withSignature(), body.indexOf("> quoted"));
    expect(result.text).toBe(`My reply.\n${SIGNATURE_SEPARATOR}\nMat\nDing Ding Projects\n\n> quoted line`);
  });

  it("places the signature below quoted material when asked", () => {
    const body = "My reply.\n\n> quoted line";
    const result = applySignature(body, withSignature({ signaturePlacement: "below-quote" }), body.indexOf("> quoted"));
    expect(result.text).toBe(`${body}\n${SIGNATURE_SEPARATOR}\nMat\nDing Ding Projects`);
  });

  it("appends when the quote index is out of range", () => {
    const result = applySignature("Short.", withSignature(), 9_999);
    expect(result.text).toBe(`Short.\n${SIGNATURE_SEPARATOR}\nMat\nDing Ding Projects`);
  });

  it("leaves the body alone when there is no identity", () => {
    expect(applySignature("Hello there.", null)).toEqual({ text: "Hello there.", applied: false });
  });
});
