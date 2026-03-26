export type Verdict = "True" | "False" | "Mixed" | "Unknown";

export type SourceRelation = "supports" | "contradicts" | "neutral";

export type SourceReference = {
  id: string;
  title: string;
  url: string;
  publisher: string;
  snippet: string;
  relation: SourceRelation;
  credibility: number;
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
