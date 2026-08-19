import { collections, dbConnect } from "@/infrastructure/db/dbConnect";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/infrastructure/auth/auth.config";

export async function updateDoctorAvailability(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user?.role !== "doctor") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    if (!body.doctorId || !ObjectId.isValid(body.doctorId)) {
      return NextResponse.json({ error: "Invalid doctorId" }, { status: 400 });
    }

    const sessionDoctorId = session.user.doctorId?.toString();
    if (!sessionDoctorId || sessionDoctorId !== String(body.doctorId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const doctorId = new ObjectId(body.doctorId);

    const availabilityCollection = await dbConnect(
      collections.DOCTOR_AVAILABILITIES,
    );

    await availabilityCollection.deleteMany({ doctorId });

    const docs = body.availability.map((day) => ({
      doctorId,
      dayOfWeek: day.dayOfWeek,
      startTime: day.startTime,
      endTime: day.endTime,
      slotDuration: day.slotDuration,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    if (docs.length > 0) {
      await availabilityCollection.insertMany(docs);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to update availability:", error);
    return NextResponse.json(
      { error: "Failed to update schedule" },
      { status: 500 },
    );
  }
}
