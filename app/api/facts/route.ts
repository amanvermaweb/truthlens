import {
  createAnalysis,
  deleteAnalysis,
  getHistory,
  getLatestResult,
  getResultById,
  parseInputPayload,
  toLegacyClaimPayload,
  updateAnalysis,
} from "@/lib/fact-check";
import { errorResponse, getOptionalUserId, readJsonBody } from "@/lib/api-helpers";
import { InputPayload, InputPayloadWithId } from "@/lib/types";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const historyParam = req.nextUrl.searchParams.get("history");
    const claimId = req.nextUrl.searchParams.get("claimId");

    if (historyParam === "1") {
      const history = await getHistory(50);
      return NextResponse.json({ history });
    }

    if (claimId) {
      const analysis = await getResultById(claimId);
      if (!analysis) {
        return errorResponse("Claim not found", 404);
      }

      return NextResponse.json({ claim: toLegacyClaimPayload(analysis) });
    }

    const latest = await getLatestResult();
    if (!latest) {
      return NextResponse.json({ claim: null });
    }

    return NextResponse.json({ claim: toLegacyClaimPayload(latest) });
  } catch (error) {
    console.error("Failed to fetch claims", error);
    return errorResponse("Failed to fetch claims", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = await readJsonBody<InputPayload>(req);

    const parsed = parseInputPayload(payload);
    if ("error" in parsed) {
      return errorResponse(parsed.error ?? "Invalid input", 400);
    }

    const userId = await getOptionalUserId();
    const created = await createAnalysis(parsed.input, userId);

    return NextResponse.json(
      {
        claimId: created.resultId,
        queryId: created.queryId,
        cached: created.analysis.cached,
        verdict: created.analysis.verdict,
        explanation: created.analysis.explanation,
        confidence: created.analysis.confidence,
        sources: created.analysis.sources,
        dimensions: created.analysis.dimensions,
        biasProfile: created.analysis.biasProfile,
        misleadingSegments: created.analysis.misleadingSegments,
        subClaims: created.analysis.subClaims,
        similarClaims: created.analysis.similarClaims,
        claim: toLegacyClaimPayload(created.analysis),
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Failed to create claim", error);
    return errorResponse("Failed to create claim", 500);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const payload = await readJsonBody<InputPayloadWithId>(req);

    const claimId = typeof payload?.claimId === "string" ? payload.claimId : "";
    const parsed = parseInputPayload(payload);

    if (!claimId) {
      return errorResponse("Valid claimId is required", 400);
    }

    if ("error" in parsed) {
      return errorResponse(parsed.error ?? "Invalid input", 400);
    }

    const userId = await getOptionalUserId();
    const updated = await updateAnalysis(claimId, parsed.input, userId);

    if ("error" in updated) {
      return errorResponse(updated.error ?? "Claim not found", 404);
    }

    return NextResponse.json({ claim: toLegacyClaimPayload(updated.analysis) });
  } catch (error) {
    console.error("Failed to update claim", error);
    return errorResponse("Failed to update claim", 500);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const claimId = req.nextUrl.searchParams.get("claimId") ?? "";
    const deleted = await deleteAnalysis(claimId);

    if ("error" in deleted) {
      return errorResponse(deleted.error ?? "Invalid claimId", 400);
    }

    return NextResponse.json({ success: true, claimId });
  } catch (error) {
    console.error("Failed to delete claim", error);
    return errorResponse("Failed to delete claim", 500);
  }
}
