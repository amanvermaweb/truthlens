import { SourceReference } from "@/lib/types";
import { CommonKnowledgeResult, ParsedClaim } from "@/lib/fact-check/pipeline/types";
import {
  getBornInClaimParts,
  getCeoClaimParts,
  getDiedInClaimParts,
  getFounderClaimParts,
  getHeadquartersClaimParts,
  getOrbitClaimParts,
  getPresidentClaimParts,
  getPrimeMinisterClaimParts,
  getSpouseClaimParts,
  normalizeEntityName,
  normalizeLocationName,
} from "@/lib/fact-check/common-knowledge/parsers";
import { extractItemIdsFromClaims, getWikidataEntities, searchWikidataEntity } from "@/lib/fact-check/common-knowledge/wikidata";

type StructuredPropertyOverrideConfig = {
  id: string;
  propertyId: string;
  roleLabel: string;
  sourcePropertyDescription: string;
  parse: (inputText: string, parsedClaim: ParsedClaim | null) => { claimedValue: string; entity: string } | null;
  normalizeClaimedValue: (value: string) => string;
  normalizeExpectedValue: (value: string) => string;
};

async function commonKnowledgeStructuredPropertyOverride(
  inputText: string,
  parsedClaim: ParsedClaim | null,
  config: StructuredPropertyOverrideConfig,
): Promise<CommonKnowledgeResult | null> {
  const parts = config.parse(inputText, parsedClaim);
  if (!parts) {
    return null;
  }

  const entityName = parts.entity.trim();
  const claimedValue = parts.claimedValue.trim();
  if (!entityName || !claimedValue) {
    return null;
  }

  try {
    const entitySearch = await searchWikidataEntity(entityName);
    if (!entitySearch) {
      return null;
    }

    const entityPayload = await getWikidataEntities([entitySearch.id], "claims|labels");
    const entityData = entityPayload?.entities?.[entitySearch.id];
    if (!entityData?.claims) {
      return null;
    }

    const propertyValueIds = [...new Set(extractItemIdsFromClaims(entityData.claims, config.propertyId))].slice(0, 5);
    if (propertyValueIds.length === 0) {
      return null;
    }

    const valuePayload = await getWikidataEntities(propertyValueIds, "labels");
    const expectedValues = propertyValueIds
      .map((id) => valuePayload?.entities?.[id]?.labels?.en?.value?.trim())
      .filter((value): value is string => Boolean(value));

    if (expectedValues.length === 0) {
      return null;
    }

    const normalizedClaimed = config.normalizeClaimedValue(claimedValue);
    const normalizedExpected = expectedValues.map(config.normalizeExpectedValue);
    const isMatch = normalizedExpected.includes(normalizedClaimed);
    const expectedPrimary = expectedValues[0];
    const entityLabel = entityData.labels?.en?.value?.trim() || entitySearch.label || entityName;
    const relation: SourceReference["relation"] = isMatch ? "supports" : "contradicts";

    const sources: SourceReference[] = [
      {
        id: `ck-wikidata-${config.id}-${entitySearch.id}`,
        title: `${entityLabel} - Wikidata (${config.roleLabel})`,
        url: `https://www.wikidata.org/wiki/${entitySearch.id}`,
        publisher: "Wikidata",
        snippet: `${entityLabel} lists ${expectedPrimary} for ${config.roleLabel} via property ${config.propertyId} (${config.sourcePropertyDescription}).`,
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
      {
        id: `ck-wikipedia-${config.id}-${entitySearch.id}`,
        title: `${entityLabel} reference`,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(entityLabel)}`,
        publisher: "Wikipedia",
        snippet: `${entityLabel} references indicate ${expectedPrimary} for ${config.roleLabel}.`,
        relation,
        credibility: 92,
        tier: "Tier 1",
        domainAuthorityTier: "High",
        domainAuthority: 86,
        institutionalTrust: 84,
        citationSignal: 78,
        recencyScore: 84,
        agreementScore: isMatch ? 93 : 94,
        relevanceScore: 94,
        finalScore: 92,
        authorityScore: 88,
      },
    ];

    return {
      verdict: isMatch ? "True" : "False",
      confidence: isMatch ? 95 : 93,
      explanation: isMatch
        ? `Common-knowledge ${config.roleLabel} fact matched: ${expectedPrimary} is listed for ${entityLabel}.`
        : `Common-knowledge ${config.roleLabel} fact contradicts the claim: ${entityLabel} lists ${expectedPrimary}.`,
      sources,
    };
  } catch {
    return null;
  }
}

export async function commonKnowledgeCeoOverride(
  inputText: string,
  parsedClaim: ParsedClaim | null,
): Promise<CommonKnowledgeResult | null> {
  return commonKnowledgeStructuredPropertyOverride(inputText, parsedClaim, {
    id: "ceo",
    propertyId: "P169",
    roleLabel: "CEO",
    sourcePropertyDescription: "chief executive officer",
    parse: (text, parsed) => {
      const parts = getCeoClaimParts(text, parsed);
      if (!parts) {
        return null;
      }

      return {
        entity: parts.organization,
        claimedValue: parts.claimedPerson,
      };
    },
    normalizeClaimedValue: normalizeEntityName,
    normalizeExpectedValue: normalizeEntityName,
  });
}

export async function commonKnowledgeFounderOverride(
  inputText: string,
  parsedClaim: ParsedClaim | null,
): Promise<CommonKnowledgeResult | null> {
  return commonKnowledgeStructuredPropertyOverride(inputText, parsedClaim, {
    id: "founder",
    propertyId: "P112",
    roleLabel: "founder",
    sourcePropertyDescription: "founded by",
    parse: (text, parsed) => {
      const parts = getFounderClaimParts(text, parsed);
      if (!parts) {
        return null;
      }

      return {
        entity: parts.organization,
        claimedValue: parts.claimedPerson,
      };
    },
    normalizeClaimedValue: normalizeEntityName,
    normalizeExpectedValue: normalizeEntityName,
  });
}

export async function commonKnowledgePresidentOverride(
  inputText: string,
  parsedClaim: ParsedClaim | null,
): Promise<CommonKnowledgeResult | null> {
  return commonKnowledgeStructuredPropertyOverride(inputText, parsedClaim, {
    id: "president",
    propertyId: "P35",
    roleLabel: "president",
    sourcePropertyDescription: "head of state",
    parse: (text, parsed) => {
      const parts = getPresidentClaimParts(text, parsed);
      if (!parts) {
        return null;
      }

      return {
        entity: parts.entity,
        claimedValue: parts.claimedPerson,
      };
    },
    normalizeClaimedValue: normalizeEntityName,
    normalizeExpectedValue: normalizeEntityName,
  });
}

export async function commonKnowledgePrimeMinisterOverride(
  inputText: string,
  parsedClaim: ParsedClaim | null,
): Promise<CommonKnowledgeResult | null> {
  return commonKnowledgeStructuredPropertyOverride(inputText, parsedClaim, {
    id: "prime-minister",
    propertyId: "P6",
    roleLabel: "prime minister",
    sourcePropertyDescription: "head of government",
    parse: (text, parsed) => {
      const parts = getPrimeMinisterClaimParts(text, parsed);
      if (!parts) {
        return null;
      }

      return {
        entity: parts.entity,
        claimedValue: parts.claimedPerson,
      };
    },
    normalizeClaimedValue: normalizeEntityName,
    normalizeExpectedValue: normalizeEntityName,
  });
}

export async function commonKnowledgeHeadquartersOverride(
  inputText: string,
  parsedClaim: ParsedClaim | null,
): Promise<CommonKnowledgeResult | null> {
  return commonKnowledgeStructuredPropertyOverride(inputText, parsedClaim, {
    id: "headquarters",
    propertyId: "P159",
    roleLabel: "headquarters",
    sourcePropertyDescription: "headquarters location",
    parse: (text, parsed) => {
      const parts = getHeadquartersClaimParts(text, parsed);
      if (!parts) {
        return null;
      }

      return {
        entity: parts.entity,
        claimedValue: parts.claimedLocation,
      };
    },
    normalizeClaimedValue: normalizeLocationName,
    normalizeExpectedValue: normalizeLocationName,
  });
}

export async function commonKnowledgeBornInOverride(
  inputText: string,
  parsedClaim: ParsedClaim | null,
): Promise<CommonKnowledgeResult | null> {
  return commonKnowledgeStructuredPropertyOverride(inputText, parsedClaim, {
    id: "born-in",
    propertyId: "P19",
    roleLabel: "place of birth",
    sourcePropertyDescription: "place of birth",
    parse: (text, parsed) => {
      const parts = getBornInClaimParts(text, parsed);
      if (!parts) {
        return null;
      }

      return {
        entity: parts.person,
        claimedValue: parts.claimedLocation,
      };
    },
    normalizeClaimedValue: normalizeLocationName,
    normalizeExpectedValue: normalizeLocationName,
  });
}

export async function commonKnowledgeDiedInOverride(
  inputText: string,
  parsedClaim: ParsedClaim | null,
): Promise<CommonKnowledgeResult | null> {
  return commonKnowledgeStructuredPropertyOverride(inputText, parsedClaim, {
    id: "died-in",
    propertyId: "P20",
    roleLabel: "place of death",
    sourcePropertyDescription: "place of death",
    parse: (text, parsed) => {
      const parts = getDiedInClaimParts(text, parsed);
      if (!parts) {
        return null;
      }

      return {
        entity: parts.person,
        claimedValue: parts.claimedLocation,
      };
    },
    normalizeClaimedValue: normalizeLocationName,
    normalizeExpectedValue: normalizeLocationName,
  });
}

export async function commonKnowledgeSpouseOverride(
  inputText: string,
  parsedClaim: ParsedClaim | null,
): Promise<CommonKnowledgeResult | null> {
  return commonKnowledgeStructuredPropertyOverride(inputText, parsedClaim, {
    id: "spouse",
    propertyId: "P26",
    roleLabel: "spouse",
    sourcePropertyDescription: "spouse",
    parse: (text, parsed) => {
      const parts = getSpouseClaimParts(text, parsed);
      if (!parts) {
        return null;
      }

      return {
        entity: parts.person,
        claimedValue: parts.claimedSpouse,
      };
    },
    normalizeClaimedValue: normalizeEntityName,
    normalizeExpectedValue: normalizeEntityName,
  });
}

export async function commonKnowledgeOrbitOverride(
  inputText: string,
  parsedClaim: ParsedClaim | null,
): Promise<CommonKnowledgeResult | null> {
  return commonKnowledgeStructuredPropertyOverride(inputText, parsedClaim, {
    id: "orbits",
    propertyId: "P397",
    roleLabel: "orbital center",
    sourcePropertyDescription: "astronomical body orbits",
    parse: (text, parsed) => {
      const parts = getOrbitClaimParts(text, parsed);
      if (!parts) {
        return null;
      }

      return {
        entity: parts.body,
        claimedValue: parts.claimedCenter,
      };
    },
    normalizeClaimedValue: normalizeEntityName,
    normalizeExpectedValue: normalizeEntityName,
  });
}
