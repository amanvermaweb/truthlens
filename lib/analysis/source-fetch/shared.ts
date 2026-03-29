import { SourceReference } from "@/lib/types";
import { createHash } from "node:crypto";

import {
  clamp01,
  ParsedClaim,
  tokenize,
} from "@/lib/analysis/input";

export type IndicatorConfig = {
  code: string;
  label: string;
};

const REQUEST_TIMEOUT_MS = 3000;

export function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function fetchWithTimeout(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timeout);
  }
}

export function computeTrustScore(url: string, publisher: string) {
  const host = (() => {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();

  const trustedHosts = [
    "wikipedia.org",
    "wikidata.org",
    "reuters.com",
    "apnews.com",
    "bbc.com",
    "nytimes.com",
    "worldbank.org",
    "who.int",
    "imf.org",
    "un.org",
    "unstats.un.org",
  ];

  if (trustedHosts.some((entry) => host.endsWith(entry))) {
    return 0.9;
  }

  if (publisher.toLowerCase().includes("news")) {
    return 0.68;
  }

  return 0.55;
}

export function computeEvidenceQuality(title: string, snippet: string) {
  const text = `${title} ${snippet}`.trim();
  const lengthScore = clamp01(text.length / 220);
  const hasNumbers = /\d/.test(text) ? 0.15 : 0;
  const hasConcreteSignal = /(report|study|data|according|official|estimated|net worth|valuation)/i.test(
    text,
  )
    ? 0.2
    : 0;

  return clamp01(0.35 + lengthScore * 0.4 + hasNumbers + hasConcreteSignal);
}

function detectContradiction(claimText: string, evidenceText: string) {
  const claim = ` ${claimText.toLowerCase()} `;
  const evidence = ` ${evidenceText.toLowerCase()} `;

  const oppositeConcepts: Array<[string[], string[]]> = [
    [["poor", "broke", "insolvent"], ["billionaire", "rich", "wealthy", "net worth"]],
    [["increase", "up", "rose", "growth"], ["decrease", "down", "fell", "decline"]],
    [["won", "victory"], ["lost", "defeat"]],
    [["safe"], ["dangerous", "unsafe"]],
  ];

  for (const [left, right] of oppositeConcepts) {
    const claimHasLeft = left.some((term) => claim.includes(` ${term} `));
    const claimHasRight = right.some((term) => claim.includes(` ${term} `));
    const evidenceHasLeft = left.some((term) => evidence.includes(` ${term} `));
    const evidenceHasRight = right.some((term) => evidence.includes(` ${term} `));

    if ((claimHasLeft && evidenceHasRight) || (claimHasRight && evidenceHasLeft)) {
      return true;
    }
  }

  return false;
}

export function evaluateRelation(
  claimText: string,
  parsedClaim: ParsedClaim | null,
  evidenceText: string,
): "supports" | "contradicts" | "neutral" {
  if (detectContradiction(claimText, evidenceText)) {
    return "contradicts";
  }

  const claimTokens = new Set(tokenize(parsedClaim?.object ?? claimText));
  const evidenceTokens = new Set(tokenize(evidenceText));

  let overlap = 0;
  for (const token of claimTokens) {
    if (evidenceTokens.has(token)) {
      overlap += 1;
    }
  }

  if (overlap >= 2) {
    return "supports";
  }

  if (parsedClaim) {
    const subjectMentioned = evidenceText.toLowerCase().includes(parsedClaim.subject.toLowerCase());
    const negated = /\b(not|no|never|without|false)\b/i.test(evidenceText);

    if (subjectMentioned && negated && overlap === 0) {
      return "contradicts";
    }

    if (subjectMentioned && overlap >= 1) {
      return "supports";
    }
  }

  return "neutral";
}

export function computeAgreementScore(relation: "supports" | "contradicts" | "neutral") {
  if (relation === "supports") {
    return 0.8;
  }

  if (relation === "contradicts") {
    return 0.95;
  }

  return 0.4;
}

export function pickIndicatorByClaim(
  queryText: string,
  options: {
    inflation: IndicatorConfig;
    population: IndicatorConfig;
    gdp: IndicatorConfig;
    unemployment: IndicatorConfig;
    health: IndicatorConfig;
  },
) {
  const text = queryText.toLowerCase();

  if (/(inflation|cpi|prices|cost of living)/i.test(text)) {
    return options.inflation;
  }

  if (/(population|people|demograph)/i.test(text)) {
    return options.population;
  }

  if (/(gdp|econom|growth|recession|output)/i.test(text)) {
    return options.gdp;
  }

  if (/(unemploy|labor|employment|jobs)/i.test(text)) {
    return options.unemployment;
  }

  return options.health;
}

export function buildSourceReference(
  idPrefix: string,
  idSeed: string,
  title: string,
  url: string,
  publisher: string,
  snippet: string,
  queryText: string,
  parsedClaim: ParsedClaim | null,
) {
  const relation = evaluateRelation(queryText, parsedClaim, `${title} ${snippet}`);
  const trust = computeTrustScore(url, publisher);
  const quality = computeEvidenceQuality(title, snippet);
  const agreement = computeAgreementScore(relation);

  return {
    id: `${idPrefix}-${hashValue(idSeed).slice(0, 8)}`,
    title,
    url,
    publisher,
    snippet,
    relation,
    credibility: Math.round((trust * 0.5 + quality * 0.25 + agreement * 0.25) * 100),
  } satisfies SourceReference;
}
