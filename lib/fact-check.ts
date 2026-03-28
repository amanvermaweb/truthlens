import { connectToDatabase } from "@/lib/mongodb";
import {
  AnalysisDimensions,
  BiasProfile,
  ComparisonResult,
  HistoryEntry,
  MisleadingSegment,
  SimilarClaim,
  SourceReference,
  SubClaim,
  Verdict,
} from "@/lib/types";
import { ObjectId } from "mongodb";
import { createHash } from "node:crypto";

const DB_NAME = process.env.MONGODB_DB_NAME ?? "truth-lens";
const REQUEST_TIMEOUT_MS = 3000;
const ANALYSIS_MODEL_VERSION = "v13";

type ParsedClaim = {
  subject: string;
  predicate: string;
  object: string;
};

type ClaimType =
  | "scientific"
  | "political"
  | "opinion"
  | "statistical";

type RetrievalProfile = {
  relevanceThreshold: number;
  semanticThreshold: number;
  includeInstitutional: boolean;
  newsPageSize: number;
};

const CLAIM_RETRIEVAL_PROFILE: Record<ClaimType, RetrievalProfile> = {
  scientific: { relevanceThreshold: 72, semanticThreshold: 0.75, includeInstitutional: true, newsPageSize: 4 },
  political: { relevanceThreshold: 70, semanticThreshold: 0.75, includeInstitutional: true, newsPageSize: 4 },
  opinion: { relevanceThreshold: 76, semanticThreshold: 0.77, includeInstitutional: false, newsPageSize: 3 },
  statistical: { relevanceThreshold: 74, semanticThreshold: 0.75, includeInstitutional: true, newsPageSize: 4 },
};

const EMBEDDING_DIMENSIONS = 256;
const MIN_DOMAIN_AUTHORITY = 0.4;
const MIN_RELAXED_SEMANTIC_THRESHOLD = 0.5;
const MIN_RELAXED_RELEVANCE_THRESHOLD = 46;

const KNOWN_CAPITALS: Record<string, string> = {
  india: "new delhi",
  france: "paris",
  germany: "berlin",
  italy: "rome",
  spain: "madrid",
  japan: "tokyo",
  china: "beijing",
  australia: "canberra",
  canada: "ottawa",
  brazil: "brasilia",
  mexico: "mexico city",
  egypt: "cairo",
  russia: "moscow",
  unitedstates: "washington dc",
  unitedkingdom: "london",
};

type SourceStance = "support" | "contradict" | "neutral";

type VerificationSourceScore = {
  relevanceScore: number;
  authorityScore: number;
  stance: SourceStance;
  finalScore: number;
  semanticSimilarity: number;
  hardMatch: boolean;
};

type VerificationVerdict = "TRUE" | "FALSE" | "MIXED" | "UNKNOWN";

type BasicFactCategory = "geography" | "science" | "historical" | "general";

type ClaimAssessment = {
  isBasicFact: boolean;
  category: BasicFactCategory;
  decisivePrompt: string;
  isHighCertaintyFact: boolean;
  statusClaim: "dead" | "alive" | null;
  needsVerification?: boolean;
  verificationReason?: string;
};

type CommonKnowledgeResult = {
  verdict: Verdict;
  confidence: number;
  explanation: string;
  sources: SourceReference[];
};

type QueryDoc = {
  _id?: ObjectId;
  rawInput: string;
  inputType: "text" | "url";
  normalizedInput: string;
  dedupeKey: string;
  parsedClaim?: ParsedClaim;
  userId?: string;
  cacheHit: boolean;
  resultId?: ObjectId;
  sourcesUsed: string[];
  createdAt: Date;
};

type ResultDoc = {
  _id?: ObjectId;
  queryId: ObjectId;
  dedupeKey: string;
  userId?: string;
  verdict: Verdict;
  explanation: string;
  confidence: number;
  sources: SourceReference[];
  supportWeight: number;
  contradictionWeight: number;
  dimensions: AnalysisDimensions;
  biasProfile: BiasProfile;
  misleadingSegments: MisleadingSegment[];
  subClaims: SubClaim[];
  externalFailures: string[];
  createdAt: Date;
  updatedAt?: Date;
};

type UserDoc = {
  _id?: ObjectId;
  clerkUserId: string;
  createdAt: Date;
  lastSeenAt: Date;
};

type SourceTier = "government" | "research" | "news" | "blog";

const SOURCE_TIER_WEIGHT: Record<SourceTier, number> = {
  government: 1.2,
  research: 1.1,
  news: 1,
  blog: 0.75,
};

export type AnalysisResponse = {
  id: string;
  input: string;
  inputType: "text" | "url";
  verdict: Verdict;
  explanation: string;
  sources: SourceReference[];
  confidence: number;
  dimensions: AnalysisDimensions;
  biasProfile: BiasProfile;
  misleadingSegments: MisleadingSegment[];
  subClaims: SubClaim[];
  similarClaims: SimilarClaim[];
  cached: boolean;
  createdAt: Date;
  updatedAt?: Date;
};

export type LegacyClaimResponse = {
  id: string;
  claim: string;
  verdict: Verdict;
  confidence: number;
  analysisSummary: string;
  tags: string[];
  sourceNodes: Array<{
    id: string;
    label: string;
    title: string;
    source: string;
    credibility: number;
    relation: "supports" | "contradicts" | "neutral";
    summary: string;
    x: number;
    y: number;
  }>;
  sources: SourceReference[];
  explanation: string;
  dimensions: AnalysisDimensions;
  biasProfile: BiasProfile;
  misleadingSegments: MisleadingSegment[];
  subClaims: SubClaim[];
  similarClaims: SimilarClaim[];
  createdAt: Date;
  updatedAt?: Date;
};

function normalizeInput(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function buildDedupeKey(normalizedInput: string) {
  return hashValue(`${ANALYSIS_MODEL_VERSION}:${normalizedInput}`);
}

function parseInput(payload: { claim?: unknown; input?: unknown; url?: unknown } | null) {
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

function getInputType(input: string): "text" | "url" {
  try {
    const parsed = new URL(input);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? "url" : "text";
  } catch {
    return "text";
  }
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function tokenize(input: string) {
  const stopwords = new Set([
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

  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !stopwords.has(token));
}

function parseClaimStructure(input: string): ParsedClaim | null {
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

function classifyClaimType(inputText: string, parsedClaim: ParsedClaim | null): ClaimType {
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

function assessClaimForDecisiveMode(
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

function rewriteClaimQueries(
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

function normalizeFactToken(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCountryKey(value: string) {
  return normalizeFactToken(value).replace(/\s+/g, "");
}

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

function commonKnowledgeCapitalOverride(
  inputText: string,
  parsedClaim: ParsedClaim | null,
): CommonKnowledgeResult | null {
  const parts = getCapitalClaimParts(inputText, parsedClaim);
  if (!parts) {
    return null;
  }

  const countryKey = normalizeCountryKey(parts.country)
    .replace(/^the/, "")
    .replace(/republicof/, "")
    .replace(/federalrepublicof/, "");
  const expectedCapital = KNOWN_CAPITALS[countryKey];
  if (!expectedCapital) {
    return null;
  }

  const claimedCapital = normalizeFactToken(parts.claimedCapital)
    .replace(/\bcity\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const normalizedExpected = normalizeFactToken(expectedCapital)
    .replace(/\bcity\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const isMatch = claimedCapital === normalizedExpected;
  const countryLabel = parts.country.trim();
  const expectedLabel = expectedCapital
    .split(" ")
    .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
    .join(" ");
  const relation: SourceReference["relation"] = isMatch ? "supports" : "contradicts";

  const sources: SourceReference[] = [
    {
      id: `ck-wikipedia-capital-${countryKey}`,
      title: `${countryLabel} - Wikipedia`,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(countryLabel)}`,
      publisher: "Wikipedia",
      snippet: `The capital of ${countryLabel} is ${expectedLabel}.`,
      relation,
      credibility: 96,
      tier: "Tier 1",
      domainAuthorityTier: "High",
      domainAuthority: 88,
      institutionalTrust: 84,
      citationSignal: 85,
      recencyScore: 90,
      agreementScore: isMatch ? 96 : 97,
      relevanceScore: 98,
      finalScore: 96,
      authorityScore: 90,
    },
    {
      id: `ck-worldfactbook-capital-${countryKey}`,
      title: `${countryLabel} - The World Factbook`,
      url: "https://www.cia.gov/the-world-factbook/",
      publisher: "CIA World Factbook",
      snippet: `Reference entries list ${expectedLabel} as the capital of ${countryLabel}.`,
      relation,
      credibility: 95,
      tier: "Tier 1",
      domainAuthorityTier: "High",
      domainAuthority: 92,
      institutionalTrust: 90,
      citationSignal: 80,
      recencyScore: 88,
      agreementScore: isMatch ? 95 : 96,
      relevanceScore: 96,
      finalScore: 95,
      authorityScore: 93,
    },
    {
      id: `ck-britannica-capital-${countryKey}`,
      title: `${countryLabel} - Britannica`,
      url: `https://www.britannica.com/place/${encodeURIComponent(countryLabel)}`,
      publisher: "Encyclopaedia Britannica",
      snippet: `General reference material identifies ${expectedLabel} as the capital city.`,
      relation,
      credibility: 93,
      tier: "Tier 1",
      domainAuthorityTier: "High",
      domainAuthority: 86,
      institutionalTrust: 84,
      citationSignal: 76,
      recencyScore: 86,
      agreementScore: isMatch ? 94 : 95,
      relevanceScore: 95,
      finalScore: 93,
      authorityScore: 88,
    },
  ];

  return {
    verdict: isMatch ? "True" : "False",
    confidence: isMatch ? 97 : 96,
    explanation: isMatch
      ? `Common-knowledge capital fact matched: the capital of ${countryLabel} is ${expectedLabel}.`
      : `Common-knowledge capital fact contradicts the claim: the capital of ${countryLabel} is ${expectedLabel}.`,
    sources,
  };
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

async function commonKnowledgeCeoOverride(
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

async function commonKnowledgeFounderOverride(
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

async function commonKnowledgePresidentOverride(
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

async function commonKnowledgePrimeMinisterOverride(
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

async function commonKnowledgeHeadquartersOverride(
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

async function commonKnowledgeBornInOverride(
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

async function commonKnowledgeDiedInOverride(
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

async function commonKnowledgeSpouseOverride(
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

async function commonKnowledgeOrbitOverride(
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

async function commonKnowledgeScienceIsAOverride(
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

async function commonKnowledgeAtomicNumberOverride(
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

async function commonKnowledgeLifeStatusOverride(
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

function getEmbedding(text: string): number[] {
  const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  const tokens = tokenize(text);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const hash = hashValue(`${token}:${index}`);
    const slot = Number.parseInt(hash.slice(0, 8), 16) % EMBEDDING_DIMENSIONS;
    const sign = Number.parseInt(hash.slice(8, 10), 16) % 2 === 0 ? 1 : -1;
    vector[slot] += sign;
  }

  return normalizeVector(vector);
}

async function fetchOpenAIEmbeddings(texts: string[]): Promise<number[][] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || texts.length === 0) {
    return null;
  }

  try {
    const response = await fetchWithTimeout("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
        input: texts,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };

    const embeddings = payload.data?.map((item) => item.embedding ?? []);
    if (!embeddings || embeddings.length !== texts.length) {
      return null;
    }

    return embeddings.map(normalizeVector);
  } catch {
    return null;
  }
}

function normalizeVector(vector: number[]) {
  const norm = Math.sqrt(vector.reduce((acc, value) => acc + value * value, 0));
  if (norm === 0) {
    return vector;
  }

  return vector.map((value) => value / norm);
}

async function getEmbeddings(texts: string[]) {
  const openAIEmbeddings = await fetchOpenAIEmbeddings(texts);
  if (openAIEmbeddings) {
    return openAIEmbeddings;
  }

  return texts.map(getEmbedding);
}

function cosineSimilarity(a: number[], b: number[]) {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;

  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    aNorm += a[index] * a[index];
    bNorm += b[index] * b[index];
  }

  const denom = Math.sqrt(aNorm) * Math.sqrt(bNorm);
  return denom === 0 ? 0 : dot / denom;
}

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

function passHardRelevanceFilter(claimText: string, parsedClaim: ParsedClaim | null, sourceText: string) {
  const sourceTokens = new Set(tokenize(sourceText));
  const signals = extractClaimSignals(claimText, parsedClaim);

  const subjectMatch = hasTokenOverlap(sourceTokens, signals.subjectTokens, 1);
  const objectMatch = hasTokenOverlap(sourceTokens, signals.objectTokens, 1);
  const relationMatch = hasTokenOverlap(sourceTokens, signals.relationTokens, 1);

  if (parsedClaim) {
    return subjectMatch && objectMatch && relationMatch;
  }

  // Fall back to requiring at least two dimensions when structure parsing fails.
  const matches = [subjectMatch, objectMatch, relationMatch].filter(Boolean).length;
  return matches >= 2;
}

function computeSourceRelevance(
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

function extractEntityCandidate(input: string) {
  const parsed = parseClaimStructure(input);
  if (parsed) {
    return parsed.subject;
  }

  const titleCaseMatch = input.match(/([A-Z][a-z]+\s+[A-Z][a-z]+)/);
  if (titleCaseMatch?.[1]) {
    return titleCaseMatch[1];
  }

  return input
    .split(/\s+/)
    .slice(0, 4)
    .join(" ")
    .trim();
}

function isBlockedUrl(input: string) {
  try {
    const parsed = new URL(input);
    const host = parsed.hostname.toLowerCase();
    if (["localhost", "127.0.0.1", "::1"].includes(host)) {
      return true;
    }
    if (host.startsWith("10.") || host.startsWith("192.168.")) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchWithTimeout(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveInputText(input: string): Promise<{ inputText: string; externalFailures: string[] }> {
  const externalFailures: string[] = [];
  if (getInputType(input) !== "url") {
    return { inputText: input, externalFailures };
  }

  if (isBlockedUrl(input)) {
    return {
      inputText: input,
      externalFailures: ["Blocked private or localhost URL for safety."],
    };
  }

  try {
    const response = await fetchWithTimeout(input, {
      headers: {
        "User-Agent": "TruthLensBot/1.0 (+https://truthlens.local)",
      },
    });

    if (!response.ok) {
      externalFailures.push(`URL fetch failed with status ${response.status}.`);
      return { inputText: input, externalFailures };
    }

    const html = await response.text();
    const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
    const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
    const text = stripHtml(html).slice(0, 700);

    const textParts = [titleMatch?.[1] ?? "", descMatch?.[1] ?? "", text]
      .map((part) => part.trim())
      .filter(Boolean);

    if (textParts.length === 0) {
      externalFailures.push("URL parsing returned empty content.");
      return { inputText: input, externalFailures };
    }

    return { inputText: textParts.join(". "), externalFailures };
  } catch {
    externalFailures.push("URL fetch timed out or failed.");
    return { inputText: input, externalFailures };
  }
}

function extractDomain(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function sourceTierLabel(tier: SourceTier): "Tier 1" | "Tier 2" | "Tier 3" {
  if (tier === "government" || tier === "research") {
    return "Tier 1";
  }

  if (tier === "news") {
    return "Tier 2";
  }

  return "Tier 3";
}

function domainAuthorityTier(score: number): "High" | "Medium" | "Low" {
  if (score >= 0.8) {
    return "High";
  }

  if (score >= 0.62) {
    return "Medium";
  }

  return "Low";
}

export function getDomainAuthority(url: string) {
  const host = extractDomain(url);

  if (!host) {
    return 0.45;
  }

  if (
    /ign\.com|techradar\.com|screenrant\.com|gamespot\.com|buzzfeed\.com|tmz\.com|variety\.com/.test(host)
  ) {
    return 0.2;
  }

  if (/\.gov(\.[a-z]{2})?$/.test(host) || /\.(edu)$/.test(host)) {
    return 0.95;
  }

  if (/nasa\.gov|noaa\.gov|nih\.gov|cdc\.gov|nature\.com|science\.org|thelancet\.com|nejm\.org/.test(host)) {
    return 0.96;
  }

  if (/worldbank\.org|who\.int|imf\.org|un\.org|wikidata\.org|wikipedia\.org/.test(host)) {
    return 0.88;
  }

  if (/reuters\.com|apnews\.com|bbc\.com|nytimes\.com|wsj\.com|economist\.com/.test(host)) {
    return 0.78;
  }

  if (/medium\.com|substack\.com|blogspot\.com|wordpress\.com|ghost\.io/.test(host)) {
    return 0.55;
  }

  return 0.62;
}

function computeInstitutionalTrust(url: string, publisher: string) {
  const host = extractDomain(url);
  const text = `${host} ${publisher}`.toLowerCase();

  if (/(world bank|who|imf|united nations|un sdg|cdc|nih)/i.test(text)) {
    return 0.95;
  }

  if (/(journal|university|research|institute|peer)/i.test(text)) {
    return 0.88;
  }

  if (/(news|times|post|reuters|ap|bbc)/i.test(text)) {
    return 0.72;
  }

  if (/(blog|opinion|personal|influencer)/i.test(text)) {
    return 0.36;
  }

  return 0.55;
}

function computeRecencyScoreFromText(text: string) {
  const yearMatches = text.match(/\b(19\d{2}|20\d{2})\b/g) ?? [];
  if (yearMatches.length === 0) {
    return 58;
  }

  const newestYear = Math.max(...yearMatches.map((year) => Number(year)));
  const currentYear = new Date().getUTCFullYear();
  const age = Math.max(0, currentYear - newestYear);

  return Math.max(28, Math.round(100 - age * 9));
}

function computeCitationSignal(text: string) {
  const numberCount = (text.match(/\d+/g) ?? []).length;
  const citationKeywords = (text.match(/\b(report|study|paper|dataset|survey|official|index|published)\b/gi) ?? [])
    .length;

  return clamp01(numberCount / 5 + citationKeywords / 4);
}

function computeTrustScore(url: string, publisher: string) {
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

  const tierFactor = sourceTierWeight(url, publisher);

  if (trustedHosts.some((entry) => host.endsWith(entry))) {
    return clamp01(0.9 * tierFactor);
  }

  if (publisher.toLowerCase().includes("news")) {
    return clamp01(0.68 * tierFactor);
  }

  return clamp01(0.55 * tierFactor);
}

function buildTrustModel(url: string, publisher: string, text: string) {
  const tier = classifySourceTier(url, publisher);
  const domainAuthority = getDomainAuthority(url);
  const institutionalTrust = computeInstitutionalTrust(url, publisher);
  const recencyScore = computeRecencyScoreFromText(text);
  const citationSignal = computeCitationSignal(text);
  const agreementPenaltySafeTrust = computeTrustScore(url, publisher);

  const blended = clamp01(
    domainAuthority * 0.3 +
      institutionalTrust * 0.25 +
      (recencyScore / 100) * 0.15 +
      citationSignal * 0.15 +
      agreementPenaltySafeTrust * 0.15,
  );

  return {
    tier,
    tierLabel: sourceTierLabel(tier),
    domainAuthorityTier: domainAuthorityTier(domainAuthority),
    domainAuthority,
    institutionalTrust,
    recencyScore,
    citationSignal,
    trust: blended,
  };
}

function classifySourceTier(url: string, publisher: string): SourceTier {
  const host = (() => {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  const publisherText = publisher.toLowerCase();

  const governmentHosts = [
    "worldbank.org",
    "who.int",
    "imf.org",
    "un.org",
    "unstats.un.org",
    "data.gov",
    "gov.uk",
    "europa.eu",
  ];

  if (/\.gov(\.[a-z]{2})?$/.test(host) || governmentHosts.some((entry) => host.endsWith(entry))) {
    return "government";
  }

  const researchHosts = [
    "doi.org",
    "arxiv.org",
    "nature.com",
    "science.org",
    "nejm.org",
    "thelancet.com",
    "bmj.com",
    "ncbi.nlm.nih.gov",
  ];

  if (
    researchHosts.some((entry) => host.endsWith(entry)) ||
    /(journal|university|institute|research|study|academ)/i.test(publisherText)
  ) {
    return "research";
  }

  if (
    /(medium\.com|substack\.com|blogspot\.com|wordpress\.com|ghost\.io)$/.test(host) ||
    /(blog|opinion|personal)/i.test(publisherText)
  ) {
    return "blog";
  }

  return "news";
}

function sourceTierWeight(url: string, publisher: string) {
  return SOURCE_TIER_WEIGHT[classifySourceTier(url, publisher)];
}

function computeEvidenceQuality(title: string, snippet: string) {
  const text = `${title} ${snippet}`.trim();
  const lengthScore = clamp01(text.length / 220);
  const hasNumbers = /\d/.test(text) ? 0.15 : 0;
  const hasConcreteSignal = /(report|study|data|according|official|estimated|net worth|valuation)/i.test(text)
    ? 0.2
    : 0;
  return clamp01(0.35 + lengthScore * 0.4 + hasNumbers + hasConcreteSignal);
}

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

  // Handle common definitional claims where a snippet may state the correct entity
  // without explicit negation words (for example, capital-city facts).
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

function evaluateRelation(
  claimText: string,
  parsedClaim: ParsedClaim | null,
  evidenceText: string,
): "supports" | "contradicts" | "neutral" {
  const stance = detectStance(parsedClaim ? `${parsedClaim.subject} ${parsedClaim.predicate} ${parsedClaim.object}` : claimText, evidenceText);
  if (stance === "support") {
    return "supports";
  }

  if (stance === "contradict") {
    return "contradicts";
  }

  return "neutral";
}

function computeAgreementScore(relation: "supports" | "contradicts" | "neutral") {
  if (relation === "supports") {
    return 0.8;
  }

  if (relation === "contradicts") {
    return 0.95;
  }

  return 0.4;
}

function deriveBiasProfile(inputText: string, sources: SourceReference[]): BiasProfile {
  const text = inputText.toLowerCase();
  const emotionalHits = (text.match(/\b(shocking|outrage|disaster|corrupt|evil|traitor|destroyed|scam|lies?)\b/g) ?? [])
    .length;

  const leftHits = (text.match(/\b(progressive|social justice|climate action|workers rights|wealth tax)\b/g) ?? [])
    .length;
  const rightHits = (text.match(/\b(traditional values|border security|small government|patriot|anti-woke)\b/g) ?? [])
    .length;

  const lowTierRatio =
    sources.length === 0
      ? 0
      : sources.filter((source) => source.tier === "Tier 3").length / sources.length;

  const manipulationScore = clamp01(emotionalHits / 4 + lowTierRatio * 0.6);

  return {
    politicalBias:
      leftHits > rightHits + 1
        ? "Left-leaning"
        : rightHits > leftHits + 1
          ? "Right-leaning"
          : "Centrist/Unclear",
    emotionalLanguage: emotionalHits >= 4 ? "High" : emotionalHits >= 2 ? "Medium" : "Low",
    manipulationRisk: manipulationScore >= 0.66 ? "High" : manipulationScore >= 0.36 ? "Medium" : "Low",
  };
}

function detectMisleadingSegments(inputText: string): MisleadingSegment[] {
  const findings: MisleadingSegment[] = [];
  const sentences = inputText
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  for (const sentence of sentences) {
    if (/\b(always|never|all|none|undeniable|proved)\b/i.test(sentence)) {
      findings.push({
        text: sentence,
        reason: "Absolute language increases misinformation risk.",
        severity: "high",
      });
    }

    if (/\b(people say|everyone knows|they don't want you to know|secretly)\b/i.test(sentence)) {
      findings.push({
        text: sentence,
        reason: "Vague attribution without evidence.",
        severity: "medium",
      });
    }

    if (/\b(shocking|outrageous|disaster|catastrophe)\b/i.test(sentence)) {
      findings.push({
        text: sentence,
        reason: "Emotional framing can distort factual interpretation.",
        severity: "low",
      });
    }
  }

  return findings.slice(0, 6);
}

function generateSubClaimStatements(inputText: string, parsedClaim: ParsedClaim | null) {
  const seed = parsedClaim
    ? [
        `${parsedClaim.subject} ${parsedClaim.predicate} ${parsedClaim.object}`,
        `${parsedClaim.subject} is contextually tied to ${parsedClaim.object}`,
        `Independent evidence consistency for ${parsedClaim.subject}`,
      ]
    : inputText
        .split(/,| and | but |;|\./i)
        .map((part) => part.trim())
        .filter((part) => part.length > 8)
        .slice(0, 3);

  return seed.slice(0, 3);
}

function buildSubClaims(inputText: string, parsedClaim: ParsedClaim | null, sources: SourceReference[]): SubClaim[] {
  const statements = generateSubClaimStatements(inputText, parsedClaim);

  return statements.map((statement, index) => {
    const statementTokens = new Set(tokenize(statement));
    const relevantSources = sources.filter((source) => {
      const sourceTokens = new Set(tokenize(`${source.title} ${source.snippet}`));
      let overlap = 0;
      for (const token of statementTokens) {
        if (sourceTokens.has(token)) {
          overlap += 1;
        }
      }
      return overlap > 0;
    });

    return {
      id: `sub-${index + 1}`,
      statement,
      supportCount: relevantSources.filter((source) => source.relation === "supports").length,
      contradictionCount: relevantSources.filter((source) => source.relation === "contradicts").length,
      unresolvedCount: relevantSources.filter((source) => source.relation === "neutral").length,
      linkedSourceIds: relevantSources.map((source) => source.id),
    };
  });
}

async function fetchWikipediaAndWikidataSources(
  queryText: string,
  parsedClaim: ParsedClaim | null,
): Promise<{ sources: SourceReference[]; failures: string[] }> {
  const failures: string[] = [];
  const search = encodeURIComponent(extractEntityCandidate(queryText));

  try {
    const wikiSearchResponse = await fetchWithTimeout(
      `https://en.wikipedia.org/w/api.php?action=opensearch&search=${search}&limit=1&namespace=0&format=json`,
    );

    if (!wikiSearchResponse.ok) {
      failures.push(`Wikipedia search failed with status ${wikiSearchResponse.status}.`);
      return { sources: [], failures };
    }

    const wikiSearch = (await wikiSearchResponse.json()) as [string, string[], string[], string[]];
    const wikiTitle = wikiSearch[1]?.[0];
    if (!wikiTitle) {
      failures.push("Wikipedia returned no matching entity.");
      return { sources: [], failures };
    }

    const summaryResponse = await fetchWithTimeout(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle)}`,
    );
    if (!summaryResponse.ok) {
      failures.push(`Wikipedia summary failed with status ${summaryResponse.status}.`);
      return { sources: [], failures };
    }

    const summary = (await summaryResponse.json()) as {
      title?: string;
      extract?: string;
      content_urls?: { desktop?: { page?: string } };
    };

    const wikiSnippet = summary.extract?.trim() || "No summary provided.";
    const wikiUrl = summary.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(wikiTitle)}`;
    const wikiRelation = evaluateRelation(queryText, parsedClaim, `${summary.title ?? ""} ${wikiSnippet}`);
    const wikiTrustModel = buildTrustModel(wikiUrl, "Wikipedia", `${summary.title ?? ""} ${wikiSnippet}`);
    const wikiQuality = computeEvidenceQuality(summary.title ?? wikiTitle, wikiSnippet);
    const wikiAgreement = computeAgreementScore(wikiRelation);

    const sources: SourceReference[] = [
      {
        id: `wikipedia-${hashValue(wikiTitle).slice(0, 8)}`,
        title: summary.title?.trim() || wikiTitle,
        url: wikiUrl,
        publisher: "Wikipedia",
        snippet: wikiSnippet,
        relation: wikiRelation,
        credibility: Math.round((wikiTrustModel.trust * 0.42 + wikiQuality * 0.23 + wikiAgreement * 0.2 + (wikiTrustModel.citationSignal + wikiTrustModel.recencyScore / 100) * 0.15) * 100),
        tier: wikiTrustModel.tierLabel,
        domainAuthorityTier: wikiTrustModel.domainAuthorityTier,
        domainAuthority: Math.round(wikiTrustModel.domainAuthority * 100),
        institutionalTrust: Math.round(wikiTrustModel.institutionalTrust * 100),
        citationSignal: Math.round(wikiTrustModel.citationSignal * 100),
        recencyScore: wikiTrustModel.recencyScore,
        agreementScore: Math.round(wikiAgreement * 100),
      },
    ];

    try {
      const wikidataSearchResponse = await fetchWithTimeout(
        `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${search}&language=en&format=json&limit=1&type=item`,
      );

      if (!wikidataSearchResponse.ok) {
        failures.push(`Wikidata search failed with status ${wikidataSearchResponse.status}.`);
        return { sources, failures };
      }

      const wikidataSearch = (await wikidataSearchResponse.json()) as {
        search?: Array<{ id?: string; label?: string; description?: string }>;
      };

      const firstEntity = wikidataSearch.search?.[0];
      if (firstEntity?.id) {
        const description = firstEntity.description?.trim() || "No description from Wikidata.";
        const wikidataUrl = `https://www.wikidata.org/wiki/${firstEntity.id}`;
        const wikidataRelation = evaluateRelation(queryText, parsedClaim, `${firstEntity.label ?? ""} ${description}`);
        const wikidataTrustModel = buildTrustModel(
          wikidataUrl,
          "Wikidata",
          `${firstEntity.label ?? ""} ${description}`,
        );
        const wikidataQuality = computeEvidenceQuality(firstEntity.label ?? "Wikidata entity", description);
        const wikidataAgreement = computeAgreementScore(wikidataRelation);

        sources.push({
          id: `wikidata-${firstEntity.id}`,
          title: firstEntity.label?.trim() || firstEntity.id,
          url: wikidataUrl,
          publisher: "Wikidata",
          snippet: description,
          relation: wikidataRelation,
          credibility: Math.round((wikidataTrustModel.trust * 0.42 + wikidataQuality * 0.23 + wikidataAgreement * 0.2 + (wikidataTrustModel.citationSignal + wikidataTrustModel.recencyScore / 100) * 0.15) * 100),
          tier: wikidataTrustModel.tierLabel,
          domainAuthorityTier: wikidataTrustModel.domainAuthorityTier,
          domainAuthority: Math.round(wikidataTrustModel.domainAuthority * 100),
          institutionalTrust: Math.round(wikidataTrustModel.institutionalTrust * 100),
          citationSignal: Math.round(wikidataTrustModel.citationSignal * 100),
          recencyScore: wikidataTrustModel.recencyScore,
          agreementScore: Math.round(wikidataAgreement * 100),
        });
      } else {
        failures.push("Wikidata returned no matching entity.");
      }
    } catch {
      failures.push("Wikidata request timed out or failed.");
    }

    return { sources, failures };
  } catch {
    failures.push("Wikipedia request timed out or failed.");
    return { sources: [], failures };
  }
}

async function fetchNewsSources(
  claimText: string,
  parsedClaim: ParsedClaim | null,
  claimType: ClaimType,
  queryVariants: string[],
  assessment: ClaimAssessment,
): Promise<{ sources: SourceReference[]; failures: string[] }> {
  const failures: string[] = [];
  const key = process.env.NEWSAPI;
  const profile = CLAIM_RETRIEVAL_PROFILE[claimType];

  if (!key) {
    failures.push("NEWSAPI key not configured.");
    return { sources: [], failures };
  }

  const intentHints =
    claimType === "statistical"
      ? "statistics report dataset official"
      : claimType === "scientific"
        ? "study trial scientific evidence"
        : claimType === "political"
          ? "policy law regulation official statement"
          : "objective evidence fact check";
  const decisiveHint = assessment.isBasicFact
    ? `decisive verification ${assessment.category} fact direct reference confirm refute`
    : "balanced verification evidence";

  const searchQueries = [...new Set([claimText, ...queryVariants])]
    .map((query) => query.trim())
    .filter((query) => query.length > 10)
    .slice(0, 3);

  if (searchQueries.length === 0) {
    failures.push("Insufficient query terms for external lookup.");
    return { sources: [], failures };
  }

  const responses = await Promise.all(
    searchQueries.map(async (query) => {
      const params = new URLSearchParams({
        q: `${query} ${intentHints} ${decisiveHint}`.trim(),
        pageSize: String(profile.newsPageSize),
        language: "en",
        sortBy: "relevancy",
      });

      try {
        const response = await fetchWithTimeout(`https://newsapi.org/v2/everything?${params.toString()}`, {
          headers: {
            "X-Api-Key": key,
          },
        });

        if (!response.ok) {
          failures.push(`News API failed with status ${response.status} for query \"${query}\".`);
          return [];
        }

        const payload = (await response.json()) as {
          articles?: Array<{
            title?: string;
            url?: string;
            description?: string;
            source?: { name?: string };
          }>;
        };

        return payload.articles ?? [];
      } catch {
        failures.push(`News API request timed out or failed for query \"${query}\".`);
        return [];
      }
    }),
  );

  const deduped = new Map<string, {
    title?: string;
    url?: string;
    description?: string;
    source?: { name?: string };
  }>();

  for (const batch of responses) {
    for (const article of batch) {
      const url = article.url?.trim();
      if (!url || deduped.has(url)) {
        continue;
      }
      deduped.set(url, article);
    }
  }

  const sources = [...deduped.values()].slice(0, 12).map((article, index) => {
    const title = article.title?.trim() || `External evidence ${index + 1}`;
    const description = article.description?.trim() || "No summary available from provider.";
    const publisher = article.source?.name?.trim() || "NewsAPI";
    const url = article.url?.trim() || "";
    const relation = evaluateRelation(claimText, parsedClaim, `${title} ${description}`);
    const trustModel = buildTrustModel(url, publisher, `${title} ${description}`);
    const quality = computeEvidenceQuality(title, description);
    const agreement = computeAgreementScore(relation);

    return {
      id: `news-${hashValue(url || `${title}-${index}`).slice(0, 8)}`,
      title,
      url,
      publisher,
      snippet: description,
      relation,
      credibility: Math.round(
        (trustModel.trust * 0.42 + quality * 0.23 + agreement * 0.2 + (trustModel.citationSignal + trustModel.recencyScore / 100) * 0.15) * 100,
      ),
      tier: trustModel.tierLabel,
      domainAuthorityTier: trustModel.domainAuthorityTier,
      domainAuthority: Math.round(trustModel.domainAuthority * 100),
      institutionalTrust: Math.round(trustModel.institutionalTrust * 100),
      citationSignal: Math.round(trustModel.citationSignal * 100),
      recencyScore: trustModel.recencyScore,
      agreementScore: Math.round(agreement * 100),
    } satisfies SourceReference;
  });

  return { sources: sources.filter((source) => source.url.length > 0), failures };
}

type IndicatorConfig = {
  code: string;
  label: string;
};

function pickIndicatorByClaim(
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

function buildSourceReference(
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
  const trustModel = buildTrustModel(url, publisher, `${title} ${snippet}`);
  const quality = computeEvidenceQuality(title, snippet);
  const agreement = computeAgreementScore(relation);

  return {
    id: `${idPrefix}-${hashValue(idSeed).slice(0, 8)}`,
    title,
    url,
    publisher,
    snippet,
    relation,
    credibility: Math.round((trustModel.trust * 0.42 + quality * 0.23 + agreement * 0.2 + (trustModel.citationSignal + trustModel.recencyScore / 100) * 0.15) * 100),
    tier: trustModel.tierLabel,
    domainAuthorityTier: trustModel.domainAuthorityTier,
    domainAuthority: Math.round(trustModel.domainAuthority * 100),
    institutionalTrust: Math.round(trustModel.institutionalTrust * 100),
    citationSignal: Math.round(trustModel.citationSignal * 100),
    recencyScore: trustModel.recencyScore,
    agreementScore: Math.round(agreement * 100),
  } satisfies SourceReference;
}

async function fetchWorldBankSource(
  queryText: string,
  parsedClaim: ParsedClaim | null,
): Promise<{ source?: SourceReference; failure?: string }> {
  const indicator = pickIndicatorByClaim(queryText, {
    inflation: { code: "FP.CPI.TOTL.ZG", label: "Inflation, consumer prices (annual %)" },
    population: { code: "SP.POP.TOTL", label: "Population, total" },
    gdp: { code: "NY.GDP.MKTP.KD.ZG", label: "GDP growth (annual %)" },
    unemployment: { code: "SL.UEM.TOTL.ZS", label: "Unemployment, total (% of labor force)" },
    health: { code: "SH.XPD.CHEX.GD.ZS", label: "Current health expenditure (% of GDP)" },
  });

  try {
    const response = await fetchWithTimeout(
      `https://api.worldbank.org/v2/country/WLD/indicator/${indicator.code}?format=json&mrv=1`,
    );

    if (!response.ok) {
      return { failure: `World Bank API failed with status ${response.status}.` };
    }

    const payload = (await response.json()) as [unknown, Array<{ date?: string; value?: number | null }>];
    const latest = payload?.[1]?.[0];
    if (!latest || latest.value == null) {
      return { failure: "World Bank API returned no recent values." };
    }

    const year = latest.date?.trim() || "recent year";
    const snippet = `${indicator.label} (World): ${latest.value} in ${year}.`;

    return {
      source: buildSourceReference(
        "world-bank",
        `${indicator.code}-${year}`,
        `World Bank: ${indicator.label}`,
        `https://data.worldbank.org/indicator/${indicator.code}`,
        "World Bank",
        snippet,
        queryText,
        parsedClaim,
      ),
    };
  } catch {
    return { failure: "World Bank request timed out or failed." };
  }
}

async function fetchWhoSource(
  queryText: string,
  parsedClaim: ParsedClaim | null,
): Promise<{ source?: SourceReference; failure?: string }> {
  const searchTerms = tokenize(queryText);
  const bestTerm = searchTerms.find((term) => term.length >= 5) ?? "health";
  const filter = encodeURIComponent(`contains(IndicatorName,'${bestTerm}')`);

  try {
    const response = await fetchWithTimeout(
      `https://ghoapi.azureedge.net/api/Indicator?$top=1&$filter=${filter}`,
    );

    if (!response.ok) {
      return { failure: `WHO API failed with status ${response.status}.` };
    }

    const payload = (await response.json()) as {
      value?: Array<{ IndicatorCode?: string; IndicatorName?: string }>;
    };

    const indicator = payload.value?.[0];
    if (!indicator?.IndicatorCode || !indicator.IndicatorName) {
      return { failure: "WHO API returned no matching indicator." };
    }

    const snippet = `${indicator.IndicatorName} is available via the WHO Global Health Observatory API.`;

    return {
      source: buildSourceReference(
        "who",
        indicator.IndicatorCode,
        `WHO GHO: ${indicator.IndicatorName}`,
        `https://www.who.int/data/gho/data/indicators/indicator-details/GHO/${encodeURIComponent(indicator.IndicatorCode)}`,
        "WHO",
        snippet,
        queryText,
        parsedClaim,
      ),
    };
  } catch {
    return { failure: "WHO request timed out or failed." };
  }
}

async function fetchImfSource(
  queryText: string,
  parsedClaim: ParsedClaim | null,
): Promise<{ source?: SourceReference; failure?: string }> {
  const indicator = pickIndicatorByClaim(queryText, {
    inflation: { code: "PCPIPCH", label: "Inflation rate, average consumer prices" },
    population: { code: "LP", label: "Population" },
    gdp: { code: "NGDP_RPCH", label: "Real GDP growth" },
    unemployment: { code: "LUR", label: "Unemployment rate" },
    health: { code: "GGXWDG_NGDP", label: "Public spending" },
  });

  try {
    const response = await fetchWithTimeout(
      `https://www.imf.org/external/datamapper/api/v1/${indicator.code}?WEOADV`,
    );

    if (!response.ok) {
      return { failure: `IMF API failed with status ${response.status}.` };
    }

    const payload = (await response.json()) as {
      values?: Record<string, Record<string, Record<string, number>>>;
    };

    const byIndicator = payload.values?.[indicator.code];
    const series = byIndicator?.WEOADV;
    if (!series) {
      return { failure: "IMF API returned no dataset values." };
    }

    const years = Object.keys(series).sort((a, b) => Number(b) - Number(a));
    const latestYear = years[0];
    const latestValue = latestYear ? series[latestYear] : undefined;
    if (!latestYear || latestValue == null) {
      return { failure: "IMF API returned an empty time series." };
    }

    const snippet = `${indicator.label} (Advanced Economies): ${latestValue} in ${latestYear}.`;

    return {
      source: buildSourceReference(
        "imf",
        `${indicator.code}-${latestYear}`,
        `IMF DataMapper: ${indicator.label}`,
        `https://www.imf.org/external/datamapper/${indicator.code}/WEOADV`,
        "IMF",
        snippet,
        queryText,
        parsedClaim,
      ),
    };
  } catch {
    return { failure: "IMF request timed out or failed." };
  }
}

async function fetchUnSdgSource(
  queryText: string,
  parsedClaim: ParsedClaim | null,
): Promise<{ source?: SourceReference; failure?: string }> {
  try {
    const response = await fetchWithTimeout("https://unstats.un.org/sdgs/UNSDGAPI/v1/sdg/Series/List");

    if (!response.ok) {
      return { failure: `UN SDG API failed with status ${response.status}.` };
    }

    const payload = (await response.json()) as {
      data?: Array<{ code?: string; description?: string }>;
    };

    const terms = tokenize(queryText);
    const matched = payload.data?.find((entry) => {
      const text = `${entry.code ?? ""} ${entry.description ?? ""}`.toLowerCase();
      return terms.some((term) => text.includes(term));
    });

    const fallback = payload.data?.[0];
    const series = matched ?? fallback;

    if (!series?.code || !series.description) {
      return { failure: "UN SDG API returned no series metadata." };
    }

    const snippet = `${series.description} (series ${series.code}) is available through the UN SDG API catalog.`;

    return {
      source: buildSourceReference(
        "un-sdg",
        series.code,
        `UN SDG API: ${series.code}`,
        `https://unstats.un.org/sdgs/metadata/?Text=${encodeURIComponent(series.code)}`,
        "United Nations",
        snippet,
        queryText,
        parsedClaim,
      ),
    };
  } catch {
    return { failure: "UN SDG request timed out or failed." };
  }
}

async function fetchInstitutionalApiSources(
  queryText: string,
  parsedClaim: ParsedClaim | null,
  claimType: ClaimType,
): Promise<{ sources: SourceReference[]; failures: string[] }> {
  if (!CLAIM_RETRIEVAL_PROFILE[claimType].includeInstitutional) {
    return {
      sources: [],
      failures: ["Institutional retrieval skipped for subjective/non-institutional claim type."],
    };
  }

  const settled = await Promise.all([
    fetchWorldBankSource(queryText, parsedClaim),
    fetchWhoSource(queryText, parsedClaim),
    fetchImfSource(queryText, parsedClaim),
    fetchUnSdgSource(queryText, parsedClaim),
  ]);

  const sources = settled.flatMap((item) => (item.source ? [item.source] : []));
  const failures = settled.flatMap((item) => (item.failure ? [item.failure] : []));

  return { sources, failures };
}

async function filterSourcesByRelevance(
  queryText: string,
  parsedClaim: ParsedClaim | null,
  claimType: ClaimType,
  sources: SourceReference[],
  assessment: ClaimAssessment,
) {
  const prefilteredSources = sources.filter((source) => {
    const text = `${source.title} ${source.snippet} ${source.publisher}`.toLowerCase();
    const sourceTokens = new Set(tokenize(text));
    const claimTokens = tokenize(queryText);
    const overlap = claimTokens.filter((token) => sourceTokens.has(token)).length;
    const hardMatch = passHardRelevanceFilter(queryText, parsedClaim, text);
    const isLowSignalSnippet = source.snippet.trim().length < 26;
    const isLikelyNoise =
      /\b(opinion|editorial|rumor|gossip|trailer|review|fan theory|sponsored|celebrity)\b/i.test(text);
    const minimumOverlap = parsedClaim ? 2 : 1;
    const requiredOverlap = assessment.isHighCertaintyFact ? minimumOverlap + 1 : minimumOverlap;

    if (isLowSignalSnippet && !hardMatch) {
      return false;
    }

    if (overlap < requiredOverlap && !hardMatch) {
      return false;
    }

    if (assessment.isBasicFact && isLikelyNoise && overlap < minimumOverlap + 1) {
      return false;
    }

    return true;
  });

  const candidateSources = prefilteredSources.length > 0 ? prefilteredSources : sources;
  const profile = CLAIM_RETRIEVAL_PROFILE[claimType];
  const threshold = profile.relevanceThreshold;
  const claimEmbedding = (await getEmbeddings([queryText]))[0];
  const sourceTexts = candidateSources.map((source) => `${source.title} ${source.snippet} ${source.publisher}`);
  const sourceEmbeddings = await getEmbeddings(sourceTexts);

  const withScores = candidateSources.map((source, index) => {
    const sourceText = sourceTexts[index];
    const sourceEmbedding = sourceEmbeddings[index] ?? getEmbedding(sourceText);
    const relevance = computeSourceRelevance(
      queryText,
      `${source.title} ${source.snippet} ${source.publisher} ${source.url}`,
      claimEmbedding,
      sourceEmbedding,
      parsedClaim,
    );
    const authority = getDomainAuthority(source.url);
    const hardMatch = passHardRelevanceFilter(queryText, parsedClaim, sourceText);
    const stance = detectStance(queryText, sourceText);
    const stanceWeight = stance === "support" ? 1 : stance === "contradict" ? 0.9 : 0.45;
    const relevanceFactor = clamp01((relevance.relevanceScore / 100) ** 2.1);
    const hardMatchBonus = hardMatch ? 0.08 : 0;
    const finalScore = clamp01(
      (relevanceFactor * 0.6 + authority * 0.3 + stanceWeight * 0.1 + hardMatchBonus) *
        (0.4 + relevanceFactor * 0.6),
    );

    const relation = stance === "support" ? "supports" : stance === "contradict" ? "contradicts" : "neutral";

    return {
      ...source,
      relevanceScore: relevance.relevanceScore,
      authorityScore: Math.round(authority * 100),
      stance,
      finalScore: Math.round(finalScore * 100),
      relation,
      domainAuthority: Math.round(authority * 100),
      domainAuthorityTier: domainAuthorityTier(authority),
      credibility: Math.round(finalScore * 100),
      agreementScore: Math.round(computeAgreementScore(relation) * 100),
      semanticSimilarity: relevance.semanticSimilarity,
      hardMatch,
    } as SourceReference & VerificationSourceScore;
  });

  // Strict pass first. If it is too sparse, progressively relax gates to avoid empty evidence sets.
  const strictFiltered = withScores
    .filter((source) => source.semanticSimilarity >= profile.semanticThreshold)
    .filter((source) => source.hardMatch)
    .filter((source) => ((source.authorityScore ?? 0) / 100) >= MIN_DOMAIN_AUTHORITY)
    .filter((source) => (source.relevanceScore ?? 0) >= threshold)
    .sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0));

  const relaxedSemanticThreshold = Math.max(
    MIN_RELAXED_SEMANTIC_THRESHOLD,
    profile.semanticThreshold - 0.15,
  );
  const relaxedRelevanceThreshold = Math.max(
    MIN_RELAXED_RELEVANCE_THRESHOLD,
    threshold - 16,
  );

  const relaxedFiltered = withScores
    .filter((source) => source.semanticSimilarity >= relaxedSemanticThreshold)
    .filter((source) => ((source.authorityScore ?? 0) / 100) >= MIN_DOMAIN_AUTHORITY)
    .filter((source) => (source.relevanceScore ?? 0) >= relaxedRelevanceThreshold)
    .filter((source) => source.hardMatch || source.stance !== "neutral")
    .sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0));

  const fallbackFiltered = withScores
    .filter((source) => ((source.authorityScore ?? 0) / 100) >= 0.35)
    .filter((source) => (source.relevanceScore ?? 0) >= 45)
    .sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0));

  const permissiveBasicFactFiltered = withScores
    .filter((source) => ((source.authorityScore ?? 0) / 100) >= 0.4)
    .filter((source) => (source.relevanceScore ?? 0) >= 42)
    .filter((source) => source.stance !== "neutral" || source.hardMatch)
    .sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0));

  const lastResortFiltered = withScores
    .filter((source) => ((source.authorityScore ?? 0) / 100) >= 0.45)
    .filter((source) => (source.relevanceScore ?? 0) >= 50)
    .sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0));

  const highCertaintyFallback = withScores
    .filter((source) => ((source.authorityScore ?? 0) / 100) >= 0.5)
    .filter((source) => (source.relevanceScore ?? 0) >= 52)
    .filter((source) => source.stance !== "neutral" || source.hardMatch)
    .sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0));

  const filtered =
    assessment.isHighCertaintyFact
      ? strictFiltered.length >= 2
        ? strictFiltered
        : relaxedFiltered.length >= 2
          ? relaxedFiltered
          : highCertaintyFallback.length >= 1
            ? highCertaintyFallback
            : []
      : strictFiltered.length >= 2
        ? strictFiltered
        : relaxedFiltered.length >= 2
          ? relaxedFiltered
          : fallbackFiltered.length >= 1
            ? fallbackFiltered
            : assessment.isBasicFact && permissiveBasicFactFiltered.length >= 1
              ? permissiveBasicFactFiltered
              : lastResortFiltered;

  const finalSources = filtered.slice(0, 10).map((source) => {
    const cleaned = { ...source } as Record<string, unknown>;
    delete cleaned.semanticSimilarity;
    delete cleaned.hardMatch;
    return cleaned as SourceReference;
  });
  const droppedCount = Math.max(0, sources.length - finalSources.length);
  const preFilteredCount = Math.max(0, sources.length - candidateSources.length);

  return { finalSources, droppedCount, threshold, preFilteredCount };
}

function dedupeSources(sources: SourceReference[]) {
  const byUrl = new Map<string, SourceReference>();
  for (const source of sources) {
    const key = source.url.trim().toLowerCase() || source.id;
    if (!key) {
      continue;
    }

    const existing = byUrl.get(key);
    if (!existing || source.credibility > existing.credibility) {
      byUrl.set(key, source);
    }
  }

  return [...byUrl.values()];
}

function buildFallbackSearchQueries(inputText: string, parsedClaim: ParsedClaim | null) {
  const subject = parsedClaim?.subject?.trim() || extractEntityCandidate(inputText);
  const object = parsedClaim?.object?.trim() || "";
  const base = [
    `${subject} ${object}`.trim(),
    `${subject} fact check`,
    `${subject} official reference`,
  ];

  if (/\bcapital\b/i.test(inputText)) {
    base.push(`capital of ${subject}`);
    base.push(`${subject} capital city`);
  }

  return [...new Set(base.map((item) => item.trim()).filter((item) => item.length > 6))];
}

async function retrieveAndFilterSources(
  claimText: string,
  parsedClaim: ParsedClaim | null,
  claimType: ClaimType,
  assessment: ClaimAssessment,
  queryVariants: string[],
) {
  const [newsData, groundingData, institutionalData] = await Promise.all([
    fetchNewsSources(claimText, parsedClaim, claimType, queryVariants, assessment),
    fetchWikipediaAndWikidataSources(claimText, parsedClaim),
    fetchInstitutionalApiSources(claimText, parsedClaim, claimType),
  ]);

  const fetchedSources = dedupeSources([
    ...groundingData.sources,
    ...institutionalData.sources,
    ...newsData.sources,
  ]);
  const relevanceFiltered = await filterSourcesByRelevance(
    claimText,
    parsedClaim,
    claimType,
    fetchedSources,
    assessment,
  );

  const externalFailures = [
    ...groundingData.failures,
    ...institutionalData.failures,
    ...newsData.failures,
  ];

  return {
    fetchedSources,
    relevanceFiltered,
    externalFailures,
  };
}

async function retrieveSourcesWithRetries(
  claimText: string,
  parsedClaim: ParsedClaim | null,
  claimType: ClaimType,
  assessment: ClaimAssessment,
) {
  const rewrittenQueries = rewriteClaimQueries(claimText, claimType, parsedClaim, assessment);
  const fallbackQueries = buildFallbackSearchQueries(claimText, parsedClaim);

  const attempts: string[][] = [
    rewrittenQueries,
    [...rewrittenQueries, ...fallbackQueries],
  ];

  let bestSources: SourceReference[] = [];
  let bestExternalFailures: string[] = [];
  let bestRelevance = { droppedCount: 0, threshold: CLAIM_RETRIEVAL_PROFILE[claimType].relevanceThreshold, preFilteredCount: 0 };

  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    const result = await retrieveAndFilterSources(claimText, parsedClaim, claimType, assessment, attempt);

    if (result.relevanceFiltered.finalSources.length > bestSources.length) {
      bestSources = result.relevanceFiltered.finalSources;
      bestExternalFailures = [
        ...result.externalFailures,
      ];
      bestRelevance = {
        droppedCount: result.relevanceFiltered.droppedCount,
        threshold: result.relevanceFiltered.threshold,
        preFilteredCount: result.relevanceFiltered.preFilteredCount,
      };
    }

    if (result.relevanceFiltered.finalSources.length >= 2) {
      return {
        sources: result.relevanceFiltered.finalSources,
        externalFailures: result.externalFailures,
        droppedCount: result.relevanceFiltered.droppedCount,
        threshold: result.relevanceFiltered.threshold,
        preFilteredCount: result.relevanceFiltered.preFilteredCount,
      };
    }

    if (result.fetchedSources.length === 0) {
      bestExternalFailures.push(`Retrieval attempt ${index + 1} returned zero sources.`);
    }
  }

  return {
    sources: bestSources,
    externalFailures: bestExternalFailures,
    droppedCount: bestRelevance.droppedCount,
    threshold: bestRelevance.threshold,
    preFilteredCount: bestRelevance.preFilteredCount,
  };
}

async function retrieveSubClaimSources(
  inputText: string,
  parsedClaim: ParsedClaim | null,
) {
  const statements = generateSubClaimStatements(inputText, parsedClaim).slice(0, 2);
  const subClaimSources: SourceReference[] = [];
  const failures: string[] = [];

  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index];
    const statementParsed = parseClaimStructure(statement);
    const statementType = classifyClaimType(statement, statementParsed);
    const statementAssessment = assessClaimForDecisiveMode(
      statement,
      statementParsed,
      statementType,
    );

    const retrieved = await retrieveSourcesWithRetries(
      statement,
      statementParsed,
      statementType,
      statementAssessment,
    );

    for (const source of retrieved.sources.slice(0, 3)) {
      subClaimSources.push({
        ...source,
        id: `${source.id}-sub-${index + 1}`,
      });
    }

    failures.push(...retrieved.externalFailures.map((item) => `Sub-claim ${index + 1}: ${item}`));
  }

  return {
    sources: dedupeSources(subClaimSources),
    failures,
  };
}

function verificationVerdictToVerdict(verdict: VerificationVerdict): Verdict {
  if (verdict === "TRUE") {
    return "True";
  }

  if (verdict === "FALSE") {
    return "False";
  }

  if (verdict === "MIXED") {
    return "Mixed";
  }

  return "Unknown";
}

function calibrateConfidence(params: {
  baseConfidence: number;
  verdict: VerificationVerdict;
  sourceCount: number;
  supportRatio: number;
  contradictionRatio: number;
  avgAuthority: number;
  avgRelevance: number;
  isBasicFact: boolean;
  decisiveEvidence: boolean;
}) {
  const {
    baseConfidence,
    verdict,
    sourceCount,
    supportRatio,
    contradictionRatio,
    avgAuthority,
    avgRelevance,
    isBasicFact,
    decisiveEvidence,
  } = params;

  const dominance = Math.max(supportRatio, contradictionRatio);
  const coverage = clamp01(sourceCount / 4);
  const evidenceStrength = clamp01(avgAuthority * 0.55 + avgRelevance * 0.45);
  const blended = Math.round(
    baseConfidence * 0.72 + coverage * 100 * 0.1 + dominance * 100 * 0.1 + evidenceStrength * 100 * 0.08,
  );
  const consensusLift = Math.round(clamp01((dominance - 0.6) / 0.4) * 10);

  if (verdict === "UNKNOWN") {
    const cap = isBasicFact ? 54 : 64;
    return Math.min(cap, Math.max(24, blended));
  }

  if (verdict === "MIXED") {
    return Math.max(34, Math.min(78, blended));
  }

  if (isBasicFact && decisiveEvidence) {
    return Math.max(90, Math.min(97, blended + 6));
  }

  const sparsePenalty = sourceCount < 2 ? 8 : 0;
  return Math.max(40, Math.min(97, blended - sparsePenalty + consensusLift));
}

function normalizePublisherKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(news|media|inc|llc|ltd|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSourceWeight(source: SourceReference) {
  const finalScore = (source.finalScore ?? source.credibility) / 100;
  const relevance = clamp01((source.relevanceScore ?? 55) / 100);
  const authority = clamp01((source.authorityScore ?? source.domainAuthority ?? source.institutionalTrust ?? 55) / 100);
  // Penalize weakly relevant sources quadratically so they cannot dominate a verdict.
  return finalScore * (0.35 + relevance * relevance * 0.65) * (0.4 + authority * 0.6);
}

function scoreEvidence(
  sources: SourceReference[],
  claimText: string,
  parsedClaim: ParsedClaim | null,
  assessment: ClaimAssessment,
) {
  const defaultDimensions: AnalysisDimensions = {
    factualAccuracy: 45,
    sourceAgreement: 40,
    recencyScore: 45,
    biasRisk: "Medium",
  };

  const withBaseMetadata = {
    dimensions: defaultDimensions,
    biasProfile: deriveBiasProfile(claimText, sources),
    misleadingSegments: detectMisleadingSegments(claimText),
    subClaims: buildSubClaims(claimText, parsedClaim, sources),
  };

  if (assessment.needsVerification) {
    const supportWeight = sources
      .filter((item) => item.relation === "supports")
      .reduce((total, source) => total + (source.finalScore ?? source.credibility), 0);
    const contradictionWeight = sources
      .filter((item) => item.relation === "contradicts")
      .reduce((total, source) => total + (source.finalScore ?? source.credibility), 0);

    return {
      verdict: "Unknown" as const,
      confidence: Math.max(28, Math.min(48, 34 + Math.round(clamp01(sources.length / 5) * 10))),
      supportWeight,
      contradictionWeight,
      explanation: `Needs Verification: ${assessment.verificationReason ?? "This claim cannot be reliably resolved as a direct fact-check statement."}`,
      ...withBaseMetadata,
    };
  }

  if (sources.length === 0) {
    const tokenDensity = clamp01(tokenize(claimText).length / 12);
    const structuralSignal = parsedClaim ? 0.15 : 0;
    const unknownConfidence = Math.round(28 + clamp01(tokenDensity * 0.4 + structuralSignal) * 16);

    return {
      verdict: "Unknown" as const,
      confidence: unknownConfidence,
      supportWeight: 0,
      contradictionWeight: 0,
      explanation:
        "Search system failed to retrieve sources. This is a system limitation, not a reflection of the claim.",
      ...withBaseMetadata,
    };
  }

  const supportSources = sources.filter((item) => item.relation === "supports");
  const contradictionSources = sources.filter((item) => item.relation === "contradicts");
  const supportCount = supportSources.length;
  const contradictionCount = contradictionSources.length;
  const sourceCount = Math.max(1, sources.length);

  const avgRelevance =
    sources.reduce((total, source) => total + ((source.relevanceScore ?? 0) / 100), 0) / sourceCount;
  const avgAuthority =
    sources.reduce(
      (total, source) =>
        total + (((source.authorityScore ?? source.domainAuthority ?? source.institutionalTrust ?? 0) as number) / 100),
      0,
    ) / sourceCount;
  const contradictionAuthority =
    contradictionCount === 0
      ? 0
      : contradictionSources.reduce(
          (total, source) =>
            total + (((source.authorityScore ?? source.domainAuthority ?? source.institutionalTrust ?? 0) as number) / 100),
          0,
        ) / contradictionCount;
  const supportWeight = supportSources.reduce((total, source) => total + extractSourceWeight(source) * 100, 0);
  const contradictionWeight = contradictionSources.reduce((total, source) => total + extractSourceWeight(source) * 100, 0);
  const totalWeightedEvidence = Math.max(1e-6, supportWeight + contradictionWeight);
  const supportRatio = supportWeight / totalWeightedEvidence;
  const contradictionRatio = contradictionWeight / totalWeightedEvidence;

  const supportPublishers = new Set(
    supportSources.map((source) => normalizePublisherKey(source.publisher)).filter(Boolean),
  );
  const contradictionPublishers = new Set(
    contradictionSources.map((source) => normalizePublisherKey(source.publisher)).filter(Boolean),
  );
  const dominantPublisherDiversity =
    supportRatio >= contradictionRatio
      ? clamp01(supportPublishers.size / Math.max(2, supportCount))
      : clamp01(contradictionPublishers.size / Math.max(2, contradictionCount));
  const agreementScore = clamp01(Math.max(supportRatio, contradictionRatio) * 0.72 + dominantPublisherDiversity * 0.28);

  // Confidence is intentionally deterministic and aligned with the requested weighted formula.
  const baseConfidence = Math.round(
    clamp01(avgRelevance * 0.5 + agreementScore * 0.3 + avgAuthority * 0.2) * 100,
  );

  let normalizedVerdict: VerificationVerdict = "UNKNOWN";

  const statusClaim = assessment.statusClaim;
  const supportAuthorityStrong =
    supportCount === 0
      ? 0
      : supportSources.reduce((total, source) => total + ((source.authorityScore ?? 55) / 100), 0) / supportCount;
  const contradictionAuthorityStrong =
    contradictionCount === 0
      ? 0
      : contradictionSources.reduce((total, source) => total + ((source.authorityScore ?? 55) / 100), 0) / contradictionCount;
  const supportQualitySignals = supportSources.filter((source) => {
    const text = `${source.title} ${source.snippet}`.toLowerCase();
    if (statusClaim === "dead") {
      return /\b(obituary|died|deceased|death announced|passed away)\b/.test(text);
    }

    if (statusClaim === "alive") {
      return /\b(alive|living|currently|incumbent|remains)\b/.test(text);
    }

    return true;
  }).length;

  if (statusClaim === "dead" || statusClaim === "alive") {
    if (
      supportRatio >= 0.78 &&
      supportCount >= 3 &&
      supportPublishers.size >= 3 &&
      supportAuthorityStrong >= 0.72 &&
      supportQualitySignals >= 2 &&
      contradictionRatio <= 0.12
    ) {
      normalizedVerdict = "TRUE";
    } else if (
      contradictionRatio >= 0.6 &&
      contradictionCount >= 2 &&
      contradictionPublishers.size >= 2 &&
      contradictionAuthorityStrong >= 0.66
    ) {
      normalizedVerdict = "FALSE";
    } else if (supportCount === 0 && contradictionCount >= 1 && contradictionAuthorityStrong >= 0.72) {
      normalizedVerdict = "FALSE";
    } else {
      normalizedVerdict = "UNKNOWN";
    }
  }

  if (
    normalizedVerdict === "UNKNOWN" &&
    supportCount === 0 &&
    contradictionCount >= 1 &&
    (contradictionAuthority >= 0.72 || contradictionSources.some((source) => (source.finalScore ?? source.credibility) >= 72))
  ) {
    normalizedVerdict = "FALSE";
  }

  if (normalizedVerdict === "UNKNOWN" && supportCount >= 2 && supportRatio >= 0.67) {
    normalizedVerdict = "TRUE";
  } else if (normalizedVerdict === "UNKNOWN" && contradictionCount >= 2 && contradictionRatio >= 0.67) {
    normalizedVerdict = "FALSE";
  } else if (normalizedVerdict === "UNKNOWN" && supportCount > 0 && contradictionCount > 0) {
    normalizedVerdict = "MIXED";
  }

  const dominantPublisherCount = supportRatio >= contradictionRatio ? supportPublishers.size : contradictionPublishers.size;
  const dominantSourceCount = supportRatio >= contradictionRatio ? supportCount : contradictionCount;
  const shallowAgreement = dominantSourceCount >= 2 && dominantPublisherCount < 2;

  if ((normalizedVerdict === "TRUE" || normalizedVerdict === "FALSE") && shallowAgreement) {
    normalizedVerdict = "UNKNOWN";
  }

  if (assessment.isBasicFact && normalizedVerdict === "MIXED" && Math.abs(supportRatio - contradictionRatio) >= 0.2) {
    normalizedVerdict = supportRatio > contradictionRatio ? "TRUE" : "FALSE";
  }

  if (assessment.isBasicFact && normalizedVerdict === "UNKNOWN" && (supportWeight > 0 || contradictionWeight > 0)) {
    normalizedVerdict = supportWeight >= contradictionWeight ? "TRUE" : "FALSE";
  }

  const lowControversy = Math.min(supportRatio, contradictionRatio) <= 0.1;
  const highConsensus = agreementScore >= 0.8;

  const recencyScore = Math.round(
    sources.reduce((acc, source) => acc + (source.recencyScore ?? 55), 0) / sourceCount,
  );
  const biasProfile = deriveBiasProfile(claimText, sources);
  const dimensions: AnalysisDimensions = {
    factualAccuracy: Math.round(clamp01(avgRelevance * 0.55 + avgAuthority * 0.45) * 100),
    sourceAgreement: Math.round(Math.max(supportRatio, contradictionRatio) * 100),
    recencyScore,
    biasRisk: biasProfile.manipulationRisk,
  };

  const explanation =
    normalizedVerdict === "TRUE"
      ? `Most high-authority and semantically relevant sources support the claim (${supportCount}/${sourceCount}).`
      : normalizedVerdict === "FALSE"
        ? supportCount === 0 && contradictionCount === 1
          ? "A high-authority source directly contradicts the claim, and no supporting evidence was found."
          : `Most high-authority and semantically relevant sources contradict the claim (${contradictionCount}/${sourceCount}).`
        : normalizedVerdict === "MIXED"
          ? `Evidence is split across strong sources: ${supportCount} support and ${contradictionCount} contradict.`
          : assessment.isBasicFact
            ? "Decisive fact mode enabled, but evidence remained too weak or too neutral to force a reliable verdict."
            : "Evidence is insufficient or weakly consistent after strict relevance and authority filtering.";

  const decisiveEvidence =
    assessment.isBasicFact &&
    normalizedVerdict !== "UNKNOWN" &&
    sourceCount >= 2 &&
    avgAuthority >= 0.72 &&
    Math.max(supportRatio, contradictionRatio) >= 0.66;
  const adjustedConfidence = calibrateConfidence({
    baseConfidence:
      highConsensus && lowControversy && sourceCount >= 3
        ? Math.min(99, baseConfidence + 8)
        : baseConfidence,
    verdict: normalizedVerdict,
    sourceCount,
    supportRatio,
    contradictionRatio,
    avgAuthority,
    avgRelevance,
    isBasicFact: assessment.isBasicFact,
    decisiveEvidence,
  });

  return {
    verdict: verificationVerdictToVerdict(normalizedVerdict),
    confidence: adjustedConfidence,
    supportWeight,
    contradictionWeight,
    explanation,
    dimensions,
    biasProfile,
    misleadingSegments: detectMisleadingSegments(claimText),
    subClaims: buildSubClaims(claimText, parsedClaim, sources),
  };
}

function toLegacySourceNodes(sources: SourceReference[]) {
  return sources.map((source, index) => {
    const hash = Number.parseInt(hashValue(source.id).slice(0, 8), 16);
    return {
      id: source.id,
      label: `S${index + 1}`,
      title: source.title,
      source: source.publisher,
      credibility: source.credibility,
      relation: source.relation,
      summary: source.snippet,
      x: 14 + ((hash + index * 23) % 72),
      y: 18 + ((hash + index * 17) % 62),
      tier: source.tier,
      domainAuthorityTier: source.domainAuthorityTier,
      recencyScore: source.recencyScore,
      domainAuthority: source.domainAuthority,
      institutionalTrust: source.institutionalTrust,
    };
  });
}

function extractTags(input: string) {
  const rules: Array<{ pattern: RegExp; tag: string }> = [
    { pattern: /(econom|inflation|market|trade|gdp|stocks)/i, tag: "Economy" },
    { pattern: /(health|hospital|disease|vaccine|medical)/i, tag: "Health" },
    { pattern: /(climate|carbon|energy|environment)/i, tag: "Climate" },
    { pattern: /(election|government|law|policy)/i, tag: "Policy" },
    { pattern: /(technology|ai|software|chip|cyber)/i, tag: "Technology" },
  ];

  const tags = rules.filter((rule) => rule.pattern.test(input)).map((rule) => rule.tag);
  return tags.length > 0 ? tags.slice(0, 4) : ["General"];
}

function jaccardSimilarity(left: string, right: string) {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / (leftTokens.size + rightTokens.size - overlap);
}

async function findSimilarClaims(currentInput: string, currentResultId?: string): Promise<SimilarClaim[]> {
  const { queries, results } = await getCollections();
  const candidates = await queries.find({}, { sort: { createdAt: -1 }, limit: 120 }).toArray();
  if (candidates.length === 0) {
    return [];
  }

  const resultIds = candidates
    .map((candidate) => candidate.resultId)
    .filter((resultId): resultId is ObjectId => Boolean(resultId));

  const docs = resultIds.length > 0 ? await results.find({ _id: { $in: resultIds } }).toArray() : [];
  const resultMap = new Map(docs.map((doc) => [doc._id?.toString(), doc]));

  return candidates
    .map((candidate) => {
      const resultId = candidate.resultId?.toString();
      if (!resultId || resultId === currentResultId) {
        return null;
      }

      const similarity = Math.round(jaccardSimilarity(currentInput, candidate.rawInput) * 100);
      if (similarity < 35) {
        return null;
      }

      const resultDoc = resultMap.get(resultId);
      return {
        id: resultId,
        claim: candidate.rawInput,
        verdict: resultDoc?.verdict ?? "Unknown",
        confidence: resultDoc?.confidence ?? 0,
        similarity,
      } satisfies SimilarClaim;
    })
    .filter((item): item is SimilarClaim => Boolean(item))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5);
}


async function getCollections() {
  const client = await connectToDatabase();
  const db = client.db(DB_NAME);

  return {
    users: db.collection<UserDoc>("users"),
    queries: db.collection<QueryDoc>("queries"),
    results: db.collection<ResultDoc>("results"),
  };
}

async function touchUser(userId?: string) {
  if (!userId) {
    return;
  }

  const { users } = await getCollections();
  await users.updateOne(
    { clerkUserId: userId },
    {
      $set: { lastSeenAt: new Date() },
      $setOnInsert: {
        clerkUserId: userId,
        createdAt: new Date(),
      },
    },
    { upsert: true },
  );
}

function resultToResponse(
  result: ResultDoc & { _id: ObjectId },
  input: string,
  inputType: "text" | "url",
  cached: boolean,
  similarClaims: SimilarClaim[] = [],
): AnalysisResponse {
  const defaultDimensions: AnalysisDimensions = {
    factualAccuracy: 45,
    sourceAgreement: 40,
    recencyScore: 45,
    biasRisk: "Medium",
  };

  const defaultBiasProfile: BiasProfile = {
    politicalBias: "Centrist/Unclear",
    emotionalLanguage: "Low",
    manipulationRisk: "Medium",
  };

  return {
    id: result._id.toString(),
    input,
    inputType,
    verdict: result.verdict,
    explanation: result.explanation,
    sources: result.sources,
    confidence: result.confidence,
    dimensions: result.dimensions ?? defaultDimensions,
    biasProfile: result.biasProfile ?? defaultBiasProfile,
    misleadingSegments: result.misleadingSegments ?? [],
    subClaims: result.subClaims ?? [],
    similarClaims,
    cached,
    createdAt: result.createdAt,
    updatedAt: result.updatedAt,
  };
}

export function parseInputPayload(payload: { claim?: unknown; input?: unknown; url?: unknown } | null) {
  return parseInput(payload);
}

async function runAnalysisPipeline(input: string, parsedClaim: ParsedClaim | null) {
  const resolved = await resolveInputText(input);
  const resolvedParsedClaim = parseClaimStructure(resolved.inputText) ?? parsedClaim;

  const commonKnowledge = commonKnowledgeCapitalOverride(resolved.inputText, resolvedParsedClaim);
  if (commonKnowledge) {
    const supportWeight = commonKnowledge.sources
      .filter((source) => source.relation === "supports")
      .reduce((total, source) => total + (source.finalScore ?? source.credibility), 0);
    const contradictionWeight = commonKnowledge.sources
      .filter((source) => source.relation === "contradicts")
      .reduce((total, source) => total + (source.finalScore ?? source.credibility), 0);
    const biasProfile = deriveBiasProfile(resolved.inputText, commonKnowledge.sources);

    return {
      resolvedInputText: resolved.inputText,
      resolvedParsedClaim,
      assessment: {
        isBasicFact: true,
        category: "geography" as const,
        decisivePrompt:
          "Common-knowledge fast check applied for a stable geography fact.",
        isHighCertaintyFact: true,
        statusClaim: null,
      },
      scoring: {
        verdict: commonKnowledge.verdict,
        confidence: commonKnowledge.confidence,
        explanation: commonKnowledge.explanation,
        supportWeight,
        contradictionWeight,
        dimensions: {
          factualAccuracy: 97,
          sourceAgreement: 96,
          recencyScore: 90,
          biasRisk: biasProfile.manipulationRisk,
        },
        biasProfile,
        misleadingSegments: detectMisleadingSegments(resolved.inputText),
        subClaims: buildSubClaims(resolved.inputText, resolvedParsedClaim, commonKnowledge.sources),
      },
      sources: commonKnowledge.sources,
      externalFailures: [
        ...resolved.externalFailures,
        "High-certainty common-knowledge override used for a stable capital-city claim.",
      ],
      droppedCount: 0,
      preFilteredCount: 0,
      threshold: CLAIM_RETRIEVAL_PROFILE[classifyClaimType(resolved.inputText, resolvedParsedClaim)].relevanceThreshold,
    };
  }

  const commonKnowledgeCeo = await commonKnowledgeCeoOverride(resolved.inputText, resolvedParsedClaim);
  if (commonKnowledgeCeo) {
    const supportWeight = commonKnowledgeCeo.sources
      .filter((source) => source.relation === "supports")
      .reduce((total, source) => total + (source.finalScore ?? source.credibility), 0);
    const contradictionWeight = commonKnowledgeCeo.sources
      .filter((source) => source.relation === "contradicts")
      .reduce((total, source) => total + (source.finalScore ?? source.credibility), 0);
    const biasProfile = deriveBiasProfile(resolved.inputText, commonKnowledgeCeo.sources);

    return {
      resolvedInputText: resolved.inputText,
      resolvedParsedClaim,
      assessment: {
        isBasicFact: true,
        category: "historical" as const,
        decisivePrompt:
          "Common-knowledge fast check applied for stable role/title fact.",
        isHighCertaintyFact: true,
        statusClaim: null,
      },
      scoring: {
        verdict: commonKnowledgeCeo.verdict,
        confidence: commonKnowledgeCeo.confidence,
        explanation: commonKnowledgeCeo.explanation,
        supportWeight,
        contradictionWeight,
        dimensions: {
          factualAccuracy: 95,
          sourceAgreement: 92,
          recencyScore: 86,
          biasRisk: biasProfile.manipulationRisk,
        },
        biasProfile,
        misleadingSegments: detectMisleadingSegments(resolved.inputText),
        subClaims: buildSubClaims(resolved.inputText, resolvedParsedClaim, commonKnowledgeCeo.sources),
      },
      sources: commonKnowledgeCeo.sources,
      externalFailures: [
        ...resolved.externalFailures,
        "High-certainty common-knowledge override used for CEO role claim.",
      ],
      droppedCount: 0,
      preFilteredCount: 0,
      threshold: CLAIM_RETRIEVAL_PROFILE[classifyClaimType(resolved.inputText, resolvedParsedClaim)].relevanceThreshold,
    };
  }

  const commonKnowledgeLifeStatus = await commonKnowledgeLifeStatusOverride(
    resolved.inputText,
    resolvedParsedClaim,
  );
  if (commonKnowledgeLifeStatus) {
    const supportWeight = commonKnowledgeLifeStatus.sources
      .filter((source) => source.relation === "supports")
      .reduce((total, source) => total + (source.finalScore ?? source.credibility), 0);
    const contradictionWeight = commonKnowledgeLifeStatus.sources
      .filter((source) => source.relation === "contradicts")
      .reduce((total, source) => total + (source.finalScore ?? source.credibility), 0);
    const biasProfile = deriveBiasProfile(resolved.inputText, commonKnowledgeLifeStatus.sources);

    return {
      resolvedInputText: resolved.inputText,
      resolvedParsedClaim,
      assessment: {
        isBasicFact: true,
        category: "historical" as const,
        decisivePrompt:
          "Common-knowledge fast check applied for life-status fact.",
        isHighCertaintyFact: true,
        statusClaim: /\b(dead|deceased|died)\b/i.test(resolved.inputText) ? "dead" : "alive",
      },
      scoring: {
        verdict: commonKnowledgeLifeStatus.verdict,
        confidence: commonKnowledgeLifeStatus.confidence,
        explanation: commonKnowledgeLifeStatus.explanation,
        supportWeight,
        contradictionWeight,
        dimensions: {
          factualAccuracy: 95,
          sourceAgreement: 93,
          recencyScore: 86,
          biasRisk: biasProfile.manipulationRisk,
        },
        biasProfile,
        misleadingSegments: detectMisleadingSegments(resolved.inputText),
        subClaims: buildSubClaims(resolved.inputText, resolvedParsedClaim, commonKnowledgeLifeStatus.sources),
      },
      sources: commonKnowledgeLifeStatus.sources,
      externalFailures: [
        ...resolved.externalFailures,
        "High-certainty common-knowledge override used for life-status claim.",
      ],
      droppedCount: 0,
      preFilteredCount: 0,
      threshold: CLAIM_RETRIEVAL_PROFILE[classifyClaimType(resolved.inputText, resolvedParsedClaim)].relevanceThreshold,
    };
  }

  const claimType = classifyClaimType(resolved.inputText, resolvedParsedClaim);
  const assessment = assessClaimForDecisiveMode(
    resolved.inputText,
    resolvedParsedClaim,
    claimType,
  );

  if (assessment.needsVerification) {
    const biasProfile = deriveBiasProfile(resolved.inputText, []);
    return {
      resolvedInputText: resolved.inputText,
      resolvedParsedClaim,
      assessment,
      scoring: {
        verdict: "Unknown" as const,
        confidence: 38,
        explanation: `Needs Verification: ${assessment.verificationReason ?? "This claim is not suitable for deterministic fact-check verdicts."}`,
        supportWeight: 0,
        contradictionWeight: 0,
        dimensions: {
          factualAccuracy: 42,
          sourceAgreement: 30,
          recencyScore: 45,
          biasRisk: biasProfile.manipulationRisk,
        },
        biasProfile,
        misleadingSegments: detectMisleadingSegments(resolved.inputText),
        subClaims: buildSubClaims(resolved.inputText, resolvedParsedClaim, []),
      },
      sources: [],
      externalFailures: [
        ...resolved.externalFailures,
        "Needs verification mode activated for subjective/speculative claim.",
      ],
      droppedCount: 0,
      preFilteredCount: 0,
      threshold: CLAIM_RETRIEVAL_PROFILE[claimType].relevanceThreshold,
    };
  }

  const structuredOverrides = await Promise.all([
    commonKnowledgeOrbitOverride(resolved.inputText, resolvedParsedClaim),
    commonKnowledgeScienceIsAOverride(resolved.inputText, resolvedParsedClaim),
    commonKnowledgeAtomicNumberOverride(resolved.inputText, resolvedParsedClaim),
    commonKnowledgeBornInOverride(resolved.inputText, resolvedParsedClaim),
    commonKnowledgeDiedInOverride(resolved.inputText, resolvedParsedClaim),
    commonKnowledgeSpouseOverride(resolved.inputText, resolvedParsedClaim),
    commonKnowledgeFounderOverride(resolved.inputText, resolvedParsedClaim),
    commonKnowledgePresidentOverride(resolved.inputText, resolvedParsedClaim),
    commonKnowledgePrimeMinisterOverride(resolved.inputText, resolvedParsedClaim),
    commonKnowledgeHeadquartersOverride(resolved.inputText, resolvedParsedClaim),
  ]);
  const firstStructuredOverride = structuredOverrides.find((item) => Boolean(item)) ?? null;

  if (firstStructuredOverride) {
    const supportWeight = firstStructuredOverride.sources
      .filter((source) => source.relation === "supports")
      .reduce((total, source) => total + (source.finalScore ?? source.credibility), 0);
    const contradictionWeight = firstStructuredOverride.sources
      .filter((source) => source.relation === "contradicts")
      .reduce((total, source) => total + (source.finalScore ?? source.credibility), 0);
    const biasProfile = deriveBiasProfile(resolved.inputText, firstStructuredOverride.sources);

    return {
      resolvedInputText: resolved.inputText,
      resolvedParsedClaim,
      assessment: {
        isBasicFact: true,
        category: "historical" as const,
        decisivePrompt:
          "Common-knowledge fast check applied for stable role/location fact.",
        isHighCertaintyFact: true,
        statusClaim: null,
      },
      scoring: {
        verdict: firstStructuredOverride.verdict,
        confidence: firstStructuredOverride.confidence,
        explanation: firstStructuredOverride.explanation,
        supportWeight,
        contradictionWeight,
        dimensions: {
          factualAccuracy: 95,
          sourceAgreement: 92,
          recencyScore: 86,
          biasRisk: biasProfile.manipulationRisk,
        },
        biasProfile,
        misleadingSegments: detectMisleadingSegments(resolved.inputText),
        subClaims: buildSubClaims(resolved.inputText, resolvedParsedClaim, firstStructuredOverride.sources),
      },
      sources: firstStructuredOverride.sources,
      externalFailures: [
        ...resolved.externalFailures,
        "High-certainty common-knowledge override used for role/location claim.",
      ],
      droppedCount: 0,
      preFilteredCount: 0,
      threshold: CLAIM_RETRIEVAL_PROFILE[classifyClaimType(resolved.inputText, resolvedParsedClaim)].relevanceThreshold,
    };
  }

  const primaryRetrieval = await retrieveSourcesWithRetries(
    resolved.inputText,
    resolvedParsedClaim,
    claimType,
    assessment,
  );
  const subClaimRetrieval = await retrieveSubClaimSources(
    resolved.inputText,
    resolvedParsedClaim,
  );

  const sources = dedupeSources([
    ...primaryRetrieval.sources,
    ...subClaimRetrieval.sources,
  ]);
  const scoring = scoreEvidence(sources, resolved.inputText, resolvedParsedClaim, assessment);

  const externalFailures = [
    ...resolved.externalFailures,
    ...primaryRetrieval.externalFailures,
    ...subClaimRetrieval.failures,
  ];

  if (primaryRetrieval.droppedCount > 0) {
    externalFailures.push(
      `Filtered ${primaryRetrieval.droppedCount} low-relevance sources below threshold ${primaryRetrieval.threshold}.`,
    );
  }
  if (primaryRetrieval.preFilteredCount > 0) {
    externalFailures.push(
      `Dropped ${primaryRetrieval.preFilteredCount} irrelevant sources before semantic evaluation.`,
    );
  }
  if (assessment.isBasicFact) {
    externalFailures.push(`Decisive fact-check directive enabled. ${assessment.decisivePrompt}`);
  }
  if (sources.length === 0) {
    externalFailures.push(
      "All retrieval retries returned no usable sources. Debug: retrieval-empty-after-retry.",
    );
  }

  return {
    resolvedInputText: resolved.inputText,
    resolvedParsedClaim,
    assessment,
    scoring,
    sources,
    externalFailures,
    droppedCount: primaryRetrieval.droppedCount,
    preFilteredCount: primaryRetrieval.preFilteredCount,
    threshold: primaryRetrieval.threshold,
  };
}

export async function createAnalysis(input: string, userId?: string) {
  const { queries, results } = await getCollections();
  await touchUser(userId);

  const inputType = getInputType(input);
  const normalizedInput = normalizeInput(input);
  const parsedClaim = parseClaimStructure(inputType === "text" ? input : "");
  const parsedClaimValue = parsedClaim ?? undefined;
  const dedupeKey = buildDedupeKey(normalizedInput);
  const now = new Date();
  const existing = await results.findOne({ dedupeKey }, { sort: { createdAt: -1 } });
  if (existing?._id) {
    const similarClaims = await findSimilarClaims(input, existing._id.toString());
    return {
      analysis: resultToResponse(
        existing as ResultDoc & { _id: ObjectId },
        input,
        inputType,
        true,
        similarClaims,
      ),
      queryId: existing.queryId.toString(),
      resultId: existing._id.toString(),
    };
  }

  const pipeline = await runAnalysisPipeline(input, parsedClaim);
  const sources = pipeline.sources;
  const scoring = pipeline.scoring;
  const externalFailures = pipeline.externalFailures;

  const queryInsert = await queries.insertOne({
    rawInput: input,
    inputType,
    normalizedInput,
    dedupeKey,
    parsedClaim: parsedClaimValue,
    userId,
    cacheHit: false,
    sourcesUsed: sources.map((source) => source.publisher),
    createdAt: now,
  });

  const resultInsert = await results.insertOne({
    queryId: queryInsert.insertedId,
    dedupeKey,
    userId,
    verdict: scoring.verdict,
    explanation: scoring.explanation,
    confidence: scoring.confidence,
    sources,
    supportWeight: scoring.supportWeight,
    contradictionWeight: scoring.contradictionWeight,
    dimensions: scoring.dimensions,
    biasProfile: scoring.biasProfile,
    misleadingSegments: scoring.misleadingSegments,
    subClaims: scoring.subClaims,
    externalFailures,
    createdAt: now,
  });

  await queries.updateOne(
    { _id: queryInsert.insertedId },
    {
      $set: {
        resultId: resultInsert.insertedId,
      },
    },
  );

  const similarClaims = await findSimilarClaims(input, resultInsert.insertedId.toString());


  const resultDoc: ResultDoc & { _id: ObjectId } = {
    _id: resultInsert.insertedId,
    queryId: queryInsert.insertedId,
    dedupeKey,
    userId,
    verdict: scoring.verdict,
    explanation: scoring.explanation,
    confidence: scoring.confidence,
    sources,
    supportWeight: scoring.supportWeight,
    contradictionWeight: scoring.contradictionWeight,
    dimensions: scoring.dimensions,
    biasProfile: scoring.biasProfile,
    misleadingSegments: scoring.misleadingSegments,
    subClaims: scoring.subClaims,
    externalFailures,
    createdAt: now,
  };

  return {
    analysis: resultToResponse(resultDoc, input, inputType, false, similarClaims),
    queryId: queryInsert.insertedId.toString(),
    resultId: resultInsert.insertedId.toString(),
  };
}

export async function getResultById(id: string) {
  if (!ObjectId.isValid(id)) {
    return null;
  }

  const { results, queries } = await getCollections();
  const result = await results.findOne({ _id: new ObjectId(id) });
  if (!result?._id) {
    return null;
  }

  const query = await queries.findOne({ _id: result.queryId });
  const input = query?.rawInput ?? "Unknown input";
  const inputType = query?.inputType ?? "text";

  const similarClaims = await findSimilarClaims(input, result._id.toString());
  return resultToResponse(result as ResultDoc & { _id: ObjectId }, input, inputType, false, similarClaims);
}

export async function getLatestResult() {
  const { results, queries } = await getCollections();
  const result = await results.findOne({}, { sort: { createdAt: -1 } });
  if (!result?._id) {
    return null;
  }

  const query = await queries.findOne({ _id: result.queryId });
  const input = query?.rawInput ?? "Unknown input";
  const inputType = query?.inputType ?? "text";

  const similarClaims = await findSimilarClaims(input, result._id.toString());
  return resultToResponse(result as ResultDoc & { _id: ObjectId }, input, inputType, false, similarClaims);
}

export async function getHistory(limit = 50): Promise<HistoryEntry[]> {
  const { queries, results } = await getCollections();
  const queryList = await queries.find({}, { sort: { createdAt: -1 }, limit }).toArray();
  if (queryList.length === 0) {
    return [];
  }

  const resultIds = queryList
    .map((item) => item.resultId)
    .filter((item): item is ObjectId => Boolean(item));

  const resultDocs = resultIds.length > 0 ? await results.find({ _id: { $in: resultIds } }).toArray() : [];
  const resultMap = new Map(resultDocs.map((item) => [item._id!.toString(), item]));

  return queryList.map((query) => {
    const result = query.resultId ? resultMap.get(query.resultId.toString()) : undefined;

    return {
      queryId: query._id?.toString() ?? "",
      resultId: query.resultId?.toString() ?? "",
      input: query.rawInput,
      inputType: query.inputType,
      verdict: result?.verdict ?? "Unknown",
      confidence: result?.confidence ?? 0,
      sourcesUsed: query.sourcesUsed,
      cacheHit: query.cacheHit,
      createdAt: query.createdAt,
    };
  });
}

export async function updateAnalysis(resultId: string, input: string, userId?: string) {
  if (!ObjectId.isValid(resultId)) {
    return { error: "Valid claimId is required" as const };
  }

  const { results, queries } = await getCollections();
  const existing = await results.findOne({ _id: new ObjectId(resultId) });

  if (!existing?._id) {
    return { error: "Claim not found" as const };
  }

  const inputType = getInputType(input);
  const parsedClaim = parseClaimStructure(inputType === "text" ? input : "");
  const parsedClaimValue = parsedClaim ?? undefined;
  const pipeline = await runAnalysisPipeline(input, parsedClaim);
  const sources = pipeline.sources;
  const scoring = pipeline.scoring;
  const externalFailures = pipeline.externalFailures;
  const now = new Date();

  await results.updateOne(
    { _id: existing._id },
    {
      $set: {
        verdict: scoring.verdict,
        explanation: scoring.explanation,
        confidence: scoring.confidence,
        sources,
        supportWeight: scoring.supportWeight,
        contradictionWeight: scoring.contradictionWeight,
        dimensions: scoring.dimensions,
        biasProfile: scoring.biasProfile,
        misleadingSegments: scoring.misleadingSegments,
        subClaims: scoring.subClaims,
        externalFailures,
        updatedAt: now,
        userId,
      },
    },
  );

  await queries.updateOne(
    { _id: existing.queryId },
    {
      $set: {
        rawInput: input,
        inputType,
        normalizedInput: normalizeInput(input),
        dedupeKey: buildDedupeKey(normalizeInput(input)),
        parsedClaim: parsedClaimValue,
        sourcesUsed: sources.map((source) => source.publisher),
      },
    },
  );

  const updated = await results.findOne({ _id: existing._id });
  const query = await queries.findOne({ _id: existing.queryId });

  if (!updated?._id) {
    return { error: "Claim not found" as const };
  }

  return {
    analysis: resultToResponse(
      updated as ResultDoc & { _id: ObjectId },
      query?.rawInput ?? input,
      query?.inputType ?? inputType,
      false,
    ),
  };
}

export async function deleteAnalysis(resultId: string) {
  if (!ObjectId.isValid(resultId)) {
    return { error: "Valid claimId is required" as const };
  }

  const { results, queries } = await getCollections();
  const objectId = new ObjectId(resultId);
  const existing = await results.findOne({ _id: objectId });
  if (!existing?._id) {
    return { error: "Claim not found" as const };
  }

  await results.deleteOne({ _id: objectId });
  await queries.updateMany({ resultId: objectId }, { $unset: { resultId: "" } });

  return { ok: true };
}

export function toLegacyClaimPayload(analysis: AnalysisResponse): LegacyClaimResponse {
  return {
    id: analysis.id,
    claim: analysis.input,
    verdict: analysis.verdict,
    confidence: analysis.confidence,
    analysisSummary: analysis.explanation,
    tags: extractTags(analysis.input),
    sourceNodes: toLegacySourceNodes(analysis.sources),
    sources: analysis.sources,
    explanation: analysis.explanation,
    dimensions: analysis.dimensions,
    biasProfile: analysis.biasProfile,
    misleadingSegments: analysis.misleadingSegments,
    subClaims: analysis.subClaims,
    similarClaims: analysis.similarClaims,
    createdAt: analysis.createdAt,
    updatedAt: analysis.updatedAt,
  };
}

export async function compareClaimPerspectives(input: string, userId?: string): Promise<ComparisonResult> {
  const created = await createAnalysis(input, userId);
  const analysis = created.analysis;

  const argumentsFor = analysis.sources
    .filter((source) => source.relation === "supports")
    .slice(0, 4)
    .map((source) => `${source.publisher}: ${source.snippet}`);

  const argumentsAgainst = analysis.sources
    .filter((source) => source.relation === "contradicts")
    .slice(0, 4)
    .map((source) => `${source.publisher}: ${source.snippet}`);

  const balancedVerdict =
    argumentsFor.length > 0 && argumentsAgainst.length > 0
      ? "Mixed"
      : analysis.verdict;

  return {
    claim: analysis.input,
    argumentsFor,
    argumentsAgainst,
    balancedVerdict,
    rationale:
      balancedVerdict === "Mixed"
        ? "Both supporting and contradicting evidence were found across independent sources."
        : analysis.explanation,
    dimensions: analysis.dimensions,
  };
}

export const __testHooks = {
  buildFallbackSearchQueries,
  commonKnowledgeCapitalOverride,
  commonKnowledgeCeoOverride,
  commonKnowledgeLifeStatusOverride,
  commonKnowledgeOrbitOverride,
  commonKnowledgeScienceIsAOverride,
  commonKnowledgeAtomicNumberOverride,
  commonKnowledgeBornInOverride,
  commonKnowledgeDiedInOverride,
  commonKnowledgeSpouseOverride,
  commonKnowledgeFounderOverride,
  commonKnowledgePresidentOverride,
  commonKnowledgePrimeMinisterOverride,
  commonKnowledgeHeadquartersOverride,
  scoreEvidence,
  generateSubClaimStatements,
};
