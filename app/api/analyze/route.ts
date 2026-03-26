import { createAnalysis, parseInputPayload } from "@/lib/fact-check";
import { errorResponse, getOptionalUserId, readJsonBody } from "@/lib/api-helpers";
import { InputPayload } from "@/lib/types";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

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
        id: created.resultId,
        queryId: created.queryId,
        input: created.analysis.input,
        inputType: created.analysis.inputType,
        verdict: created.analysis.verdict,
        explanation: created.analysis.explanation,
        sources: created.analysis.sources,
        confidence: created.analysis.confidence,
        cached: created.analysis.cached,
        createdAt: created.analysis.createdAt,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Analyze route failed", error);
    return errorResponse("Analyze route failed", 500);
  }
}
