import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "This endpoint is deprecated. All authentication must flow through NextAuth handlers." },
    { status: 410 }
  );
}
