import { createHash } from "node:crypto";

import {
  BasicFactCategory,
  ClaimAssessment,
  ClaimType,
  ParsedClaim,
} from "@/lib/fact-check/pipeline/types";

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "of",
  "to",
  "and",
  "in",
  "on",
  "for",
  "with",
  "very",
  "really",
]);

export function normalizeInput(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function buildDedupeKey(normalizedInput: string, modelVersion: string) {
  return hashValue(`${modelVersion}:${normalizedInput}`);
}

export function parseInput(payload: { claim?: unknown; input?: unknown; url?: unknown } | null) {
  const inputCandidate =
    typeof payload?.input === "string"
      ? payload.input
      : typeof payload?.claim === "string"
        ? payload.claim
        : typeof payload?.url === "string"
          ? payload.url
          : "";

  const input = inputCandidate.trim();
  if (!input) {
    return { error: "Input is required" as const };
  }

  if (input.length > 1400) {
    return { error: "Input is too long" as const };
  }

  return { input };
}

export function getInputType(input: string): "text" | "url" {
  try {
    const parsed = new URL(input);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? "url" : "text";
  } catch {
    return "text";
  }
}

export function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function tokenize(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

export function parseClaimStructure(input: string): ParsedClaim | null {
  const cleaned = input.trim().replace(/\s+/g, " ");
  const pattern = /^(.+?)\s+(is|are|was|were|has|have|can|cannot|can't|will|won't)\s+(.+?)\.?$/i;
  const match = cleaned.match(pattern);

  if (!match) {
    return null;
  }

  const subject = match[1].trim();
  const predicate = match[2].trim().toLowerCase();
  const object = match[3].trim();

  if (subject.length < 2 || object.length < 2) {
    return null;
  }

  return { subject, predicate, object };
}

export function classifyClaim(claim: string): ClaimType {
  const text = claim.toLowerCase();

  if (/(i think|i feel|in my view|probably|best|worst|beautiful|ugly|overrated|underrated|amazing|terrible)/i.test(text)) {
    return "opinion";
  }

  if (/(percent|%|rate|ratio|gdp|inflation|population|revenue|million|billion|trillion|\d)/i.test(text)) {
    return "statistical";
  }

  if (/(election|policy|law|bill|senate|congress|parliament|government|campaign|president|prime minister)/i.test(text)) {
    return "political";
  }

  return "scientific";
}

export function classifyClaimType(inputText: string, parsedClaim: ParsedClaim | null): ClaimType {
  const classified = classifyClaim(inputText);
  if (classified !== "scientific") {
    return classified;
  }

  const text = inputText.toLowerCase();

  if (
    /(vaccine|virus|disease|clinical|trial|study|medical|health|covid|mortality|orbit|planet|physics|chemistry|biology)/i.test(
      text,
    )
  ) {
    return "scientific";
  }

  if (parsedClaim && /(born|died|married|ceo|founder|president)/i.test(parsedClaim.object)) {
    return "political";
  }

  return "scientific";
}

function detectBiographicalStatusClaim(inputText: string, parsedClaim: ParsedClaim | null): "dead" | "alive" | null {
  const text = inputText.toLowerCase();
  const combined = `${parsedClaim?.predicate ?? ""} ${parsedClaim?.object ?? ""}`.toLowerCase();

  if (/\b(is|was|has been)\s+(dead|deceased)\b/.test(text) || /\b(died|deceased|dead)\b/.test(combined)) {
    return "dead";
  }

  if (/\b(is|was|has been)\s+(alive|living)\b/.test(text) || /\b(alive|living)\b/.test(combined)) {
    return "alive";
  }

  return null;
}

export function assessClaimForDecisiveMode(
  inputText: string,
  parsedClaim: ParsedClaim | null,
  claimType: ClaimType,
): ClaimAssessment {
  const text = inputText.toLowerCase();
  const hasHedging = /\b(maybe|might|possibly|probably|likely|unlikely|could|seems|appears)\b/i.test(text);
  const hasFutureOrCounterfactual = /\b(will|would|could have|should have|if)\b/i.test(text);
  const hasNormativeLanguage = /\b(should|ought|best|worst|good|bad|better|worse|right|wrong|overrated|underrated)\b/i.test(text);
  const hasRumorSignal = /\b(rumor|alleged|reportedly|unconfirmed|claimed by social media|people say)\b/i.test(text);
  const isDefinitional = parsedClaim ? /^(is|are|was|were|has|have)$/i.test(parsedClaim.predicate) : false;
  const objectTokens = tokenize(parsedClaim?.object ?? "");
  const shortObject = objectTokens.length > 0 && objectTokens.length <= 9;
  const hasSubject = parsedClaim ? tokenize(parsedClaim.subject).length >= 1 : false;
  const statusClaim = detectBiographicalStatusClaim(inputText, parsedClaim);

  const geographySignal =
    /\b(capital|continent|country|located in|largest ocean|highest mountain|river)\b/i.test(text) ||
    /\bcapital\s+of\b/i.test(text);
  const scienceSignal =
    /\b(orbit|gravity|boils at|freezes at|photosynthesis|chemical|atomic number|planet|speed of light)\b/i.test(text);
  const historicalSignal = /\b(born|died|founded|discovered|invented|independence|year)\b/i.test(text);

  const category: BasicFactCategory = geographySignal
    ? "geography"
    : scienceSignal
      ? "science"
      : historicalSignal
        ? "historical"
        : "general";

  const hasBasicSignal = geographySignal || scienceSignal || historicalSignal || statusClaim !== null;
  const isBasicFact =
    claimType !== "opinion" &&
    !hasHedging &&
    !hasFutureOrCounterfactual &&
    isDefinitional &&
    hasSubject &&
    shortObject &&
    hasBasicSignal;

  const isHighCertaintyFact =
    isBasicFact ||
    (statusClaim !== null &&
      claimType !== "opinion" &&
      !hasHedging &&
      !hasFutureOrCounterfactual &&
      hasSubject);

  const verificationReason =
    claimType === "opinion"
      ? "This appears to be a subjective or value-judgment claim."
      : hasFutureOrCounterfactual
        ? "This claim is predictive or counterfactual and cannot be decisively fact-checked from static evidence."
        : hasRumorSignal
          ? "This claim appears to be rumor-based and needs stronger confirmation."
          : hasNormativeLanguage && !isBasicFact
            ? "This claim is primarily normative and requires interpretation beyond factual verification."
            : null;
  const needsVerification = !isHighCertaintyFact && verificationReason !== null;

  const decisivePrompt = isBasicFact
    ? "Decisive mode: prioritize direct factual references and force a support-or-contradict outcome whenever evidence is non-neutral."
    : "Balanced mode: aggregate support and contradiction signals and allow unresolved outcomes when evidence is weak.";

  return {
    isBasicFact,
    category,
    decisivePrompt,
    isHighCertaintyFact,
    statusClaim,
    needsVerification,
    verificationReason: verificationReason ?? undefined,
  };
}

export function extractEntityCandidate(input: string) {
  const parsed = parseClaimStructure(input);
  if (parsed) {
    return parsed.subject;
  }

  const titleCaseMatch = input.match(/([A-Z][a-z]+\s+[A-Z][a-z]+)/);
  if (titleCaseMatch?.[1]) {
    return titleCaseMatch[1];
  }

  const fallback = input
    .split(/\s+/)
    .slice(0, 4)
    .join(" ");

  return fallback || input;
}

export function rewriteClaimQueries(
  claimText: string,
  claimType: ClaimType,
  parsedClaim: ParsedClaim | null,
  assessment: ClaimAssessment,
) {
  const normalized = claimText.trim().replace(/\s+/g, " ");
  const subject = parsedClaim?.subject?.trim() || extractEntityCandidate(claimText);
  const object = parsedClaim?.object?.trim() || tokenize(claimText).slice(-3).join(" ");

  const base = [
    `Does ${normalized}`,
    `${subject} ${parsedClaim?.predicate ?? ""} ${object} evidence`,
    `${normalized} fact check`,
  ];

  const byType =
    claimType === "statistical"
      ? [`${normalized} official dataset`, `${subject} ${object} latest statistics`, `${normalized} source data`]
      : claimType === "political"
        ? [`${normalized} official statement`, `${normalized} policy record`, `${subject} ${object} verified reporting`]
        : claimType === "opinion"
          ? [`${normalized} objective evidence`, `${subject} ${object} measurable facts`, `${normalized} claim verification`]
          : [
              `${normalized} scientific proof`,
              `${subject} ${object} peer reviewed evidence`,
              `${normalized} explanation`,
            ];

  const decisive = assessment.isBasicFact
    ? [
        `${normalized} true or false`,
        `${subject} ${parsedClaim?.predicate ?? "is"} ${object} confirmed or refuted`,
        `${subject} ${object} official reference`,
      ]
    : [];

  const simplified = assessment.isBasicFact
    ? [
        `${subject} ${object}`,
        `${subject} fact`,
        `${object} reference`,
      ]
    : [];

  const capitalFallback = /\bcapital\b/i.test(claimText)
    ? [`capital of ${subject}`, `${subject} capital city`, `${subject} official capital`]
    : [];

  return [...new Set([...base, ...byType, ...decisive, ...simplified, ...capitalFallback].map((item) => item.trim()).filter((item) => item.length > 6))].slice(0, 10);
}
