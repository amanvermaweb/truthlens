import { SourceReference } from "@/lib/types";
import { CommonKnowledgeResult, ParsedClaim } from "@/lib/fact-check/pipeline/types";
import {
  getAtomicNumberClaimParts,
  getScienceIsAClaimParts,
  SCIENCE_CLASS_MAP,
} from "@/lib/fact-check/common-knowledge/parsers";
import {
  extractItemIdsFromClaims,
  extractNumericClaimValues,
  getWikidataEntities,
  searchWikidataEntity,
} from "@/lib/fact-check/common-knowledge/wikidata";

export async function commonKnowledgeScienceIsAOverride(
  inputText: string,
  parsedClaim: ParsedClaim | null,
): Promise<CommonKnowledgeResult | null> {
  const parts = getScienceIsAClaimParts(inputText, parsedClaim);
  if (!parts) {
    return null;
  }

  const mappedClass = SCIENCE_CLASS_MAP.find((item) => item.claimLabel === parts.claimedClass);
  if (!mappedClass) {
    return null;
  }

  try {
    const entitySearch = await searchWikidataEntity(parts.entity);
    if (!entitySearch) {
      return null;
    }

    const entityPayload = await getWikidataEntities([entitySearch.id], "claims|labels");
    const entityData = entityPayload?.entities?.[entitySearch.id];
    if (!entityData?.claims) {
      return null;
    }

    const instanceIds = extractItemIdsFromClaims(entityData.claims, "P31");
    if (instanceIds.length === 0) {
      return null;
    }

    const isMatch = instanceIds.includes(mappedClass.qid);
    const relation: SourceReference["relation"] = isMatch ? "supports" : "contradicts";
    const entityLabel = entityData.labels?.en?.value?.trim() || entitySearch.label || parts.entity;

    const sources: SourceReference[] = [
      {
        id: `ck-wikidata-science-class-${entitySearch.id}`,
        title: `${entityLabel} - Wikidata (instance of)`,
        url: `https://www.wikidata.org/wiki/${entitySearch.id}`,
        publisher: "Wikidata",
        snippet: `${entityLabel} instance-of (P31) data ${isMatch ? "matches" : "does not match"} class '${mappedClass.claimLabel}'.`,
        relation,
        credibility: 95,
        tier: "Tier 1",
        domainAuthorityTier: "High",
        domainAuthority: 88,
        institutionalTrust: 90,
        citationSignal: 84,
        recencyScore: 88,
        agreementScore: isMatch ? 95 : 96,
        relevanceScore: 97,
        finalScore: 95,
        authorityScore: 92,
      },
    ];

    return {
      verdict: isMatch ? "True" : "False",
      confidence: isMatch ? 95 : 93,
      explanation: isMatch
        ? `Common-knowledge science class fact matched: ${entityLabel} is a ${mappedClass.claimLabel}.`
        : `Common-knowledge science class fact contradicts the claim: ${entityLabel} is not a ${mappedClass.claimLabel}.`,
      sources,
    };
  } catch {
    return null;
  }
}

export async function commonKnowledgeAtomicNumberOverride(
  inputText: string,
  parsedClaim: ParsedClaim | null,
): Promise<CommonKnowledgeResult | null> {
  const parts = getAtomicNumberClaimParts(inputText, parsedClaim);
  if (!parts) {
    return null;
  }

  try {
    const entitySearch = await searchWikidataEntity(parts.entity);
    if (!entitySearch) {
      return null;
    }

    const entityPayload = await getWikidataEntities([entitySearch.id], "claims|labels");
    const entityData = entityPayload?.entities?.[entitySearch.id];
    if (!entityData?.claims) {
      return null;
    }

    const knownAtomicNumbers = extractNumericClaimValues(entityData.claims, "P1086");
    if (knownAtomicNumbers.length === 0) {
      return null;
    }

    const isMatch = knownAtomicNumbers.includes(parts.claimedAtomicNumber);
    const relation: SourceReference["relation"] = isMatch ? "supports" : "contradicts";
    const entityLabel = entityData.labels?.en?.value?.trim() || entitySearch.label || parts.entity;
    const canonicalAtomicNumber = knownAtomicNumbers[0];

    const sources: SourceReference[] = [
      {
        id: `ck-wikidata-atomic-number-${entitySearch.id}`,
        title: `${entityLabel} - Wikidata (atomic number)`,
        url: `https://www.wikidata.org/wiki/${entitySearch.id}`,
        publisher: "Wikidata",
        snippet: `${entityLabel} lists atomic number ${canonicalAtomicNumber} via property P1086.`,
        relation,
        credibility: 96,
        tier: "Tier 1",
        domainAuthorityTier: "High",
        domainAuthority: 88,
        institutionalTrust: 90,
        citationSignal: 86,
        recencyScore: 90,
        agreementScore: isMatch ? 96 : 97,
        relevanceScore: 98,
        finalScore: 96,
        authorityScore: 92,
      },
    ];

    return {
      verdict: isMatch ? "True" : "False",
      confidence: isMatch ? 97 : 95,
      explanation: isMatch
        ? `Common-knowledge atomic-number fact matched: ${entityLabel} has atomic number ${parts.claimedAtomicNumber}.`
        : `Common-knowledge atomic-number fact contradicts the claim: ${entityLabel} has atomic number ${canonicalAtomicNumber}.`,
      sources,
    };
  } catch {
    return null;
  }
}
