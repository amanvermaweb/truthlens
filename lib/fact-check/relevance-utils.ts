import { ParsedClaim } from "@/lib/fact-check/pipeline/types";
import { clamp01, tokenize } from "@/lib/fact-check/claim-utils";
import { cosineSimilarity } from "@/lib/fact-check/embedding-utils";

function extractClaimSignals(claimText: string, parsedClaim: ParsedClaim | null) {
  const rawTokens = tokenize(claimText);
  const subjectTokens = tokenize(parsedClaim?.subject ?? rawTokens.slice(0, 3).join(" "));
  const objectTokens = tokenize(parsedClaim?.object ?? rawTokens.slice(-3).join(" "));
  const relationTokens = tokenize(parsedClaim?.predicate ?? claimText).filter((item) => !subjectTokens.includes(item));

  const relationSynonyms = new Set<string>(relationTokens);
  const text = claimText.toLowerCase();

  if (/(orbit|revolv|around)/i.test(text)) {
    ["orbit", "revolve", "around", "heliocentric"].forEach((item) => relationSynonyms.add(item));
  }
  if (/(increase|rise|grow)/i.test(text)) {
    ["increase", "rise", "growth", "higher"].forEach((item) => relationSynonyms.add(item));
  }
  if (/(decrease|fall|decline|drop)/i.test(text)) {
    ["decrease", "fall", "decline", "lower"].forEach((item) => relationSynonyms.add(item));
  }

  return {
    subjectTokens,
    objectTokens,
    relationTokens: [...relationSynonyms],
  };
}

function hasTokenOverlap(sourceTokens: Set<string>, tokens: string[], minimumMatches = 1) {
  let matches = 0;
  for (const token of tokens) {
    if (sourceTokens.has(token)) {
      matches += 1;
      if (matches >= minimumMatches) {
        return true;
      }
    }
  }

  return false;
}

export function passHardRelevanceFilter(claimText: string, parsedClaim: ParsedClaim | null, sourceText: string) {
  const sourceTokens = new Set(tokenize(sourceText));
  const signals = extractClaimSignals(claimText, parsedClaim);

  const subjectMatch = hasTokenOverlap(sourceTokens, signals.subjectTokens, 1);
  const objectMatch = hasTokenOverlap(sourceTokens, signals.objectTokens, 1);
  const relationMatch = hasTokenOverlap(sourceTokens, signals.relationTokens, 1);

  if (parsedClaim) {
    return subjectMatch && objectMatch && relationMatch;
  }

  const matches = [subjectMatch, objectMatch, relationMatch].filter(Boolean).length;
  return matches >= 2;
}

export function computeSourceRelevance(
  claimText: string,
  sourceText: string,
  claimEmbedding: number[],
  sourceEmbedding: number[],
  parsedClaim: ParsedClaim | null,
) {
  const semanticSimilarity = cosineSimilarity(claimEmbedding, sourceEmbedding);
  const claimSignals = extractClaimSignals(claimText, parsedClaim);
  const sourceTokens = new Set(tokenize(sourceText));

  const overlapTokens = [...claimSignals.subjectTokens, ...claimSignals.objectTokens];
  const overlap = overlapTokens.filter((token) => sourceTokens.has(token)).length;
  const lexicalOverlap = overlapTokens.length === 0 ? 0 : overlap / overlapTokens.length;
  const hardMatchBoost = passHardRelevanceFilter(claimText, parsedClaim, sourceText) ? 0.08 : 0;
  const blended = clamp01(semanticSimilarity * 0.8 + lexicalOverlap * 0.12 + hardMatchBoost);

  return {
    semanticSimilarity,
    relevanceScore: Math.round(blended * 100),
  };
}
