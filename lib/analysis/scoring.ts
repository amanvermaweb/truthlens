import { SourceReference, Verdict } from "@/lib/types";
import { clamp01 } from "./input";

export type EvidenceScore = {
  verdict: Verdict;
  confidence: number;
  supportWeight: number;
  contradictionWeight: number;
  explanation: string;
};

function computeEvidenceQuality(title: string, snippet: string) {
  const text = `${title} ${snippet}`.trim();
  const lengthScore = clamp01(text.length / 220);
  const hasNumbers = /\d/.test(text) ? 0.15 : 0;
  const hasConcreteSignal = /(report|study|data|according|official|estimated|net worth|valuation)/i.test(text)
    ? 0.2
    : 0;

  return clamp01(0.35 + lengthScore * 0.4 + hasNumbers + hasConcreteSignal);
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

function computeAgreementScore(relation: SourceReference["relation"]) {
  if (relation === "supports") {
    return 0.8;
  }

  if (relation === "contradicts") {
    return 0.95;
  }

  return 0.4;
}

function isHighCertaintyClaim(inputText: string) {
  return /\b(always|never|all|none|every|must|definitely|proved|undeniable|biggest|largest|smallest|richest|poorest|best|worst|number\s*1|number\s*one|top)\b/i.test(
    inputText,
  );
}

export function scoreEvidence(sources: SourceReference[], claimText: string): EvidenceScore {
  if (sources.length === 0) {
    return {
      verdict: "Unknown",
      confidence: 42,
      supportWeight: 0,
      contradictionWeight: 0,
      explanation: "No reliable evidence was found from external sources.",
    };
  }

  const qualityScores = sources.map((source) =>
    computeEvidenceQuality(source.title, source.snippet),
  );
  const trustScores = sources.map((source) =>
    computeTrustScore(source.url, source.publisher),
  );
  const agreementScores = sources.map((source) =>
    computeAgreementScore(source.relation),
  );

  const evidenceQualityScore =
    qualityScores.reduce((acc, value) => acc + value, 0) / qualityScores.length;
  const sourceTrustScore =
    trustScores.reduce((acc, value) => acc + value, 0) / trustScores.length;
  const agreementScore =
    agreementScores.reduce((acc, value) => acc + value, 0) / agreementScores.length;

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
      verdict: "False",
      confidence: Math.round(38 + contradictionSignal * 45),
      supportWeight,
      contradictionWeight,
      explanation:
        "No supporting evidence was found, while multiple sources contradict the claim.",
    };
  }

  if (
    supportCount === 0 &&
    contradictionCount === 0 &&
    neutralCount >= 2 &&
    isHighCertaintyClaim(claimText)
  ) {
    return {
      verdict: "False",
      confidence: 56,
      supportWeight,
      contradictionWeight,
      explanation:
        "This is a high-certainty factual claim, but retrieved evidence does not support it.",
    };
  }

  if (totalWeight === 0) {
    return {
      verdict: "Unknown",
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
      verdict: "Unknown",
      confidence: Math.min(55, baseConfidence),
      supportWeight,
      contradictionWeight,
      explanation:
        "Evidence is too sparse to issue a strong verdict, so this claim remains unresolved.",
    };
  }

  if (supportRatio >= 0.65) {
    if (supportCount < 2 || uniquePublisherCount < 2) {
      return {
        verdict: "Unknown",
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
      verdict: "True",
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
        verdict: "Unknown",
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
      verdict: "False",
      confidence: contradictionConfidence,
      supportWeight,
      contradictionWeight,
      explanation:
        "Contradicting evidence outweighs supporting evidence, which reduces trust in the claim.",
    };
  }

  return {
    verdict: "Mixed",
    confidence: Math.max(34, Math.min(72, baseConfidence)),
    supportWeight,
    contradictionWeight,
    explanation:
      "Supporting and contradicting evidence are both present with similar weight, so the claim is only partially supported.",
  };
}
