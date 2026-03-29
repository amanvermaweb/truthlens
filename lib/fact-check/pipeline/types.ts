import {
  AnalysisDimensions,
  BiasProfile,
  MisleadingSegment,
  SourceReference,
  SubClaim,
  Verdict,
} from "@/lib/types";

export type ParsedClaim = {
  subject: string;
  predicate: string;
  object: string;
};

export type ClaimType =
  | "scientific"
  | "political"
  | "opinion"
  | "statistical";

export type BasicFactCategory = "geography" | "science" | "historical" | "general";

export type ClaimAssessment = {
  isBasicFact: boolean;
  category: BasicFactCategory;
  decisivePrompt: string;
  isHighCertaintyFact: boolean;
  statusClaim: "dead" | "alive" | null;
  needsVerification?: boolean;
  verificationReason?: string;
};

export type CommonKnowledgeResult = {
  verdict: Verdict;
  confidence: number;
  explanation: string;
  sources: SourceReference[];
};

export type PipelineScoring = {
  verdict: Verdict;
  confidence: number;
  explanation: string;
  supportWeight: number;
  contradictionWeight: number;
  dimensions: AnalysisDimensions;
  biasProfile: BiasProfile;
  misleadingSegments: MisleadingSegment[];
  subClaims: SubClaim[];
};

export type PipelineResult = {
  resolvedInputText: string;
  resolvedParsedClaim: ParsedClaim | null;
  assessment: ClaimAssessment;
  scoring: PipelineScoring;
  sources: SourceReference[];
  externalFailures: string[];
  droppedCount: number;
  preFilteredCount: number;
  threshold: number;
};
