export type Verdict = "True" | "False" | "Mixed" | "Unknown";

export type SourceRelation = "supports" | "contradicts" | "neutral";

export type BiasRisk = "Low" | "Medium" | "High";

export type PoliticalBias =
  | "Left-leaning"
  | "Right-leaning"
  | "Centrist/Unclear";

export type SourceTier = "Tier 1" | "Tier 2" | "Tier 3";

export type AnalysisDimensions = {
  factualAccuracy: number;
  sourceAgreement: number;
  recencyScore: number;
  biasRisk: BiasRisk;
};

export type BiasProfile = {
  politicalBias: PoliticalBias;
  emotionalLanguage: "Low" | "Medium" | "High";
  manipulationRisk: BiasRisk;
};

export type MisleadingSegment = {
  text: string;
  reason: string;
  severity: "low" | "medium" | "high";
};

export type SubClaim = {
  id: string;
  statement: string;
  supportCount: number;
  contradictionCount: number;
  unresolvedCount: number;
  linkedSourceIds: string[];
};


export type SourceReference = {
  id: string;
  title: string;
  url: string;
  publisher: string;
  snippet: string;
  relation: SourceRelation;
  stance?: "support" | "contradict" | "neutral";
  credibility: number;
  tier?: SourceTier;
  domainAuthorityTier?: "High" | "Medium" | "Low";
  domainAuthority?: number;
  authorityScore?: number;
  institutionalTrust?: number;
  citationSignal?: number;
  recencyScore?: number;
  agreementScore?: number;
  relevanceScore?: number;
  finalScore?: number;
};

export type SourceNode = {
  id: string;
  label: string;
  title: string;
  source: string;
  credibility: number;
  relation: SourceRelation;
  summary: string;
  x: number;
  y: number;
  tier?: SourceTier;
  domainAuthorityTier?: "High" | "Medium" | "Low";
  recencyScore?: number;
  domainAuthority?: number;
  institutionalTrust?: number;
};

export type ClaimPayload = {
  id: string;
  claim: string;
  verdict: Verdict;
  confidence: number;
  analysisSummary: string;
  tags: string[];
  sourceNodes: SourceNode[];
  sources: SourceReference[];
  explanation: string;
  dimensions?: AnalysisDimensions;
  biasProfile?: BiasProfile;
  misleadingSegments?: MisleadingSegment[];
  subClaims?: SubClaim[];
  createdAt: string | Date;
  updatedAt?: string | Date;
};

export type HistoryRecord = {
  id: string;
  analysisId: string;
  claim: string;
  verdict: Verdict;
  confidence: number;
  createdAt: Date;
};

export type HistoryEntry = {
  queryId: string;
  resultId: string;
  input: string;
  inputType: "text" | "url";
  verdict: Verdict;
  confidence: number;
  sourcesUsed: string[];
  cacheHit: boolean;
  createdAt: Date;
};

export type InputPayload = {
  claim?: unknown;
  input?: unknown;
  url?: unknown;
};

export type InputPayloadWithId = InputPayload & {
  claimId?: unknown;
};

export type ComparisonResult = {
  claim: string;
  argumentsFor: string[];
  argumentsAgainst: string[];
  balancedVerdict: Verdict;
  rationale: string;
  dimensions: AnalysisDimensions;
};

export type SimilarClaim = {
  id: string;
  claim: string;
  verdict: Verdict;
  confidence: number;
  similarity: number;
};
