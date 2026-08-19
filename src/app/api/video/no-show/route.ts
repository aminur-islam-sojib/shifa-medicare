import { NextResponse } from "next/server";
import { markNoShowAppointments } from "@/modules/video/no-show.service";

export async function POST(req: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
    }
    const authHeader = req.headers.get("authorization");
    const expected = `Bearer ${cronSecret}`;
    if (authHeader !== expected) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const updated = await markNoShowAppointments();
    return NextResponse.json({ ok: true, updated });
  } catch (error) {
    console.error("POST /api/video/no-show failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

