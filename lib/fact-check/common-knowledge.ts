import { SourceReference } from "@/lib/types";
import { CommonKnowledgeResult, ParsedClaim } from "@/lib/fact-check/pipeline/types";
import {
  commonKnowledgeBoilingPointOverride,
  commonKnowledgeCapitalOverride,
  commonKnowledgeUltraBasicOverride,
} from "@/lib/fact-check/common-knowledge-basic";

export {
  commonKnowledgeBoilingPointOverride,
  commonKnowledgeCapitalOverride,
  commonKnowledgeUltraBasicOverride,
};

const REQUEST_TIMEOUT_MS = 3000;

async function fetchWithTimeout(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function getCeoClaimParts(inputText: string, parsedClaim: ParsedClaim | null) {
  const direct = inputText
    .trim()
    .match(/^(.+?)\s+(?:is|was)\s+(?:the\s+)?ceo\s+of\s+(.+?)(?:[.!?]|$)/i);
  if (direct) {
    return {
      claimedPerson: direct[1].trim(),
      organization: direct[2].trim(),
    };
  }

  const possessive = inputText
    .trim()
    .match(/^(.+?)'?s\s+ceo\s+(?:is|was)\s+(.+?)(?:[.!?]|$)/i);
  if (possessive) {
    return {
      claimedPerson: possessive[2].trim(),
      organization: possessive[1].trim(),
    };
  }

  if (!parsedClaim) {
    return null;
  }

  if (!/\bceo\b/i.test(parsedClaim.object) && !/\bceo\b/i.test(parsedClaim.subject)) {
    return null;
  }

  const parsedDirect = parsedClaim.object.match(/^(?:the\s+)?ceo\s+of\s+(.+)$/i);
  if (parsedDirect) {
    return {
      claimedPerson: parsedClaim.subject.trim(),
      organization: parsedDirect[1].trim(),
    };
  }

  const parsedPossessive = parsedClaim.subject.match(/^(.+?)'?s\s+ceo$/i);
  if (parsedPossessive) {
    return {
      claimedPerson: parsedClaim.object.trim(),
      organization: parsedPossessive[1].trim(),
    };
  }

  return null;
}

function getFounderClaimParts(inputText: string, parsedClaim: ParsedClaim | null) {
  const direct = inputText
    .trim()
    .match(/^(.+?)\s+(?:is|was)\s+(?:(?:the|a|an)\s+)?founder\s+of\s+(.+?)(?:[.!?]|$)/i);
  if (direct) {
    return {
      claimedPerson: direct[1].trim(),
      organization: direct[2].trim(),
    };
  }

  const possessive = inputText
    .trim()
    .match(/^(.+?)'?s\s+founder\s+(?:is|was)\s+(.+?)(?:[.!?]|$)/i);
  if (possessive) {
    return {
      claimedPerson: possessive[2].trim(),
      organization: possessive[1].trim(),
    };
  }

  if (!parsedClaim) {
    return null;
  }

  if (!/\bfounder\b/i.test(parsedClaim.object) && !/\bfounder\b/i.test(parsedClaim.subject)) {
    return null;
  }

  const parsedDirect = parsedClaim.object.match(/^(?:the\s+)?founder\s+of\s+(.+)$/i);
  if (parsedDirect) {
    return {
      claimedPerson: parsedClaim.subject.trim(),
      organization: parsedDirect[1].trim(),
    };
  }

  const parsedPossessive = parsedClaim.subject.match(/^(.+?)'?s\s+founder$/i);
  if (parsedPossessive) {
    return {
      claimedPerson: parsedClaim.object.trim(),
      organization: parsedPossessive[1].trim(),
    };
  }

  return null;
}

function getPresidentClaimParts(inputText: string, parsedClaim: ParsedClaim | null) {
  const direct = inputText
    .trim()
    .match(/^(.+?)\s+(?:is|was)\s+(?:the\s+)?president\s+of\s+(.+?)(?:[.!?]|$)/i);
  if (direct) {
    return {
      claimedPerson: direct[1].trim(),
      entity: direct[2].trim(),
    };
  }

  const possessive = inputText
    .trim()
    .match(/^(.+?)'?s\s+president\s+(?:is|was)\s+(.+?)(?:[.!?]|$)/i);
  if (possessive) {
    return {
      claimedPerson: possessive[2].trim(),
      entity: possessive[1].trim(),
    };
  }

  if (!parsedClaim) {
    return null;
  }

  if (!/\bpresident\b/i.test(parsedClaim.object) && !/\bpresident\b/i.test(parsedClaim.subject)) {
    return null;
  }

  const parsedDirect = parsedClaim.object.match(/^(?:the\s+)?president\s+of\s+(.+)$/i);
  if (parsedDirect) {
    return {
      claimedPerson: parsedClaim.subject.trim(),
      entity: parsedDirect[1].trim(),
    };
  }

  const parsedPossessive = parsedClaim.subject.match(/^(.+?)'?s\s+president$/i);
  if (parsedPossessive) {
    return {
      claimedPerson: parsedClaim.object.trim(),
      entity: parsedPossessive[1].trim(),
    };
  }

  return null;
}

function getPrimeMinisterClaimParts(inputText: string, parsedClaim: ParsedClaim | null) {
  const direct = inputText
    .trim()
    .match(/^(.+?)\s+(?:is|was)\s+(?:the\s+)?prime\s+minister\s+of\s+(.+?)(?:[.!?]|$)/i);
  if (direct) {
    return {
      claimedPerson: direct[1].trim(),
      entity: direct[2].trim(),
    };
  }

  const possessive = inputText
    .trim()
    .match(/^(.+?)'?s\s+prime\s+minister\s+(?:is|was)\s+(.+?)(?:[.!?]|$)/i);
  if (possessive) {
    return {
      claimedPerson: possessive[2].trim(),
      entity: possessive[1].trim(),
    };
  }

  if (!parsedClaim) {
    return null;
  }

  if (!/\bprime\s+minister\b/i.test(parsedClaim.object) && !/\bprime\s+minister\b/i.test(parsedClaim.subject)) {
    return null;
  }

  const parsedDirect = parsedClaim.object.match(/^(?:the\s+)?prime\s+minister\s+of\s+(.+)$/i);
  if (parsedDirect) {
    return {
      claimedPerson: parsedClaim.subject.trim(),
      entity: parsedDirect[1].trim(),
    };
  }

  const parsedPossessive = parsedClaim.subject.match(/^(.+?)'?s\s+prime\s+minister$/i);
  if (parsedPossessive) {
    return {
      claimedPerson: parsedClaim.object.trim(),
      entity: parsedPossessive[1].trim(),
    };
  }

  return null;
}

function getHeadquartersClaimParts(inputText: string, parsedClaim: ParsedClaim | null) {
  const direct = inputText
    .trim()
    .match(/^(.+?)\s+(?:is|was)\s+headquartered\s+in\s+(.+?)(?:[.!?]|$)/i);
  if (direct) {
    return {
      entity: direct[1].trim(),
      claimedLocation: direct[2].trim(),
    };
  }

  const inverse = inputText
    .trim()
    .match(/^headquarters\s+of\s+(.+?)\s+(?:is|was|are)\s+(.+?)(?:[.!?]|$)/i);
  if (inverse) {
    return {
      entity: inverse[1].trim(),
      claimedLocation: inverse[2].trim(),
    };
  }

  const possessive = inputText
    .trim()
    .match(/^(.+?)'?s\s+headquarters\s+(?:is|was|are)\s+(.+?)(?:[.!?]|$)/i);
  if (possessive) {
    return {
      entity: possessive[1].trim(),
      claimedLocation: possessive[2].trim(),
    };
  }

  if (!parsedClaim) {
    return null;
  }

  const parsedHeadquartered = parsedClaim.object.match(/^headquartered\s+in\s+(.+)$/i);
  if (parsedHeadquartered) {
    return {
      entity: parsedClaim.subject.trim(),
      claimedLocation: parsedHeadquartered[1].trim(),
    };
  }

  const parsedInverse = parsedClaim.subject.match(/^headquarters\s+of\s+(.+)$/i);
  if (parsedInverse) {
    return {
      entity: parsedInverse[1].trim(),
      claimedLocation: parsedClaim.object.trim(),
    };
  }

  return null;
}

function getBornInClaimParts(inputText: string, parsedClaim: ParsedClaim | null) {
  const direct = inputText
    .trim()
    .match(/^(.+?)\s+(?:is|was)?\s*born\s+in\s+(.+?)(?:[.!?]|$)/i);
  if (direct) {
    return {
      person: direct[1].trim(),
      claimedLocation: direct[2].trim(),
    };
  }

  if (!parsedClaim) {
    return null;
  }

  const parsedDirect = parsedClaim.object.match(/^born\s+in\s+(.+)$/i);
  if (parsedDirect) {
    return {
      person: parsedClaim.subject.trim(),
      claimedLocation: parsedDirect[1].trim(),
    };
  }

  return null;
}

function getDiedInClaimParts(inputText: string, parsedClaim: ParsedClaim | null) {
  const direct = inputText
    .trim()
    .match(/^(.+?)\s+(?:is|was)?\s*(?:died|dead)\s+in\s+(.+?)(?:[.!?]|$)/i);
  if (direct) {
    return {
      person: direct[1].trim(),
      claimedLocation: direct[2].trim(),
    };
  }

  if (!parsedClaim) {
    return null;
  }

  const parsedDirect = parsedClaim.object.match(/^(?:died|dead)\s+in\s+(.+)$/i);
  if (parsedDirect) {
    return {
      person: parsedClaim.subject.trim(),
      claimedLocation: parsedDirect[1].trim(),
    };
  }

  return null;
}

function getSpouseClaimParts(inputText: string, parsedClaim: ParsedClaim | null) {
  const directSpouse = inputText
    .trim()
    .match(/^(.+?)\s+(?:is|was)\s+(?:the\s+)?spouse\s+of\s+(.+?)(?:[.!?]|$)/i);
  if (directSpouse) {
    return {
      person: directSpouse[1].trim(),
      claimedSpouse: directSpouse[2].trim(),
    };
  }

  const marriedTo = inputText
    .trim()
    .match(/^(.+?)\s+(?:is|was)\s+married\s+to\s+(.+?)(?:[.!?]|$)/i);
  if (marriedTo) {
    return {
      person: marriedTo[1].trim(),
      claimedSpouse: marriedTo[2].trim(),
    };
  }

  const possessive = inputText
    .trim()
    .match(/^(.+?)'?s\s+spouse\s+(?:is|was)\s+(.+?)(?:[.!?]|$)/i);
  if (possessive) {
    return {
      person: possessive[1].trim(),
      claimedSpouse: possessive[2].trim(),
    };
  }

  if (!parsedClaim) {
    return null;
  }

  const parsedSpouseOf = parsedClaim.object.match(/^(?:the\s+)?spouse\s+of\s+(.+)$/i);
  if (parsedSpouseOf) {
    return {
      person: parsedClaim.subject.trim(),
      claimedSpouse: parsedSpouseOf[1].trim(),
    };
  }

  const parsedMarriedTo = parsedClaim.object.match(/^married\s+to\s+(.+)$/i);
  if (parsedMarriedTo) {
    return {
      person: parsedClaim.subject.trim(),
      claimedSpouse: parsedMarriedTo[1].trim(),
    };
  }

  return null;
}

function getOrbitClaimParts(inputText: string, parsedClaim: ParsedClaim | null) {
  const direct = inputText
    .trim()
    .match(/^(.+?)\s+(?:revolves?|orbits?)\s+around\s+(.+?)(?:[.!?]|$)/i);
  if (direct) {
    return {
      body: direct[1].trim(),
      claimedCenter: direct[2].trim(),
    };
  }

  if (!parsedClaim) {
    return null;
  }

  const parsedAround = parsedClaim.object.match(/^around\s+(.+)$/i);
  if (parsedAround && /\b(revolve|orbit)\b/i.test(parsedClaim.predicate)) {
    return {
      body: parsedClaim.subject.trim(),
      claimedCenter: parsedAround[1].trim(),
    };
  }

  return null;
}

function getLifeStatusClaimParts(inputText: string, parsedClaim: ParsedClaim | null) {
  const direct = inputText
    .trim()
    .match(/^(.+?)\s+(?:is|was|has been)\s+(dead|deceased|alive|living)(?:[.!?]|$)/i);
  if (direct) {
    const status = /dead|deceased/i.test(direct[2]) ? "dead" : "alive";
    return {
      person: direct[1].trim(),
      claimedStatus: status as "dead" | "alive",
    };
  }

  if (!parsedClaim) {
    return null;
  }

  const objectText = `${parsedClaim.predicate} ${parsedClaim.object}`.toLowerCase();
  if (/\b(dead|deceased|died)\b/.test(objectText)) {
    return {
      person: parsedClaim.subject.trim(),
      claimedStatus: "dead" as const,
    };
  }

  if (/\b(alive|living)\b/.test(objectText)) {
    return {
      person: parsedClaim.subject.trim(),
      claimedStatus: "alive" as const,
    };
  }

  return null;
}

function normalizeEntityName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(the|inc|llc|ltd|corp|corporation|company|plc)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLocationName(value: string) {
  return value
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(the|city|state|province)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type WikidataEntitySearch = {
  id: string;
  label: string;
};

async function searchWikidataEntity(query: string): Promise<WikidataEntitySearch | null> {
  const searchResponse = await fetchWithTimeout(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}&language=en&format=json&limit=1&type=item`,
  );
  if (!searchResponse.ok) {
    return null;
  }

  const payload = (await searchResponse.json()) as {
    search?: Array<{ id?: string; label?: string }>;
  };
  const hit = payload.search?.[0];
  if (!hit?.id) {
    return null;
  }

  return {
    id: hit.id,
    label: hit.label ?? query,
  };
}

async function getWikidataEntities(
  ids: string[],
  props: "claims|labels" | "labels" = "claims|labels",
) {
  if (ids.length === 0) {
    return null;
  }

  const response = await fetchWithTimeout(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(ids.join("|"))}&format=json&props=${encodeURIComponent(props)}`,
  );
  if (!response.ok) {
    return null;
  }

  return (await response.json()) as {
    entities?: Record<string, {
      claims?: Record<string, Array<{
        mainsnak?: { datavalue?: { value?: { id?: string } } };
        rank?: string;
      }>>;
      labels?: Record<string, { value?: string }>;
    }>;
  };
}

function extractItemIdsFromClaims(
  claims: Record<string, Array<{ mainsnak?: { datavalue?: { value?: { id?: string } } }; rank?: string }>> | undefined,
  propertyId: string,
) {
  return (claims?.[propertyId] ?? [])
    .filter((claim) => claim.rank !== "deprecated")
    .map((claim) => claim.mainsnak?.datavalue?.value?.id)
    .filter((value): value is string => typeof value === "string");
}

function hasWikidataClaim(
  claims: Record<string, Array<{ mainsnak?: { datavalue?: { value?: { id?: string } } }; rank?: string }>> | undefined,
  propertyId: string,
) {
  const entries = claims?.[propertyId] ?? [];
  return entries.some((entry) => entry.rank !== "deprecated");
}

type StructuredPropertyOverrideConfig = {
  id: string;
  propertyId: string;
  roleLabel: string;
  sourcePropertyDescription: string;
  parse: (inputText: string, parsedClaim: ParsedClaim | null) => { claimedValue: string; entity: string } | null;
  normalizeClaimedValue: (value: string) => string;
  normalizeExpectedValue: (value: string) => string;
};

type ScienceClassConfig = {
  claimLabel: string;
  qid: string;
};

const SCIENCE_CLASS_MAP: ScienceClassConfig[] = [
  { claimLabel: "planet", qid: "Q634" },
  { claimLabel: "star", qid: "Q523" },
  { claimLabel: "moon", qid: "Q2537" },
  { claimLabel: "galaxy", qid: "Q318" },
  { claimLabel: "element", qid: "Q11344" },
  { claimLabel: "chemical element", qid: "Q11344" },
];

function getScienceIsAClaimParts(inputText: string, parsedClaim: ParsedClaim | null) {
  const direct = inputText
    .trim()
    .match(/^(.+?)\s+(?:is|was)\s+(?:a|an|the)?\s*(planet|star|moon|galaxy|element|chemical element)(?:[.!?]|$)/i);
  if (direct) {
    return {
      entity: direct[1].trim(),
      claimedClass: direct[2].trim().toLowerCase(),
    };
  }

  if (!parsedClaim) {
    return null;
  }

  const parsedObject = parsedClaim.object
    .trim()
    .toLowerCase()
    .match(/^(?:a|an|the)?\s*(planet|star|moon|galaxy|element|chemical element)$/i);
  if (!parsedObject) {
    return null;
  }

  return {
    entity: parsedClaim.subject.trim(),
    claimedClass: parsedObject[1].trim().toLowerCase(),
  };
}

function getAtomicNumberClaimParts(inputText: string, parsedClaim: ParsedClaim | null) {
  const direct = inputText
    .trim()
    .match(/^(.+?)\s+has\s+(?:an\s+)?atomic\s+number\s+([0-9]{1,3})(?:[.!?]|$)/i);
  if (direct) {
    return {
      entity: direct[1].trim(),
      claimedAtomicNumber: Number.parseInt(direct[2], 10),
    };
  }

  if (!parsedClaim) {
    return null;
  }

  const parsedObject = parsedClaim.object
    .trim()
    .toLowerCase()
    .match(/^(?:an\s+)?atomic\s+number\s+([0-9]{1,3})$/i);
  if (!parsedObject) {
    return null;
  }

  return {
    entity: parsedClaim.subject.trim(),
    claimedAtomicNumber: Number.parseInt(parsedObject[1], 10),
  };
}

function extractNumericClaimValues(
  claims: Record<string, Array<{ mainsnak?: { datavalue?: { value?: unknown } }; rank?: string }>> | undefined,
  propertyId: string,
) {
  const entries = claims?.[propertyId] ?? [];
  return entries
    .filter((entry) => entry.rank !== "deprecated")
    .map((entry) => {
      const rawValue = entry.mainsnak?.datavalue?.value as { amount?: string | number } | undefined;
      if (!rawValue || rawValue.amount === undefined || rawValue.amount === null) {
        return null;
      }

      const parsed = Number.parseFloat(String(rawValue.amount));
      if (!Number.isFinite(parsed)) {
        return null;
      }

      return Math.round(Math.abs(parsed));
    })
    .filter((value): value is number => value !== null);
}

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

export async function commonKnowledgeLifeStatusOverride(
  inputText: string,
  parsedClaim: ParsedClaim | null,
): Promise<CommonKnowledgeResult | null> {
  const parts = getLifeStatusClaimParts(inputText, parsedClaim);
  if (!parts) {
    return null;
  }

  try {
    const entitySearch = await searchWikidataEntity(parts.person);
    if (!entitySearch) {
      return null;
    }

    const entityPayload = await getWikidataEntities([entitySearch.id], "claims|labels");
    const entityData = entityPayload?.entities?.[entitySearch.id];
    if (!entityData?.claims) {
      return null;
    }

    const hasDeathDate = hasWikidataClaim(entityData.claims, "P570");
    const inferredStatus: "dead" | "alive" = hasDeathDate ? "dead" : "alive";
    const isMatch = inferredStatus === parts.claimedStatus;
    const relation: SourceReference["relation"] = isMatch ? "supports" : "contradicts";
    const personLabel = entityData.labels?.en?.value?.trim() || entitySearch.label || parts.person;

    const statusSnippet = hasDeathDate
      ? `${personLabel} has a recorded date of death in Wikidata (property P570), indicating the person is deceased.`
      : `${personLabel} has no recorded date of death in Wikidata (property P570), which indicates the person is currently living in this dataset.`;

    const sources: SourceReference[] = [
      {
        id: `ck-wikidata-life-status-${entitySearch.id}`,
        title: `${personLabel} - Wikidata (life status)` ,
        url: `https://www.wikidata.org/wiki/${entitySearch.id}`,
        publisher: "Wikidata",
        snippet: statusSnippet,
        relation,
        credibility: hasDeathDate ? 96 : 92,
        tier: "Tier 1",
        domainAuthorityTier: "High",
        domainAuthority: 88,
        institutionalTrust: 90,
        citationSignal: 86,
        recencyScore: hasDeathDate ? 94 : 84,
        agreementScore: isMatch ? 96 : 97,
        relevanceScore: 98,
        finalScore: hasDeathDate ? 96 : 92,
        authorityScore: 92,
      },
      {
        id: `ck-wikipedia-life-status-${entitySearch.id}`,
        title: `${personLabel} - Wikipedia`,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(personLabel)}`,
        publisher: "Wikipedia",
        snippet: hasDeathDate
          ? `${personLabel} biographical references indicate the person is deceased.`
          : `${personLabel} biographical references indicate the person is alive.`,
        relation,
        credibility: hasDeathDate ? 93 : 88,
        tier: "Tier 1",
        domainAuthorityTier: "High",
        domainAuthority: 86,
        institutionalTrust: 84,
        citationSignal: 80,
        recencyScore: hasDeathDate ? 90 : 82,
        agreementScore: isMatch ? 94 : 95,
        relevanceScore: 95,
        finalScore: hasDeathDate ? 93 : 88,
        authorityScore: 88,
      },
    ];

    return {
      verdict: isMatch ? "True" : "False",
      confidence: hasDeathDate ? (isMatch ? 97 : 95) : (isMatch ? 90 : 93),
      explanation: isMatch
        ? `Common-knowledge life-status fact matched: ${personLabel} is ${inferredStatus}.`
        : `Common-knowledge life-status fact contradicts the claim: ${personLabel} is ${inferredStatus}.`,
      sources,
    };
  } catch {
    return null;
  }
}

