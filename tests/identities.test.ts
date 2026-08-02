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
  identityReplyTo,
  identitySender,
  isMailAddress,
  normalizeIdentityLine,
  normalizeIdentityText,
  recoverSignaturePlacement,
  removeIdentity,
  resolveIdentity,
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

  it("folds a newline to a space for header lines while text keeps it", () => {
    const raw = `Mat${String.fromCharCode(0)}\r\n  Day${String.fromCharCode(7)}`;
    // A display name reaches the wire as a header value, where a newline would break the header.
    expect(normalizeIdentityLine(raw, 100)).toBe("Mat Day");
    expect(normalizeIdentityText(raw, 100)).toBe("Mat\n  Day");
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

  it("stores a display name and organization with no newline in them", () => {
    counter = 0;
    const identities = buildIdentity([], input({ displayName: "Mat\nDay", organization: "Ding\nDing Projects" }), newId);
    expect(identities[0]).toMatchObject({ displayName: "Mat Day", organization: "Ding Ding Projects" });
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

  it("sends from the requested identity, and from the account default without one", () => {
    const identities = seeded();
    const work = identities.find(identity => identity.email === "mat@work.example");
    expect(resolveIdentity(identities, "account-1", work?.id)?.email).toBe("mat@work.example");
    expect(resolveIdentity(identities, "account-1", undefined)?.id).toBe(defaultIdentityFor(identities, "account-1")?.id);
  });

  it("ignores an identity that belongs to a different account", () => {
    const identities = buildIdentity(seeded(), input({ accountId: "account-2", email: "mat@second.example" }), newId);
    const foreign = identities.find(identity => identity.accountId === "account-2");
    expect(resolveIdentity(identities, "account-1", foreign?.id)?.id).toBe(defaultIdentityFor(identities, "account-1")?.id);
  });

  it("resolves nothing for an account without identities", () => {
    expect(resolveIdentity(seeded(), "account-9", "identity-1")).toBeNull();
  });

  it("writes no reply-to when it is absent or only cased differently than the sender", () => {
    const identities = seeded();
    const first = identities[0] as MailIdentity;
    expect(identityReplyTo(first)).toBeNull();
    const cased = buildIdentity(identities, input({ id: first.id, replyTo: "  MAT@Example.COM  " }), newId);
    expect(identityReplyTo(cased.find(identity => identity.id === first.id) as MailIdentity)).toBeNull();
  });

  it("writes reply-to when it genuinely differs from the sender", () => {
    const identities = seeded();
    const first = identities[0] as MailIdentity;
    const updated = buildIdentity(identities, input({ id: first.id, replyTo: "desk@example.com" }), newId);
    expect(identityReplyTo(updated.find(identity => identity.id === first.id) as MailIdentity)).toEqual({
      name: "Mat Day",
      address: "desk@example.com",
    });
  });
});

describe("signature application", () => {
  const withSignature = (overrides: Partial<MailIdentity> = {}): MailIdentity => ({
    ...(seeded()[0] as MailIdentity),
    signature: "Mat\nDing Ding Projects",
    signaturePlacement: "below-body",
    ...overrides,
  });

  const work = withSignature({ id: "identity-2", displayName: "Mat (Work)", email: "mat@work.example", signature: "Mat\nWork desk" });
  const quotedBody = "My reply.\n\n> quoted line";
  // The index is measured against the body as it stands without a signature, which is what the
  // outgoing block is cut out of before the incoming one is placed.
  const quotedFrom = quotedBody.indexOf("> quoted");

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

  it("keeps the quote when another identity's signature replaces one sitting above it", () => {
    const home = withSignature();
    const signed = applySignature(quotedBody, home, quotedFrom);
    const switched = applySignature(signed.text, work, quotedFrom, home.signature);
    expect(switched.text).toBe(`My reply.\n${SIGNATURE_SEPARATOR}\nMat\nWork desk\n\n> quoted line`);
    expect(switched.text.split(SIGNATURE_SEPARATOR)).toHaveLength(2);
  });

  it("removes the block above the quote when the next identity has no signature", () => {
    const home = withSignature();
    const signed = applySignature(quotedBody, home, quotedFrom);
    const cleared = applySignature(signed.text, withSignature({ id: "identity-3", signature: "" }), quotedFrom, home.signature);
    expect(cleared).toEqual({ text: quotedBody, applied: false });
  });

  it("moves the block below the quote when the next identity signs there", () => {
    const home = withSignature();
    const trailing = withSignature({ id: "identity-4", signature: "Trailing", signaturePlacement: "below-quote" });
    const signed = applySignature(quotedBody, home, quotedFrom);
    const moved = applySignature(signed.text, trailing, quotedFrom, home.signature);
    expect(moved.text).toBe(`${quotedBody}\n${SIGNATURE_SEPARATOR}\nTrailing`);
  });

  it("converges on the same body when identities are switched back and forth", () => {
    const home = withSignature();
    const signed = applySignature(quotedBody, home, quotedFrom);
    const switched = applySignature(signed.text, work, quotedFrom, home.signature);
    const back = applySignature(switched.text, home, quotedFrom, work.signature);
    const again = applySignature(back.text, work, quotedFrom, home.signature);
    expect(back.text).toBe(signed.text);
    expect(again.text).toBe(switched.text);
  });

  const marker = "> quoted line";

  it("locates the quote after the outgoing block is removed, not before it", () => {
    const home = withSignature();
    const signed = applySignature(quotedBody, home, marker);
    // An index taken from the signed body is stale by the block's length, which is exactly the
    // caller mistake that used to splice the incoming signature into the middle of the quote.
    const staleIndex = signed.text.indexOf(marker);
    const switched = applySignature(signed.text, work, marker, home.signature);
    expect(staleIndex).not.toBe(quotedFrom);
    expect(switched.text).toBe(`My reply.\n${SIGNATURE_SEPARATOR}\nMat\nWork desk\n\n${marker}`);
  });

  it("keeps a body that carries someone else's separator when nothing of ours was applied", () => {
    const forwarded = `Numbers attached.\n${SIGNATURE_SEPARATOR}\nJane Roe\nAcme Ltd`;
    // An empty previous signature asserts that no signature of ours is present, so the separator
    // inside forwarded mail must not be treated as the start of a block to cut.
    expect(applySignature(forwarded, null, null, "").text).toBe(forwarded);
    expect(applySignature(forwarded, withSignature(), null, "").text)
      .toBe(`${forwarded}\n${SIGNATURE_SEPARATOR}\nMat\nDing Ding Projects`);
  });

  it("still trusts the bare separator only when the caller admits it does not know", () => {
    const signed = applySignature("Hello there.", withSignature());
    expect(applySignature(signed.text, work).text).toBe(`Hello there.\n${SIGNATURE_SEPARATOR}\nMat\nWork desk`);
  });
});

describe("recovering a signature from a reopened draft", () => {
  const identity = (overrides: Partial<MailIdentity>): MailIdentity => ({
    ...(seeded()[0] as MailIdentity),
    signaturePlacement: "below-body",
    ...overrides,
  });

  it("finds the applied signature and the line the quote starts on", () => {
    const home = identity({ signature: "Mat\nDing Ding Projects" });
    const body = `My reply.\n${SIGNATURE_SEPARATOR}\nMat\nDing Ding Projects\n\n> quoted line`;
    expect(recoverSignaturePlacement(body, [home])).toEqual({ signature: "Mat\nDing Ding Projects", quoteMarker: "> quoted line" });
  });

  it("reports no signature when the body only quotes someone else's", () => {
    const home = identity({ signature: "Mat\nDing Ding Projects" });
    const body = `Numbers attached.\n${SIGNATURE_SEPARATOR}\nJane Roe\nAcme Ltd`;
    expect(recoverSignaturePlacement(body, [home])).toEqual({ signature: "", quoteMarker: null });
  });

  it("reports no quote marker when the signature is last", () => {
    const home = identity({ signature: "Mat" });
    expect(recoverSignaturePlacement(`Hello.\n${SIGNATURE_SEPARATOR}\nMat`, [home]))
      .toEqual({ signature: "Mat", quoteMarker: null });
  });

  it("declines when the same block appears twice, because the copy may be quoted material", () => {
    const home = identity({ signature: "Mat Day" });
    // What a forward of a message that already carried this signature looks like.
    const body = `\n${SIGNATURE_SEPARATOR}\nMat Day\n\n—— Forwarded message ——\nEarlier note.\n${SIGNATURE_SEPARATOR}\nMat Day`;
    expect(recoverSignaturePlacement(body, [home])).toEqual({ signature: "", quoteMarker: null });
  });

  it("prefers the longer signature when one is a prefix of another at the same place", () => {
    const short = identity({ id: "identity-short", signature: "Mat" });
    const long = identity({ id: "identity-long", signature: "Mat\nDing Ding Projects" });
    expect(recoverSignaturePlacement(`Hello.\n${SIGNATURE_SEPARATOR}\nMat\nDing Ding Projects`, [short, long]).signature)
      .toBe("Mat\nDing Ding Projects");
  });
});
