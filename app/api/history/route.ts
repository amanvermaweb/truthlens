import { errorResponse, parsePositiveInteger } from "@/lib/api-helpers";
import { getHistory } from "@/lib/fact-check";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const limitParam = req.nextUrl.searchParams.get("limit");
    const limit = parsePositiveInteger(limitParam, 50, { min: 1, max: 100 });

    const history = await getHistory(limit);
    return NextResponse.json({ history }, { status: 200 });
  } catch (error) {
    console.error("History route failed", error);
    return errorResponse("History route failed", 500);
  }
}
