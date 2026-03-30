import { BiasProfile, SourceReference } from "@/lib/types";

import {
  ClaimAssessment,
  ClaimType,
  CommonKnowledgeResult,
  ParsedClaim,
  PipelineResult,
  PipelineScoring,
} from "./types";

type RetrievalResult = {
  sources: SourceReference[];
  externalFailures: string[];
  droppedCount: number;
  preFilteredCount: number;
  threshold: number;
};

type SubClaimRetrievalResult = {
  sources: SourceReference[];
  failures: string[];
};

type ResolveInputResult = {
  inputText: string;
  externalFailures: string[];
};

type PipelineDeps = {
  resolveInputText: (input: string) => Promise<ResolveInputResult>;
  parseClaimStructure: (input: string) => ParsedClaim | null;
  classifyClaimType: (inputText: string, parsedClaim: ParsedClaim | null) => ClaimType;
  assessClaimForDecisiveMode: (
    inputText: string,
    parsedClaim: ParsedClaim | null,
    claimType: ClaimType,
  ) => ClaimAssessment;
  retrieveSourcesWithRetries: (
    claimText: string,
    parsedClaim: ParsedClaim | null,
    claimType: ClaimType,
    assessment: ClaimAssessment,
  ) => Promise<RetrievalResult>;
  retrieveSubClaimSources: (
    inputText: string,
    parsedClaim: ParsedClaim | null,
  ) => Promise<SubClaimRetrievalResult>;
  dedupeSources: (sources: SourceReference[]) => SourceReference[];
  scoreEvidence: (
    sources: SourceReference[],
    claimText: string,
    parsedClaim: ParsedClaim | null,
    assessment: ClaimAssessment,
  ) => PipelineScoring;
  deriveBiasProfile: (inputText: string, sources: SourceReference[]) => BiasProfile;
  detectMisleadingSegments: (inputText: string) => PipelineScoring["misleadingSegments"];
  buildSubClaims: (
    inputText: string,
    parsedClaim: ParsedClaim | null,
    sources: SourceReference[],
  ) => PipelineScoring["subClaims"];
  getRetrievalThreshold: (claimType: ClaimType) => number;
  commonKnowledgeCapitalOverride: (
    inputText: string,
    parsedClaim: ParsedClaim | null,
  ) => Promise<CommonKnowledgeResult | null>;
  commonKnowledgeUltraBasicOverride: (inputText: string) => CommonKnowledgeResult | null;
  commonKnowledgeCeoOverride: (inputText: string, parsedClaim: ParsedClaim | null) => Promise<CommonKnowledgeResult | null>;
  commonKnowledgeBoilingPointOverride: (inputText: string, parsedClaim: ParsedClaim | null) => CommonKnowledgeResult | null;
  commonKnowledgeLifeStatusOverride: (inputText: string, parsedClaim: ParsedClaim | null) => Promise<CommonKnowledgeResult | null>;
  commonKnowledgeOrbitOverride: (inputText: string, parsedClaim: ParsedClaim | null) => Promise<CommonKnowledgeResult | null>;
  commonKnowledgeScienceIsAOverride: (inputText: string, parsedClaim: ParsedClaim | null) => Promise<CommonKnowledgeResult | null>;
  commonKnowledgeAtomicNumberOverride: (inputText: string, parsedClaim: ParsedClaim | null) => Promise<CommonKnowledgeResult | null>;
  commonKnowledgeBornInOverride: (inputText: string, parsedClaim: ParsedClaim | null) => Promise<CommonKnowledgeResult | null>;
  commonKnowledgeDiedInOverride: (inputText: string, parsedClaim: ParsedClaim | null) => Promise<CommonKnowledgeResult | null>;
  commonKnowledgeSpouseOverride: (inputText: string, parsedClaim: ParsedClaim | null) => Promise<CommonKnowledgeResult | null>;
  commonKnowledgeFounderOverride: (inputText: string, parsedClaim: ParsedClaim | null) => Promise<CommonKnowledgeResult | null>;
  commonKnowledgePresidentOverride: (inputText: string, parsedClaim: ParsedClaim | null) => Promise<CommonKnowledgeResult | null>;
  commonKnowledgePrimeMinisterOverride: (inputText: string, parsedClaim: ParsedClaim | null) => Promise<CommonKnowledgeResult | null>;
  commonKnowledgeHeadquartersOverride: (inputText: string, parsedClaim: ParsedClaim | null) => Promise<CommonKnowledgeResult | null>;
  commonKnowledgeAiFallbackOverride: (inputText: string, parsedClaim: ParsedClaim | null) => Promise<CommonKnowledgeResult | null>;
};

function getEvidenceWeights(sources: SourceReference[]) {
  const supportWeight = sources
    .filter((source) => source.relation === "supports")
    .reduce((total, source) => total + (source.finalScore ?? source.credibility), 0);
  const contradictionWeight = sources
    .filter((source) => source.relation === "contradicts")
    .reduce((total, source) => total + (source.finalScore ?? source.credibility), 0);

  return { supportWeight, contradictionWeight };
}

function buildOverrideResult(params: {
  resolvedInputText: string;
  resolvedParsedClaim: ParsedClaim | null;
  commonKnowledge: CommonKnowledgeResult;
  category: ClaimAssessment["category"];
  decisivePrompt: string;
  factualAccuracy: number;
  sourceAgreement: number;
  recencyScore: number;
  statusClaim?: ClaimAssessment["statusClaim"];
  externalFailures: string[];
  externalFailureMessage: string;
  threshold: number;
  deps: Pick<PipelineDeps, "deriveBiasProfile" | "detectMisleadingSegments" | "buildSubClaims">;
}): PipelineResult {
  const {
    resolvedInputText,
    resolvedParsedClaim,
    commonKnowledge,
    category,
    decisivePrompt,
    factualAccuracy,
    sourceAgreement,
    recencyScore,
    statusClaim = null,
    externalFailures,
    externalFailureMessage,
    threshold,
    deps,
  } = params;

  const { supportWeight, contradictionWeight } = getEvidenceWeights(commonKnowledge.sources);
  const biasProfile = deps.deriveBiasProfile(resolvedInputText, commonKnowledge.sources);

  return {
    resolvedInputText,
    resolvedParsedClaim,
    assessment: {
      isBasicFact: true,
      category,
      decisivePrompt,
      isHighCertaintyFact: true,
      statusClaim,
    },
    scoring: {
      verdict: commonKnowledge.verdict,
      confidence: commonKnowledge.confidence,
      explanation: commonKnowledge.explanation,
      supportWeight,
      contradictionWeight,
      dimensions: {
        factualAccuracy,
        sourceAgreement,
        recencyScore,
        biasRisk: biasProfile.manipulationRisk,
      },
      biasProfile,
      misleadingSegments: deps.detectMisleadingSegments(resolvedInputText),
      subClaims: deps.buildSubClaims(resolvedInputText, resolvedParsedClaim, commonKnowledge.sources),
    },
    sources: commonKnowledge.sources,
    externalFailures: [
      ...externalFailures,
      externalFailureMessage,
    ],
    droppedCount: 0,
    preFilteredCount: 0,
    threshold,
  };
}

export function createRunAnalysisPipeline(deps: PipelineDeps) {
  return async function runAnalysisPipeline(input: string, parsedClaim: ParsedClaim | null): Promise<PipelineResult> {
    const resolved = await deps.resolveInputText(input);
    const resolvedParsedClaim = deps.parseClaimStructure(resolved.inputText) ?? parsedClaim;
    const resolvedClaimType = deps.classifyClaimType(resolved.inputText, resolvedParsedClaim);
    const threshold = deps.getRetrievalThreshold(resolvedClaimType);

    const commonKnowledge = await deps.commonKnowledgeCapitalOverride(resolved.inputText, resolvedParsedClaim);
    if (commonKnowledge) {
      return buildOverrideResult({
        resolvedInputText: resolved.inputText,
        resolvedParsedClaim,
        commonKnowledge,
        category: "geography",
        decisivePrompt: "Common-knowledge fast check applied for a stable geography fact.",
        factualAccuracy: 97,
        sourceAgreement: 96,
        recencyScore: 90,
        externalFailures: resolved.externalFailures,
        externalFailureMessage:
          "High-certainty common-knowledge override used for a stable capital-city claim.",
        threshold,
        deps,
      });
    }

    const ultraBasicOverride = deps.commonKnowledgeUltraBasicOverride(resolved.inputText);
    if (ultraBasicOverride) {
      return buildOverrideResult({
        resolvedInputText: resolved.inputText,
        resolvedParsedClaim,
        commonKnowledge: ultraBasicOverride,
        category: "science",
        decisivePrompt:
          "Ultra-basic fact fast check applied for a canonical science/general-knowledge claim.",
        factualAccuracy: 97,
        sourceAgreement: 95,
        recencyScore: 90,
        externalFailures: resolved.externalFailures,
        externalFailureMessage: "Ultra-basic common-knowledge override used for canonical fact claim.",
        threshold,
        deps,
      });
    }

    const commonKnowledgeCeo = await deps.commonKnowledgeCeoOverride(resolved.inputText, resolvedParsedClaim);
    if (commonKnowledgeCeo) {
      return buildOverrideResult({
        resolvedInputText: resolved.inputText,
        resolvedParsedClaim,
        commonKnowledge: commonKnowledgeCeo,
        category: "historical",
        decisivePrompt: "Common-knowledge fast check applied for stable role/title fact.",
        factualAccuracy: 95,
        sourceAgreement: 92,
        recencyScore: 86,
        externalFailures: resolved.externalFailures,
        externalFailureMessage: "High-certainty common-knowledge override used for CEO role claim.",
        threshold,
        deps,
      });
    }

    const commonKnowledgeBoilingPoint = deps.commonKnowledgeBoilingPointOverride(
      resolved.inputText,
      resolvedParsedClaim,
    );
    if (commonKnowledgeBoilingPoint) {
      return buildOverrideResult({
        resolvedInputText: resolved.inputText,
        resolvedParsedClaim,
        commonKnowledge: commonKnowledgeBoilingPoint,
        category: "science",
        decisivePrompt:
          "Common-knowledge fast check applied for water boiling-point fact under standard pressure.",
        factualAccuracy: 97,
        sourceAgreement: 95,
        recencyScore: 88,
        externalFailures: resolved.externalFailures,
        externalFailureMessage:
          "High-certainty common-knowledge override used for water boiling-point claim.",
        threshold,
        deps,
      });
    }

    const commonKnowledgeLifeStatus = await deps.commonKnowledgeLifeStatusOverride(
      resolved.inputText,
      resolvedParsedClaim,
    );
    if (commonKnowledgeLifeStatus) {
      return buildOverrideResult({
        resolvedInputText: resolved.inputText,
        resolvedParsedClaim,
        commonKnowledge: commonKnowledgeLifeStatus,
        category: "historical",
        decisivePrompt: "Common-knowledge fast check applied for life-status fact.",
        factualAccuracy: 95,
        sourceAgreement: 93,
        recencyScore: 86,
        statusClaim: /\b(dead|deceased|died)\b/i.test(resolved.inputText) ? "dead" : "alive",
        externalFailures: resolved.externalFailures,
        externalFailureMessage: "High-certainty common-knowledge override used for life-status claim.",
        threshold,
        deps,
      });
    }

    const assessment = deps.assessClaimForDecisiveMode(
      resolved.inputText,
      resolvedParsedClaim,
      resolvedClaimType,
    );

    if (assessment.needsVerification) {
      const biasProfile = deps.deriveBiasProfile(resolved.inputText, []);
      return {
        resolvedInputText: resolved.inputText,
        resolvedParsedClaim,
        assessment,
        scoring: {
          verdict: "Unknown",
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
          misleadingSegments: deps.detectMisleadingSegments(resolved.inputText),
          subClaims: deps.buildSubClaims(resolved.inputText, resolvedParsedClaim, []),
        },
        sources: [],
        externalFailures: [
          ...resolved.externalFailures,
          "Needs verification mode activated for subjective/speculative claim.",
        ],
        droppedCount: 0,
        preFilteredCount: 0,
        threshold,
      };
    }

    const structuredOverrides = await Promise.all([
      deps.commonKnowledgeOrbitOverride(resolved.inputText, resolvedParsedClaim),
      deps.commonKnowledgeScienceIsAOverride(resolved.inputText, resolvedParsedClaim),
      deps.commonKnowledgeAtomicNumberOverride(resolved.inputText, resolvedParsedClaim),
      deps.commonKnowledgeBornInOverride(resolved.inputText, resolvedParsedClaim),
      deps.commonKnowledgeDiedInOverride(resolved.inputText, resolvedParsedClaim),
      deps.commonKnowledgeSpouseOverride(resolved.inputText, resolvedParsedClaim),
      deps.commonKnowledgeFounderOverride(resolved.inputText, resolvedParsedClaim),
      deps.commonKnowledgePresidentOverride(resolved.inputText, resolvedParsedClaim),
      deps.commonKnowledgePrimeMinisterOverride(resolved.inputText, resolvedParsedClaim),
      deps.commonKnowledgeHeadquartersOverride(resolved.inputText, resolvedParsedClaim),
    ]);
    const firstStructuredOverride = structuredOverrides.find((item) => Boolean(item)) ?? null;

    if (firstStructuredOverride) {
      return buildOverrideResult({
        resolvedInputText: resolved.inputText,
        resolvedParsedClaim,
        commonKnowledge: firstStructuredOverride,
        category: "historical",
        decisivePrompt: "Common-knowledge fast check applied for stable role/location fact.",
        factualAccuracy: 95,
        sourceAgreement: 92,
        recencyScore: 86,
        externalFailures: resolved.externalFailures,
        externalFailureMessage:
          "High-certainty common-knowledge override used for role/location claim.",
        threshold,
        deps,
      });
    }

    const commonKnowledgeAiFallback = await deps.commonKnowledgeAiFallbackOverride(
      resolved.inputText,
      resolvedParsedClaim,
    );
    if (commonKnowledgeAiFallback) {
      return buildOverrideResult({
        resolvedInputText: resolved.inputText,
        resolvedParsedClaim,
        commonKnowledge: commonKnowledgeAiFallback,
        category: "general",
        decisivePrompt: "AI-assisted common-knowledge fallback applied with citation validation.",
        factualAccuracy: 88,
        sourceAgreement: 84,
        recencyScore: 82,
        externalFailures: resolved.externalFailures,
        externalFailureMessage:
          "Citation-validated AI fallback used for common-knowledge claim without deterministic match.",
        threshold,
        deps,
      });
    }

    const primaryRetrieval = await deps.retrieveSourcesWithRetries(
      resolved.inputText,
      resolvedParsedClaim,
      resolvedClaimType,
      assessment,
    );
    const subClaimRetrieval = await deps.retrieveSubClaimSources(
      resolved.inputText,
      resolvedParsedClaim,
    );

    const sources = deps.dedupeSources([
      ...primaryRetrieval.sources,
      ...subClaimRetrieval.sources,
    ]);
    const scoring = deps.scoreEvidence(sources, resolved.inputText, resolvedParsedClaim, assessment);

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
  };
}
