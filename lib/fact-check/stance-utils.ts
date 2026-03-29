import { ParsedClaim } from "@/lib/fact-check/pipeline/types";

import { parseClaimStructure, tokenize } from "@/lib/fact-check/claim-utils";

export type SourceStance = "support" | "contradict" | "neutral";

function detectContradiction(claimText: string, evidenceText: string) {
  const claim = ` ${claimText.toLowerCase()} `;
  const evidence = ` ${evidenceText.toLowerCase()} `;

  const oppositeConcepts: Array<[string[], string[]]> = [
    [["dead", "deceased", "died"], ["alive", "living", "still alive", "continues to"]],
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

export function detectStance(claim: string, content: string): SourceStance {
  const normalizedClaim = claim.toLowerCase();
  const normalizedContent = content.toLowerCase();

  const claimParsed = parseClaimStructure(claim);
  if (claimParsed && /\bcapital\b/i.test(normalizedClaim)) {
    const subject = claimParsed.subject.toLowerCase();
    const claimedObject = claimParsed.object.toLowerCase();
    const mentionsSubject = normalizedContent.includes(subject);
    const mentionsCapital = /\bcapital\b/.test(normalizedContent);
    const isDefinitionalCapitalStatement =
      /\b(is|was)\s+the\s+capital\s+of\b/.test(normalizedContent) ||
      /\bcapital\s+of\s+[^.?!,;]{2,60}\s+\b(is|was)\b/.test(normalizedContent);
    const mentionsClaimedObject = claimedObject
      .split(/\s+/)
      .filter(Boolean)
      .some((token) => token.length > 2 && normalizedContent.includes(token));

    if (mentionsSubject && mentionsCapital && isDefinitionalCapitalStatement && !mentionsClaimedObject) {
      return "contradict";
    }
  }

  if (detectContradiction(normalizedClaim, normalizedContent)) {
    return "contradict";
  }

  const claimTokens = new Set(tokenize(normalizedClaim));
  const contentTokens = new Set(tokenize(normalizedContent));
  const overlap = [...claimTokens].filter((token) => contentTokens.has(token)).length;
  const overlapRatio = claimTokens.size === 0 ? 0 : overlap / claimTokens.size;
  const hasDirectNegation =
    /\b(not|no|never|false|incorrect|debunked|untrue)\b/i.test(normalizedContent) && overlapRatio > 0.35;

  const deadClaim = /\b(is|was|has been)?\s*(dead|deceased|died)\b/.test(normalizedClaim);
  const aliveClaim = /\b(is|was|has been)?\s*(alive|living)\b/.test(normalizedClaim);
  const evidenceSaysAlive = /\b(alive|living|still alive|is alive|remains alive)\b/.test(normalizedContent);
  const evidenceSaysDead = /\b(dead|deceased|died|death announced|obituary)\b/.test(normalizedContent);

  if ((deadClaim && evidenceSaysAlive) || (aliveClaim && evidenceSaysDead)) {
    return "contradict";
  }

  if ((deadClaim && evidenceSaysDead) || (aliveClaim && evidenceSaysAlive)) {
    return "support";
  }

  if (hasDirectNegation) {
    return "contradict";
  }

  if (overlapRatio >= 0.35) {
    return "support";
  }

  return "neutral";
}

export function evaluateRelation(
  claimText: string,
  parsedClaim: ParsedClaim | null,
  evidenceText: string,
): "supports" | "contradicts" | "neutral" {
  const stance = detectStance(
    parsedClaim ? `${parsedClaim.subject} ${parsedClaim.predicate} ${parsedClaim.object}` : claimText,
    evidenceText,
  );

  if (stance === "support") {
    return "supports";
  }

  if (stance === "contradict") {
    return "contradicts";
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
