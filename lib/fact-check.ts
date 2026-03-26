import { connectToDatabase } from "@/lib/mongodb";
import { HistoryEntry, SourceReference, Verdict } from "@/lib/types";
import { ObjectId } from "mongodb";
import { createHash } from "node:crypto";

const DB_NAME = process.env.MONGODB_DB_NAME ?? "truth-lens";
const REQUEST_TIMEOUT_MS = 3000;
const ANALYSIS_MODEL_VERSION = "v5";

type ParsedClaim = {
  subject: string;
  predicate: string;
  object: string;
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

  if (trustedHosts.some((entry) => host.endsWith(entry))) {
    return 0.9;
  }

  if (publisher.toLowerCase().includes("news")) {
    return 0.68;
  }

  return 0.55;
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

function evaluateRelation(
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

function computeAgreementScore(relation: "supports" | "contradicts" | "neutral") {
  if (relation === "supports") {
    return 0.8;
  }

  if (relation === "contradicts") {
    return 0.95;
  }

  return 0.4;
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
    const wikiTrust = computeTrustScore(wikiUrl, "Wikipedia");
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
        credibility: Math.round((wikiTrust * 0.5 + wikiQuality * 0.25 + wikiAgreement * 0.25) * 100),
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
        const wikidataTrust = computeTrustScore(wikidataUrl, "Wikidata");
        const wikidataQuality = computeEvidenceQuality(firstEntity.label ?? "Wikidata entity", description);
        const wikidataAgreement = computeAgreementScore(wikidataRelation);

        sources.push({
          id: `wikidata-${firstEntity.id}`,
          title: firstEntity.label?.trim() || firstEntity.id,
          url: wikidataUrl,
          publisher: "Wikidata",
          snippet: description,
          relation: wikidataRelation,
          credibility: Math.round((wikidataTrust * 0.5 + wikidataQuality * 0.25 + wikidataAgreement * 0.25) * 100),
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
  queryText: string,
  parsedClaim: ParsedClaim | null,
): Promise<{ sources: SourceReference[]; failures: string[] }> {
  const failures: string[] = [];
  const key = process.env.NEWSAPI;

  if (!key) {
    failures.push("NEWSAPI key not configured.");
    return { sources: [], failures };
  }

  const queryTerms = queryText
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 3)
    .slice(0, 8)
    .join(" ");

  if (!queryTerms) {
    failures.push("Insufficient query terms for external lookup.");
    return { sources: [], failures };
  }

  const params = new URLSearchParams({
    q: queryTerms,
    pageSize: "8",
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
      failures.push(`News API failed with status ${response.status}.`);
      return { sources: [], failures };
    }

    const payload = (await response.json()) as {
      articles?: Array<{
        title?: string;
        url?: string;
        description?: string;
        source?: { name?: string };
      }>;
    };

    const articles = payload.articles ?? [];
    const sources = articles.slice(0, 8).map((article, index) => {
      const title = article.title?.trim() || `External evidence ${index + 1}`;
      const description = article.description?.trim() || "No summary available from provider.";
      const publisher = article.source?.name?.trim() || "NewsAPI";
      const relation = evaluateRelation(queryText, parsedClaim, `${title} ${description}`);
      const url = article.url?.trim() || "";
      const trust = computeTrustScore(url, publisher);
      const quality = computeEvidenceQuality(title, description);
      const agreement = computeAgreementScore(relation);

      return {
        id: `news-${index + 1}`,
        title,
        url,
        publisher,
        snippet: description,
        relation,
        credibility: Math.round((trust * 0.5 + quality * 0.25 + agreement * 0.25) * 100),
      } satisfies SourceReference;
    });

    return { sources: sources.filter((source) => source.url.length > 0), failures };
  } catch {
    failures.push("News API request timed out or failed.");
    return { sources: [], failures };
  }
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
): Promise<{ sources: SourceReference[]; failures: string[] }> {
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

function isHighCertaintyClaim(inputText: string) {
  return /\b(always|never|all|none|every|must|definitely|proved|undeniable|biggest|largest|smallest|richest|poorest|best|worst|number\s*1|number\s*one|top)\b/i.test(
    inputText,
  );
}

function scoreEvidence(sources: SourceReference[], claimText: string) {
  if (sources.length === 0) {
    return {
      verdict: "Unknown" as const,
      confidence: 42,
      supportWeight: 0,
      contradictionWeight: 0,
      explanation: "No reliable evidence was found from external sources.",
    };
  }

  const qualityScores = sources.map((source) => computeEvidenceQuality(source.title, source.snippet));
  const trustScores = sources.map((source) => computeTrustScore(source.url, source.publisher));
  const agreementScores = sources.map((source) => computeAgreementScore(source.relation));

  const evidenceQualityScore = qualityScores.reduce((acc, value) => acc + value, 0) / qualityScores.length;
  const sourceTrustScore = trustScores.reduce((acc, value) => acc + value, 0) / trustScores.length;
  const agreementScore = agreementScores.reduce((acc, value) => acc + value, 0) / agreementScores.length;

  const supportWeight = sources
    .filter((item) => item.relation === "supports")
    .reduce((total, item) => total + item.credibility, 0);

  const contradictionWeight = sources
    .filter((item) => item.relation === "contradicts")
    .reduce((total, item) => total + item.credibility, 0);

  const supportCount = sources.filter((item) => item.relation === "supports").length;
  const contradictionCount = sources.filter((item) => item.relation === "contradicts").length;
  const neutralCount = sources.filter((item) => item.relation === "neutral").length;
  const uniquePublisherCount = new Set(sources.map((item) => item.publisher.toLowerCase())).size;
  const highCredibilityCount = sources.filter((item) => item.credibility >= 75).length;
  const avgCredibility =
    sources.reduce((total, item) => total + item.credibility, 0) / Math.max(1, sources.length);

  const totalWeight = supportWeight + contradictionWeight;

  if (supportCount === 0 && contradictionCount >= 1) {
    const contradictionConsensus = contradictionWeight / Math.max(1, totalWeight);
    const contradictionSignal = clamp01(
      contradictionConsensus * 0.5 +
        clamp01(contradictionCount / 4) * 0.25 +
        clamp01(uniquePublisherCount / 4) * 0.15 +
        clamp01(avgCredibility / 100) * 0.1,
    );

    return {
      verdict: "False" as const,
      confidence: Math.round(38 + contradictionSignal * 45),
      supportWeight,
      contradictionWeight,
      explanation:
        "No supporting evidence was found, while multiple sources contradict the claim.",
    };
  }

  if (supportCount === 0 && contradictionCount === 0 && neutralCount >= 2 && isHighCertaintyClaim(claimText)) {
    return {
      verdict: "False" as const,
      confidence: 56,
      supportWeight,
      contradictionWeight,
      explanation:
        "This is a high-certainty factual claim, but retrieved evidence does not support it.",
    };
  }

  if (totalWeight === 0) {
    return {
      verdict: "Unknown" as const,
      confidence: 40,
      supportWeight,
      contradictionWeight,
      explanation: "No weighted evidence could be established for this claim.",
    };
  }

  const supportRatio = supportWeight / totalWeight;
  const contradictionRatio = contradictionWeight / totalWeight;
  const spread = Math.abs(supportRatio - contradictionRatio);
  const decisiveness = clamp01(0.55 + spread * 0.45);
  const productConfidence =
    evidenceQualityScore * agreementScore * sourceTrustScore * decisiveness * 100;

  const sourceSufficiency = clamp01(sources.length / 6);
  const publisherDiversity = clamp01(uniquePublisherCount / 4);
  const highCredibilityCoverage = clamp01(highCredibilityCount / 3);
  const evidenceSufficiency = clamp01(
    sourceSufficiency * 0.45 + publisherDiversity * 0.35 + highCredibilityCoverage * 0.2,
  );

  const sufficiencyScaledConfidence = productConfidence * (0.45 + evidenceSufficiency * 0.55);
  const baseConfidence = Math.max(28, Math.min(96, Math.round(sufficiencyScaledConfidence)));

  if (sources.length < 2) {
    return {
      verdict: "Unknown" as const,
      confidence: Math.min(55, baseConfidence),
      supportWeight,
      contradictionWeight,
      explanation: "Evidence is too sparse to issue a strong verdict, so this claim remains unresolved.",
    };
  }

  if (supportRatio >= 0.65) {
    if (supportCount < 2 || uniquePublisherCount < 2) {
      return {
        verdict: "Unknown" as const,
        confidence: Math.min(52, baseConfidence),
        supportWeight,
        contradictionWeight,
        explanation:
          "Some evidence supports the claim, but there is not enough independent corroboration.",
      };
    }

    const confidenceCap =
      supportCount >= 3 && uniquePublisherCount >= 3 && evidenceSufficiency >= 0.7 ? 88 : 78;
    return {
      verdict: "True" as const,
      confidence: Math.min(confidenceCap, Math.max(42, baseConfidence)),
      supportWeight,
      contradictionWeight,
      explanation:
        "Most independent weighted evidence supports the claim and contradicting evidence is weaker.",
    };
  }

  if (contradictionRatio >= 0.65) {
    if (contradictionCount < 2 || uniquePublisherCount < 2) {
      return {
        verdict: "Unknown" as const,
        confidence: Math.min(54, baseConfidence),
        supportWeight,
        contradictionWeight,
        explanation:
          "Evidence leans against the claim, but independent contradiction is still limited.",
      };
    }

    const contradictionConfidence =
      contradictionRatio >= 0.8 && evidenceSufficiency >= 0.7
        ? Math.min(90, Math.max(62, baseConfidence))
        : Math.min(80, Math.max(52, baseConfidence));

    return {
      verdict: "False" as const,
      confidence: contradictionConfidence,
      supportWeight,
      contradictionWeight,
      explanation:
        "Contradicting evidence outweighs supporting evidence, which reduces trust in the claim.",
    };
  }

  return {
    verdict: "Mixed" as const,
    confidence: Math.max(34, Math.min(72, baseConfidence)),
    supportWeight,
    contradictionWeight,
    explanation:
      "Supporting and contradicting evidence are both present with similar weight, so the claim is only partially supported.",
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

function resultToResponse(result: ResultDoc & { _id: ObjectId }, input: string, inputType: "text" | "url", cached: boolean): AnalysisResponse {
  return {
    id: result._id.toString(),
    input,
    inputType,
    verdict: result.verdict,
    explanation: result.explanation,
    sources: result.sources,
    confidence: result.confidence,
    cached,
    createdAt: result.createdAt,
    updatedAt: result.updatedAt,
  };
}

export function parseInputPayload(payload: { claim?: unknown; input?: unknown; url?: unknown } | null) {
  return parseInput(payload);
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
    return {
      analysis: resultToResponse(existing as ResultDoc & { _id: ObjectId }, input, inputType, true),
      queryId: existing.queryId.toString(),
      resultId: existing._id.toString(),
    };
  }

  const resolved = await resolveInputText(input);
  const resolvedParsedClaim = parseClaimStructure(resolved.inputText);

  const [newsData, groundingData, institutionalData] = await Promise.all([
    fetchNewsSources(resolved.inputText, resolvedParsedClaim ?? parsedClaim),
    fetchWikipediaAndWikidataSources(resolved.inputText, resolvedParsedClaim ?? parsedClaim),
    fetchInstitutionalApiSources(resolved.inputText, resolvedParsedClaim ?? parsedClaim),
  ]);
  const sources = [...groundingData.sources, ...institutionalData.sources, ...newsData.sources];
  const scoring = scoreEvidence(sources, resolved.inputText);

  const externalFailures = [
    ...resolved.externalFailures,
    ...groundingData.failures,
    ...institutionalData.failures,
    ...newsData.failures,
  ];

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
    externalFailures,
    createdAt: now,
  };

  return {
    analysis: resultToResponse(resultDoc, input, inputType, false),
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

  return resultToResponse(result as ResultDoc & { _id: ObjectId }, input, inputType, false);
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

  return resultToResponse(result as ResultDoc & { _id: ObjectId }, input, inputType, false);
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
  const resolved = await resolveInputText(input);
  const resolvedParsedClaim = parseClaimStructure(resolved.inputText);

  const [newsData, groundingData, institutionalData] = await Promise.all([
    fetchNewsSources(resolved.inputText, resolvedParsedClaim ?? parsedClaim),
    fetchWikipediaAndWikidataSources(resolved.inputText, resolvedParsedClaim ?? parsedClaim),
    fetchInstitutionalApiSources(resolved.inputText, resolvedParsedClaim ?? parsedClaim),
  ]);
  const sources = [...groundingData.sources, ...institutionalData.sources, ...newsData.sources];
  const scoring = scoreEvidence(sources, resolved.inputText);

  const externalFailures = [
    ...resolved.externalFailures,
    ...groundingData.failures,
    ...institutionalData.failures,
    ...newsData.failures,
  ];
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
    createdAt: analysis.createdAt,
    updatedAt: analysis.updatedAt,
  };
}
