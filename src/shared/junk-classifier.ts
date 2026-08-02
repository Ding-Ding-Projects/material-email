import type { MessageSummary } from "./contracts.js";

export const JUNK_MODEL_TOKEN_LIMIT = 20_000;
export const JUNK_TOKENS_PER_MESSAGE_LIMIT = 200;
export const JUNK_TOKEN_LENGTH_MIN = 3;
export const JUNK_TOKEN_LENGTH_MAX = 32;
export const JUNK_SAMPLE_CHARACTER_LIMIT = 20_000;
export const JUNK_SCORE_THRESHOLD_DEFAULT = 0.9;
/** Below this much training the model reports "untrained" instead of guessing. */
export const JUNK_TRAINING_MINIMUM = 5;

export interface JunkTokenCounts {
  junk: number;
  good: number;
}

export interface JunkModel {
  schemaVersion: 1;
  junkMessageCount: number;
  goodMessageCount: number;
  tokens: Readonly<Record<string, JunkTokenCounts>>;
}

export type JunkVerdict = "junk" | "not-junk" | "uncertain" | "untrained";

export interface JunkAssessment {
  verdict: JunkVerdict;
  score: number;
  threshold: number;
  tokenCount: number;
  trainedJunk: number;
  trainedGood: number;
}

export interface JunkTrainingSample {
  subject: string;
  from: readonly { name: string; address: string }[];
  body: string;
}

export const emptyJunkModel = (): JunkModel => ({ schemaVersion: 1, junkMessageCount: 0, goodMessageCount: 0, tokens: {} });

const WORD_PATTERN = /[\p{Letter}\p{Number}$!£€¥%'’-]+/gu;

/**
 * Tokens keep their source prefix, so `subject:invoice` and `from:invoice` train separately —
 * a word in a sender address carries different weight from the same word in a body.
 */
const tokenize = (source: string, prefix: string): string[] => {
  const bounded = source.normalize("NFKC").slice(0, JUNK_SAMPLE_CHARACTER_LIMIT).toLocaleLowerCase("en-US");
  const tokens: string[] = [];
  for (const match of bounded.matchAll(WORD_PATTERN)) {
    const value = match[0];
    if (value.length < JUNK_TOKEN_LENGTH_MIN || value.length > JUNK_TOKEN_LENGTH_MAX) continue;
    tokens.push(`${prefix}:${value}`);
    if (tokens.length >= JUNK_TOKENS_PER_MESSAGE_LIMIT) break;
  }
  return tokens;
};

const addressTokens = (addresses: readonly { name: string; address: string }[]): string[] => {
  const tokens: string[] = [];
  for (const entry of addresses.slice(0, 50)) {
    const domain = entry.address.split("@")[1];
    if (domain) tokens.push(`domain:${domain.toLocaleLowerCase("en-US").slice(0, JUNK_TOKEN_LENGTH_MAX)}`);
    tokens.push(...tokenize(`${entry.name} ${entry.address}`, "from"));
  }
  return tokens;
};

export const junkTokens = (sample: JunkTrainingSample): string[] => {
  const tokens = [
    ...addressTokens(sample.from),
    ...tokenize(sample.subject, "subject"),
    ...tokenize(sample.body, "body"),
  ];
  return [...new Set(tokens)].slice(0, JUNK_TOKENS_PER_MESSAGE_LIMIT);
};

export const junkSampleFromMessage = (message: MessageSummary, body?: string): JunkTrainingSample => ({
  subject: message.subject,
  from: message.from,
  body: body ?? message.preview,
});

/** Drops the least-informative tokens once the model reaches its cap, keeping training bounded. */
const pruneTokens = (tokens: Record<string, JunkTokenCounts>): Record<string, JunkTokenCounts> => {
  const entries = Object.entries(tokens);
  if (entries.length <= JUNK_MODEL_TOKEN_LIMIT) return tokens;
  entries.sort(([leftKey, left], [rightKey, right]) => {
    const leftTotal = left.junk + left.good;
    const rightTotal = right.junk + right.good;
    return rightTotal - leftTotal || leftKey.localeCompare(rightKey);
  });
  return Object.fromEntries(entries.slice(0, JUNK_MODEL_TOKEN_LIMIT));
};

export const trainJunkModel = (model: JunkModel, sample: JunkTrainingSample, label: "junk" | "good"): JunkModel => {
  const tokens: Record<string, JunkTokenCounts> = { ...model.tokens };
  for (const token of junkTokens(sample)) {
    const existing = tokens[token] ?? { junk: 0, good: 0 };
    tokens[token] = label === "junk"
      ? { junk: Math.min(existing.junk + 1, Number.MAX_SAFE_INTEGER), good: existing.good }
      : { junk: existing.junk, good: Math.min(existing.good + 1, Number.MAX_SAFE_INTEGER) };
  }
  return {
    schemaVersion: 1,
    junkMessageCount: model.junkMessageCount + (label === "junk" ? 1 : 0),
    goodMessageCount: model.goodMessageCount + (label === "good" ? 1 : 0),
    tokens: pruneTokens(tokens),
  };
};

export const untrainJunkModel = (model: JunkModel, sample: JunkTrainingSample, label: "junk" | "good"): JunkModel => {
  const tokens: Record<string, JunkTokenCounts> = { ...model.tokens };
  for (const token of junkTokens(sample)) {
    const existing = tokens[token];
    if (!existing) continue;
    const next = label === "junk"
      ? { junk: Math.max(0, existing.junk - 1), good: existing.good }
      : { junk: existing.junk, good: Math.max(0, existing.good - 1) };
    if (next.junk === 0 && next.good === 0) delete tokens[token];
    else tokens[token] = next;
  }
  return {
    schemaVersion: 1,
    junkMessageCount: Math.max(0, model.junkMessageCount - (label === "junk" ? 1 : 0)),
    goodMessageCount: Math.max(0, model.goodMessageCount - (label === "good" ? 1 : 0)),
    tokens,
  };
};

/**
 * Per-token junk probability with a Bayesian prior pulling sparse tokens back toward neutral, so a
 * word seen once does not decide a message on its own.
 */
const tokenProbability = (counts: JunkTokenCounts, junkMessages: number, goodMessages: number): number => {
  const junkRate = junkMessages > 0 ? Math.min(1, counts.junk / junkMessages) : 0;
  const goodRate = goodMessages > 0 ? Math.min(1, counts.good / goodMessages) : 0;
  if (junkRate + goodRate === 0) return 0.5;
  const raw = junkRate / (junkRate + goodRate);
  const strength = counts.junk + counts.good;
  return (1 * 0.5 + strength * raw) / (1 + strength);
};

const interestingness = (probability: number): number => Math.abs(probability - 0.5);

export const assessJunk = (
  model: JunkModel,
  sample: JunkTrainingSample,
  threshold = JUNK_SCORE_THRESHOLD_DEFAULT,
): JunkAssessment => {
  const bounded = Math.min(0.999, Math.max(0.5, threshold));
  const base: Omit<JunkAssessment, "verdict" | "score" | "tokenCount"> = {
    threshold: bounded,
    trainedJunk: model.junkMessageCount,
    trainedGood: model.goodMessageCount,
  };
  if (model.junkMessageCount < JUNK_TRAINING_MINIMUM || model.goodMessageCount < JUNK_TRAINING_MINIMUM) {
    return { verdict: "untrained", score: 0.5, tokenCount: 0, ...base };
  }
  const probabilities = junkTokens(sample)
    .map(token => model.tokens[token])
    .filter((counts): counts is JunkTokenCounts => counts !== undefined)
    .map(counts => tokenProbability(counts, model.junkMessageCount, model.goodMessageCount))
    .sort((left, right) => interestingness(right) - interestingness(left))
    .slice(0, 25);

  if (!probabilities.length) return { verdict: "uncertain", score: 0.5, tokenCount: 0, ...base };

  // Combined in log space: a long message full of neutral words must not underflow to zero.
  let junkLog = 0;
  let goodLog = 0;
  for (const probability of probabilities) {
    const clamped = Math.min(0.99, Math.max(0.01, probability));
    junkLog += Math.log(clamped);
    goodLog += Math.log(1 - clamped);
  }
  const score = 1 / (1 + Math.exp(goodLog - junkLog));
  const verdict: JunkVerdict = score >= bounded ? "junk" : score <= 1 - bounded ? "not-junk" : "uncertain";
  return { verdict, score, tokenCount: probabilities.length, ...base };
};

export const junkModelSummary = (model: JunkModel): { tokenCount: number; junkMessageCount: number; goodMessageCount: number; ready: boolean } => ({
  tokenCount: Object.keys(model.tokens).length,
  junkMessageCount: model.junkMessageCount,
  goodMessageCount: model.goodMessageCount,
  ready: model.junkMessageCount >= JUNK_TRAINING_MINIMUM && model.goodMessageCount >= JUNK_TRAINING_MINIMUM,
});
