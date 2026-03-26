import { connectToDatabase } from "@/lib/mongodb";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const DB_NAME = process.env.MONGODB_DB_NAME ?? "truth-lens";

export async function GET() {
  try {
    const client = await connectToDatabase();
    await client.db(DB_NAME).command({ ping: 1 });

    return NextResponse.json(
      {
        status: "ok",
        database: "connected",
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Health check failed", error);

    return NextResponse.json(
      {
        status: "degraded",
        database: "unreachable",
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
