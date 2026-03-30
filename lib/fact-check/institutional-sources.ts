import { ClaimType, ParsedClaim } from "@/lib/fact-check/pipeline/types";
import { hashValue, tokenize } from "@/lib/fact-check/claim-utils";
import { computeEvidenceQuality, buildTrustModel } from "@/lib/fact-check/trust-utils";
import { computeAgreementScore, evaluateRelation } from "@/lib/fact-check/stance-utils";
import { SourceReference } from "@/lib/types";

const REQUEST_TIMEOUT_MS = 3000;

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

async function fetchWithTimeout(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timeout);
  }
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

export async function fetchInstitutionalApiSources(
  queryText: string,
  parsedClaim: ParsedClaim | null,
  claimType: ClaimType,
  includeInstitutional: boolean,
): Promise<{ sources: SourceReference[]; failures: string[] }> {
  if (!includeInstitutional) {
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
