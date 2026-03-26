import { SourceReference } from "@/lib/types";
import { createHash } from "node:crypto";
import {
  clamp01,
  extractEntityCandidate,
  getInputType,
  isBlockedUrl,
  ParsedClaim,
  stripHtml,
  tokenize,
} from "./input";

const REQUEST_TIMEOUT_MS = 3000;

type IndicatorConfig = {
  code: string;
  label: string;
};

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
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

export async function resolveInputText(
  input: string,
): Promise<{ inputText: string; externalFailures: string[] }> {
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
    const descMatch = html.match(
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    );
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
    const wikiUrl =
      summary.content_urls?.desktop?.page ||
      `https://en.wikipedia.org/wiki/${encodeURIComponent(wikiTitle)}`;
    const wikiRelation = evaluateRelation(
      queryText,
      parsedClaim,
      `${summary.title ?? ""} ${wikiSnippet}`,
    );
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
        credibility: Math.round(
          (wikiTrust * 0.5 + wikiQuality * 0.25 + wikiAgreement * 0.25) * 100,
        ),
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
        const wikidataRelation = evaluateRelation(
          queryText,
          parsedClaim,
          `${firstEntity.label ?? ""} ${description}`,
        );
        const wikidataTrust = computeTrustScore(wikidataUrl, "Wikidata");
        const wikidataQuality = computeEvidenceQuality(
          firstEntity.label ?? "Wikidata entity",
          description,
        );
        const wikidataAgreement = computeAgreementScore(wikidataRelation);

        sources.push({
          id: `wikidata-${firstEntity.id}`,
          title: firstEntity.label?.trim() || firstEntity.id,
          url: wikidataUrl,
          publisher: "Wikidata",
          snippet: description,
          relation: wikidataRelation,
          credibility: Math.round(
            (wikidataTrust * 0.5 + wikidataQuality * 0.25 + wikidataAgreement * 0.25) * 100,
          ),
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
    const response = await fetchWithTimeout(
      `https://newsapi.org/v2/everything?${params.toString()}`,
      {
        headers: {
          "X-Api-Key": key,
        },
      },
    );

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

export async function fetchAllSources(
  queryText: string,
  parsedClaim: ParsedClaim | null,
): Promise<{ sources: SourceReference[]; failures: string[] }> {
  const [newsData, groundingData, institutionalData] = await Promise.all([
    fetchNewsSources(queryText, parsedClaim),
    fetchWikipediaAndWikidataSources(queryText, parsedClaim),
    fetchInstitutionalApiSources(queryText, parsedClaim),
  ]);

  return {
    sources: [...groundingData.sources, ...institutionalData.sources, ...newsData.sources],
    failures: [...groundingData.failures, ...institutionalData.failures, ...newsData.failures],
  };
}
