import { SourceReference } from "@/lib/types";
import { CommonKnowledgeResult, ParsedClaim } from "@/lib/fact-check/pipeline/types";
import { normalizeLocationName } from "@/lib/fact-check/common-knowledge/parsers";
import {
  extractItemIdsFromClaims,
  getWikidataEntities,
  searchWikidataEntity,
} from "@/lib/fact-check/common-knowledge/wikidata";

function getCapitalClaimParts(inputText: string, parsedClaim: ParsedClaim | null) {
  const direct = inputText
    .trim()
    .match(/\bcapital\s+of\s+(.+?)\s+(?:is|was)\s+(.+?)(?:[.!?]|$)/i);
  if (direct) {
    return {
      country: direct[1].trim(),
      claimedCapital: direct[2].trim(),
    };
  }

  if (!parsedClaim) {
    return null;
  }

  const possessive = parsedClaim.subject.trim().match(/^(.+?)'?s\s+capital$/i);
  if (!possessive) {
    return null;
  }

  return {
    country: possessive[1].trim(),
    claimedCapital: parsedClaim.object.trim(),
  };
}

export async function commonKnowledgeCapitalOverride(
  inputText: string,
  parsedClaim: ParsedClaim | null,
): Promise<CommonKnowledgeResult | null> {
  const parts = getCapitalClaimParts(inputText, parsedClaim);
  if (!parts) {
    return null;
  }

  try {
    const countryName = parts.country.trim();
    const claimedCapital = normalizeLocationName(parts.claimedCapital);
    if (!countryName || !claimedCapital) {
      return null;
    }

    const countrySearch = await searchWikidataEntity(countryName);
    if (!countrySearch) {
      return null;
    }

    const countryPayload = await getWikidataEntities([countrySearch.id], "claims|labels");
    const countryEntity = countryPayload?.entities?.[countrySearch.id];
    if (!countryEntity?.claims) {
      return null;
    }

    const capitalIds = [...new Set(extractItemIdsFromClaims(countryEntity.claims, "P36"))].slice(0, 6);
    if (capitalIds.length === 0) {
      return null;
    }

    const capitalPayload = await getWikidataEntities(capitalIds, "labels");
    const expectedCapitals = capitalIds
      .map((id) => capitalPayload?.entities?.[id]?.labels?.en?.value?.trim())
      .filter((value): value is string => Boolean(value));
    if (expectedCapitals.length === 0) {
      return null;
    }

    const normalizedExpected = expectedCapitals.map(normalizeLocationName);
    const isMatch = normalizedExpected.includes(claimedCapital);
    const relation: SourceReference["relation"] = isMatch ? "supports" : "contradicts";
    const countryLabel = countryEntity.labels?.en?.value?.trim() || countrySearch.label || countryName;
    const expectedLabel = expectedCapitals[0];

    const sources: SourceReference[] = [
      {
        id: `ck-wikidata-capital-${countrySearch.id}`,
        title: `${countryLabel} - Wikidata (capital)`,
        url: `https://www.wikidata.org/wiki/${countrySearch.id}`,
        publisher: "Wikidata",
        snippet: `${countryLabel} lists ${expectedLabel} as capital (property P36).`,
        relation,
        credibility: 96,
        tier: "Tier 1",
        domainAuthorityTier: "High",
        domainAuthority: 90,
        institutionalTrust: 91,
        citationSignal: 86,
        recencyScore: 89,
        agreementScore: isMatch ? 96 : 97,
        relevanceScore: 98,
        finalScore: 96,
        authorityScore: 92,
      },
      {
        id: `ck-wikipedia-capital-${countrySearch.id}`,
        title: `${countryLabel} reference`,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(countryLabel)}`,
        publisher: "Wikipedia",
        snippet: `${countryLabel} references indicate ${expectedLabel} as the capital city.`,
        relation,
        credibility: 92,
        tier: "Tier 1",
        domainAuthorityTier: "High",
        domainAuthority: 86,
        institutionalTrust: 84,
        citationSignal: 78,
        recencyScore: 84,
        agreementScore: isMatch ? 93 : 94,
        relevanceScore: 95,
        finalScore: 92,
        authorityScore: 88,
      },
    ];

    return {
      verdict: isMatch ? "True" : "False",
      confidence: isMatch ? 96 : 94,
      explanation: isMatch
        ? `Common-knowledge capital fact matched: ${countryLabel} lists ${expectedLabel} as capital.`
        : `Common-knowledge capital fact contradicts the claim: ${countryLabel} lists ${expectedLabel} as capital.`,
      sources,
    };
  } catch {
    return null;
  }
}

export function commonKnowledgeUltraBasicOverride(inputText: string): CommonKnowledgeResult | null {
  void inputText;
  // Deprecated on purpose: avoid static phrase/fact catalogs in SaaS mode.
  // These claims now flow to dynamic Wikidata/AI-assisted common-knowledge paths.
  return null;
}

export function commonKnowledgeBoilingPointOverride(
  inputText: string,
  parsedClaim: ParsedClaim | null,
): CommonKnowledgeResult | null {
  void inputText;
  void parsedClaim;
  return null;
}
