export type ExternalLinkRisk = "ordinary" | "caution" | "dangerous";
export type ExternalLinkReason = "http" | "credentials" | "ip-literal" | "non-default-port" | "punycode" | "bidi-control" | "malformed";
export interface ExternalLinkAssessment { normalizedUrl: string; hostname: string; risk: ExternalLinkRisk; reasons: ExternalLinkReason[]; }

const controls = /[\u202a-\u202e\u2066-\u2069\u0000-\u001f\u007f]/u;
export const assessExternalLink = (raw: string): ExternalLinkAssessment => {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return { normalizedUrl: "", hostname: "", risk: "dangerous", reasons: ["malformed"] };
    const reasons: ExternalLinkReason[] = [];
    if (url.protocol === "http:") reasons.push("http");
    if (url.username || url.password) reasons.push("credentials");
    if (/^\[?[0-9a-f:.]+\]?$/iu.test(url.hostname)) reasons.push("ip-literal");
    if ((url.protocol === "https:" && url.port && url.port !== "443") || (url.protocol === "http:" && url.port && url.port !== "80")) reasons.push("non-default-port");
    if (url.hostname.includes("xn--")) reasons.push("punycode");
    if (controls.test(raw)) reasons.push("bidi-control");
    return { normalizedUrl: url.href, hostname: url.hostname, risk: reasons.some(reason => ["credentials", "bidi-control"].includes(reason)) ? "dangerous" : reasons.length ? "caution" : "ordinary", reasons };
  } catch { return { normalizedUrl: "", hostname: "", risk: "dangerous", reasons: ["malformed"] }; }
};
