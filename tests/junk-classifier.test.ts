import { describe, expect, it } from "vitest";
import {
  JUNK_MODEL_TOKEN_LIMIT,
  JUNK_TOKENS_PER_MESSAGE_LIMIT,
  JUNK_TRAINING_MINIMUM,
  assessJunk,
  emptyJunkModel,
  junkModelSummary,
  junkSampleFromMessage,
  junkTokens,
  trainJunkModel,
  untrainJunkModel,
  type JunkModel,
  type JunkTrainingSample,
} from "../src/shared/junk-classifier.js";
import type { MessageSummary } from "../src/shared/contracts.js";

const junkSample = (index: number): JunkTrainingSample => ({
  subject: `Congratulations winner claim your prize now ${index}`,
  from: [{ name: "Prize Desk", address: `payout${index}@lottery-payout.example` }],
  body: "Click the link below to claim your unclaimed lottery winnings before this offer expires forever.",
});

const goodSample = (index: number): JunkTrainingSample => ({
  subject: `Steamer roster for Tuesday ${index}`,
  from: [{ name: "Auntie Mei", address: `mei${index}@dimsum-kitchen.example` }],
  body: "Here is the har gow and siu mai schedule for the morning service, plus the bamboo steamer rotation.",
});

const trained = (junk = 8, good = 8): JunkModel => {
  let model = emptyJunkModel();
  for (let index = 0; index < junk; index += 1) model = trainJunkModel(model, junkSample(index), "junk");
  for (let index = 0; index < good; index += 1) model = trainJunkModel(model, goodSample(index), "good");
  return model;
};

describe("junk tokenization", () => {
  it("prefixes tokens by the part of the message they came from", () => {
    const tokens = junkTokens({ subject: "invoice", from: [{ name: "", address: "billing@shop.example" }], body: "invoice" });
    expect(tokens).toContain("subject:invoice");
    expect(tokens).toContain("body:invoice");
    expect(tokens).toContain("from:billing");
    expect(tokens).toContain("domain:shop.example");
  });

  it("drops tokens that are too short or too long and de-duplicates the rest", () => {
    const tokens = junkTokens({ subject: "a an the extraordinarilyverylongtokenvaluethatkeepsgoingandgoing offer offer", from: [], body: "" });
    expect(tokens).toContain("subject:the");
    expect(tokens).not.toContain("subject:an");
    expect(tokens.filter(token => token === "subject:offer")).toHaveLength(1);
    expect(tokens.every(token => token.split(":")[1] !== undefined)).toBe(true);
  });

  it("bounds the number of tokens taken from one message", () => {
    const body = Array.from({ length: 5_000 }, (_value, index) => `word${index}`).join(" ");
    expect(junkTokens({ subject: "", from: [], body }).length).toBeLessThanOrEqual(JUNK_TOKENS_PER_MESSAGE_LIMIT);
  });

  it("builds a sample from a message, falling back to the preview when no body is supplied", () => {
    const message: MessageSummary = {
      id: "a:INBOX:1",
      accountId: "a",
      folderPath: "INBOX",
      uid: 1,
      from: [{ name: "Mei", address: "mei@example.com" }],
      to: [],
      cc: [],
      subject: "Roster",
      date: "2026-08-01T00:00:00.000Z",
      preview: "preview text",
      unread: true,
      starred: false,
      hasAttachments: false,
      size: 10,
    };
    expect(junkSampleFromMessage(message).body).toBe("preview text");
    expect(junkSampleFromMessage(message, "full body").body).toBe("full body");
  });
});

describe("junk assessment", () => {
  it("reports untrained until both sides have enough examples", () => {
    expect(assessJunk(emptyJunkModel(), junkSample(0)).verdict).toBe("untrained");
    const lopsided = trained(JUNK_TRAINING_MINIMUM + 2, JUNK_TRAINING_MINIMUM - 2);
    expect(assessJunk(lopsided, junkSample(0)).verdict).toBe("untrained");
    expect(junkModelSummary(lopsided).ready).toBe(false);
  });

  it("classifies a message that resembles its junk training", () => {
    const assessment = assessJunk(trained(), junkSample(99));
    expect(assessment.verdict).toBe("junk");
    expect(assessment.score).toBeGreaterThan(assessment.threshold);
  });

  it("classifies a message that resembles its good training", () => {
    const assessment = assessJunk(trained(), goodSample(99));
    expect(assessment.verdict).toBe("not-junk");
    expect(assessment.score).toBeLessThan(1 - assessment.threshold);
  });

  it("stays uncertain about a message with no familiar tokens", () => {
    const assessment = assessJunk(trained(), { subject: "zzz", from: [], body: "" });
    expect(assessment.verdict).toBe("uncertain");
    expect(assessment.score).toBe(0.5);
    expect(assessment.tokenCount).toBe(0);
  });

  it("clamps the threshold into a usable range and reports the value it used", () => {
    expect(assessJunk(trained(), junkSample(0), 0.1).threshold).toBe(0.5);
    expect(assessJunk(trained(), junkSample(0), 5).threshold).toBe(0.999);
  });

  it("produces a finite score for a long message rather than underflowing", () => {
    const body = Array.from({ length: 2_000 }, () => "prize winnings claim offer").join(" ");
    const assessment = assessJunk(trained(), { subject: "claim your prize", from: [], body });
    expect(Number.isFinite(assessment.score)).toBe(true);
    expect(assessment.score).toBeGreaterThan(0);
    expect(assessment.score).toBeLessThanOrEqual(1);
  });

  it("moves a verdict when the user corrects it", () => {
    let model = trained();
    const disputed = junkSample(1_000);
    expect(assessJunk(model, disputed).verdict).toBe("junk");
    for (let index = 0; index < 30; index += 1) model = trainJunkModel(model, disputed, "good");
    expect(assessJunk(model, disputed).verdict).not.toBe("junk");
  });
});

describe("junk training bookkeeping", () => {
  it("counts trained messages on each side", () => {
    const summary = junkModelSummary(trained(6, 7));
    expect(summary).toMatchObject({ junkMessageCount: 6, goodMessageCount: 7, ready: true });
    expect(summary.tokenCount).toBeGreaterThan(0);
  });

  it("reverses a training decision exactly", () => {
    const base = trained();
    const withExtra = trainJunkModel(base, junkSample(500), "junk");
    const reverted = untrainJunkModel(withExtra, junkSample(500), "junk");
    expect(junkModelSummary(reverted).junkMessageCount).toBe(junkModelSummary(base).junkMessageCount);
    expect(reverted.tokens).toEqual(base.tokens);
  });

  it("never drives a count below zero", () => {
    const model = untrainJunkModel(emptyJunkModel(), junkSample(0), "junk");
    expect(model.junkMessageCount).toBe(0);
    expect(Object.keys(model.tokens)).toEqual([]);
  });

  it("keeps the model bounded by pruning the least-seen tokens", () => {
    let model = emptyJunkModel();
    for (let index = 0; index < 400; index += 1) {
      model = trainJunkModel(model, {
        subject: Array.from({ length: 60 }, (_value, word) => `unique${index}x${word}`).join(" "),
        from: [],
        body: "",
      }, "junk");
    }
    expect(Object.keys(model.tokens).length).toBeLessThanOrEqual(JUNK_MODEL_TOKEN_LIMIT);
  });
});
