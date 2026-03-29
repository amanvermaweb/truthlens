import { ClaimPayload, ComparisonResult } from "@/lib/types";

export type CreateClaimResponse = {
  claimId?: string;
  error?: string;
};

export type CompareApiResponse = {
  comparison?: ComparisonResult;
  error?: string;
};

export type FactsApiResponse = {
  claim?: ClaimPayload | null;
  error?: string;
};
