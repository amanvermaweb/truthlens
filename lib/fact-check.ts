import { connectToDatabase } from "@/lib/mongodb";
import {
  commonKnowledgeAiFallbackOverride,
  commonKnowledgeAtomicNumberOverride,
  commonKnowledgeBoilingPointOverride,
  commonKnowledgeBornInOverride,
  commonKnowledgeCapitalOverride,
  commonKnowledgeCeoOverride,
  commonKnowledgeDiedInOverride,
  commonKnowledgeFounderOverride,
  commonKnowledgeHeadquartersOverride,
  commonKnowledgeLifeStatusOverride,
  commonKnowledgeOrbitOverride,
  commonKnowledgePresidentOverride,
  commonKnowledgePrimeMinisterOverride,
  commonKnowledgeScienceIsAOverride,
  commonKnowledgeSpouseOverride,
  commonKnowledgeUltraBasicOverride,
} from "@/lib/fact-check/common-knowledge";
import { createRunAnalysisPipeline } from "@/lib/fact-check/pipeline/run-analysis";
import {
  ClaimAssessment,
  ClaimType,
  ParsedClaim,
} from "@/lib/fact-check/pipeline/types";
import {
  assessClaimForDecisiveMode,
  buildDedupeKey,
  clamp01,
  classifyClaim,
  classifyClaimType,
  extractEntityCandidate,
  getInputType,
  hashValue,
  normalizeInput,
  parseClaimStructure,
  parseInput,
  rewriteClaimQueries,
  tokenize,
} from "@/lib/fact-check/claim-utils";
import {
  getEmbedding,
  getEmbeddings,
} from "@/lib/fact-check/embedding-utils";
import {
  computeSourceRelevance,
  passHardRelevanceFilter,
} from "@/lib/fact-check/relevance-utils";
import { fetchInstitutionalApiSources } from "@/lib/fact-check/institutional-sources";
import {
  computeEvidenceQuality,
  buildTrustModel,
  domainAuthorityTier,
  getDomainAuthority,
} from "@/lib/fact-check/trust-utils";
import {
  computeAgreementScore,
  detectStance,
  evaluateRelation,
  SourceStance,
} from "@/lib/fact-check/stance-utils";
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

const DB_NAME = process.env.MONGODB_DB_NAME ?? "truth-lens";
const REQUEST_TIMEOUT_MS = 3000;
const ANALYSIS_MODEL_VERSION = "v15";

export { classifyClaim, detectStance, getDomainAuthority };

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

const MIN_DOMAIN_AUTHORITY = 0.4;
const MIN_RELAXED_SEMANTIC_THRESHOLD = 0.5;
const MIN_RELAXED_RELEVANCE_THRESHOLD = 46;

type VerificationSourceScore = {
  relevanceScore: number;
  authorityScore: number;
  stance: SourceStance;
  finalScore: number;
  semanticSimilarity: number;
  hardMatch: boolean;
};

type VerificationVerdict = "TRUE" | "FALSE" | "MIXED" | "UNKNOWN";

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
  const threshold = assessment.isBasicFact
    ? Math.max(50, profile.relevanceThreshold - 20)
    : profile.relevanceThreshold;
  const semanticThreshold = assessment.isBasicFact
    ? Math.max(MIN_RELAXED_SEMANTIC_THRESHOLD, profile.semanticThreshold - 0.15)
    : profile.semanticThreshold;
  const authorityThreshold = assessment.isBasicFact ? 0.3 : MIN_DOMAIN_AUTHORITY;
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
    .filter((source) => source.semanticSimilarity >= semanticThreshold)
    .filter((source) => source.hardMatch || (assessment.isBasicFact && source.stance !== "neutral"))
    .filter((source) => ((source.authorityScore ?? 0) / 100) >= authorityThreshold)
    .filter((source) => (source.relevanceScore ?? 0) >= threshold)
    .sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0));

  const relaxedSemanticThreshold = Math.max(
    MIN_RELAXED_SEMANTIC_THRESHOLD,
    semanticThreshold - 0.15,
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
    fetchInstitutionalApiSources(
      claimText,
      parsedClaim,
      claimType,
      CLAIM_RETRIEVAL_PROFILE[claimType].includeInstitutional,
    ),
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

  const dominance = Math.abs(supportRatio - contradictionRatio);
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

  const sparsePenalty = sourceCount < 2 && avgAuthority < 0.7 ? 8 : 0;
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

  const strongSource = sources.find(
    (source) =>
      (source.authorityScore ?? 0) >= 85 &&
      (source.relevanceScore ?? 0) >= 70 &&
      source.relation !== "neutral",
  );

  if (strongSource && sources.length <= 2) {
    normalizedVerdict = strongSource.relation === "supports" ? "TRUE" : "FALSE";
  }

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

  if (normalizedVerdict === "UNKNOWN" && (statusClaim === "dead" || statusClaim === "alive")) {
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

  if (
    normalizedVerdict === "UNKNOWN" &&
    assessment.isBasicFact &&
    supportCount >= 1 &&
    supportRatio >= 0.6
  ) {
    normalizedVerdict = "TRUE";
  } else if (
    normalizedVerdict === "UNKNOWN" &&
    assessment.isBasicFact &&
    contradictionCount >= 1 &&
    contradictionRatio >= 0.6
  ) {
    normalizedVerdict = "FALSE";
  } else if (normalizedVerdict === "UNKNOWN" && supportCount >= 2 && supportRatio >= 0.67) {
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
  const finalConfidence =
    assessment.isBasicFact && normalizedVerdict !== "UNKNOWN"
      ? Math.max(85, adjustedConfidence)
      : adjustedConfidence;

  return {
    verdict: verificationVerdictToVerdict(normalizedVerdict),
    confidence: finalConfidence,
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

const runAnalysisPipeline = createRunAnalysisPipeline({
  resolveInputText,
  parseClaimStructure,
  classifyClaimType,
  assessClaimForDecisiveMode,
  retrieveSourcesWithRetries,
  retrieveSubClaimSources,
  dedupeSources,
  scoreEvidence,
  deriveBiasProfile,
  detectMisleadingSegments,
  buildSubClaims,
  getRetrievalThreshold: (claimType) => CLAIM_RETRIEVAL_PROFILE[claimType].relevanceThreshold,
  commonKnowledgeCapitalOverride,
  commonKnowledgeUltraBasicOverride,
  commonKnowledgeCeoOverride,
  commonKnowledgeBoilingPointOverride,
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
  commonKnowledgeAiFallbackOverride,
});

export async function createAnalysis(input: string, userId?: string) {
  const { queries, results } = await getCollections();
  await touchUser(userId);

  const inputType = getInputType(input);
  const normalizedInput = normalizeInput(input);
  const parsedClaim = parseClaimStructure(inputType === "text" ? input : "");
  const parsedClaimValue = parsedClaim ?? undefined;
  const dedupeKey = buildDedupeKey(normalizedInput, ANALYSIS_MODEL_VERSION);
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
        dedupeKey: buildDedupeKey(normalizeInput(input), ANALYSIS_MODEL_VERSION),
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
  commonKnowledgeUltraBasicOverride,
  commonKnowledgeBoilingPointOverride,
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
  commonKnowledgeAiFallbackOverride,
  scoreEvidence,
  generateSubClaimStatements,
};
