import { clamp01 } from "@/lib/fact-check/claim-utils";

type SourceTier = "government" | "research" | "news" | "blog";

const SOURCE_TIER_WEIGHT: Record<SourceTier, number> = {
  government: 1.2,
  research: 1.1,
  news: 1,
  blog: 0.75,
};

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

export function domainAuthorityTier(score: number): "High" | "Medium" | "Low" {
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

function sourceTierWeight(url: string, publisher: string) {
  return SOURCE_TIER_WEIGHT[classifySourceTier(url, publisher)];
}

function computeTrustScore(url: string, publisher: string) {
  const host = extractDomain(url);
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

export function buildTrustModel(url: string, publisher: string, text: string) {
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

export function classifySourceTier(url: string, publisher: string): SourceTier {
  const host = extractDomain(url);
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

export function computeEvidenceQuality(title: string, snippet: string) {
  const text = `${title} ${snippet}`.trim();
  const lengthScore = clamp01(text.length / 220);
  const hasNumbers = /\d/.test(text) ? 0.15 : 0;
  const hasConcreteSignal = /(report|study|data|according|official|estimated|net worth|valuation)/i.test(text)
    ? 0.2
    : 0;
  return clamp01(0.35 + lengthScore * 0.4 + hasNumbers + hasConcreteSignal);
}
