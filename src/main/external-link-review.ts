import { randomBytes } from "node:crypto";
import { assessExternalLink, type ExternalLinkAssessment } from "../shared/external-link-safety.js";
import type { ExternalLinkReviewRequest } from "../shared/contracts.js";

export const EXTERNAL_LINK_REVIEW_TTL_MS = 60_000;
const MAX_PENDING_EXTERNAL_LINK_REVIEWS = 32;

type ExternalLinkAssessor = (raw: string) => ExternalLinkAssessment;
interface Options { now?: () => number; createRequestId?: () => string; assess?: ExternalLinkAssessor; ttlMs?: number; maxPending?: number; }
interface PendingReview { normalizedUrl: string; expiresAt: number; }

export class ExternalLinkReviewQueue {
  readonly #pending = new Map<string, PendingReview>();
  readonly #now: () => number;
  readonly #createRequestId: () => string;
  readonly #assess: ExternalLinkAssessor;
  readonly #ttlMs: number;
  readonly #maxPending: number;

  constructor(options: Options = {}) {
    this.#now = options.now ?? Date.now;
    this.#createRequestId = options.createRequestId ?? (() => randomBytes(24).toString("base64url"));
    this.#assess = options.assess ?? assessExternalLink;
    this.#ttlMs = options.ttlMs ?? EXTERNAL_LINK_REVIEW_TTL_MS;
    this.#maxPending = options.maxPending ?? MAX_PENDING_EXTERNAL_LINK_REVIEWS;
    if (!Number.isFinite(this.#ttlMs) || this.#ttlMs <= 0) throw new Error("External link review TTL must be positive.");
    if (!Number.isInteger(this.#maxPending) || this.#maxPending <= 0) throw new Error("External link review capacity must be positive.");
  }

  create(rawUrl: string): ExternalLinkReviewRequest | null {
    const assessment = this.#validatedAssessment(rawUrl);
    if (!assessment) return null;
    const now = this.#now();
    this.#pruneExpired(now);
    while (this.#pending.size >= this.#maxPending) {
      const oldest = this.#pending.keys().next().value as string | undefined;
      if (!oldest) break;
      this.#pending.delete(oldest);
    }
    const requestId = this.#createRequestId();
    if (this.#pending.has(requestId)) throw new Error("External link review request ID collision.");
    const expiresAt = now + this.#ttlMs;
    this.#pending.set(requestId, { normalizedUrl: assessment.normalizedUrl, expiresAt });
    return { requestId, normalizedUrl: assessment.normalizedUrl, hostname: assessment.hostname, risk: assessment.risk, reasons: [...assessment.reasons], expiresAt };
  }

  takeForConfirmation(requestId: string): string {
    const pending = this.#pending.get(requestId);
    if (!pending) throw new Error("External link review request is missing or already used.");
    this.#pending.delete(requestId);
    if (this.#now() >= pending.expiresAt) throw new Error("External link review request has expired.");
    const reassessment = this.#validatedAssessment(pending.normalizedUrl);
    if (!reassessment) throw new Error("External link review request no longer has an allowed protocol.");
    return reassessment.normalizedUrl;
  }

  cancel(requestId: string): boolean {
    const pending = this.#pending.get(requestId);
    if (!pending) return false;
    this.#pending.delete(requestId);
    return this.#now() < pending.expiresAt;
  }

  clear(): void { this.#pending.clear(); }

  #pruneExpired(now: number): void {
    for (const [requestId, pending] of this.#pending) if (now >= pending.expiresAt) this.#pending.delete(requestId);
  }

  #validatedAssessment(rawUrl: string): ExternalLinkAssessment | null {
    const assessment = this.#assess(rawUrl);
    if (!assessment.normalizedUrl) return null;
    try {
      const parsed = new URL(assessment.normalizedUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
      return { ...assessment, normalizedUrl: parsed.href, hostname: parsed.hostname, reasons: [...assessment.reasons] };
    } catch { return null; }
  }
}
