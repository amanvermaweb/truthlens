import { compareClaimPerspectives, parseInputPayload } from "@/lib/fact-check";
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
    const comparison = await compareClaimPerspectives(parsed.input, userId);

    return NextResponse.json({ comparison }, { status: 201 });
  } catch (error) {
    console.error("Compare route failed", error);
    return errorResponse("Compare route failed", 500);
  }
}
