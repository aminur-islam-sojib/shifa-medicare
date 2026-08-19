import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { collections, dbConnect } from "@/infrastructure/db/dbConnect";
import { findUserByEmail } from "@/infrastructure/lib/legacy/user.service";
import { getServerSession } from "next-auth";
import { authOptions } from "@/infrastructure/auth/auth.config";

const becomeDoctorSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  phone: z.string().min(10),
  gender: z.enum(["male", "female", "other"]),
  age: z.coerce.number().min(18).max(100),
  street: z.string().min(1),
  city: z.string().min(1),
  country: z.string().min(1),
  zipCode: z.string().min(1),
  specialization: z.string().min(1),
  licenseNumber: z.string().min(5),
  consultationFee: z.coerce.number().min(0),
  availableDays: z.array(z.number()).min(1),
  startTime: z.string(),
  endTime: z.string(),
  slotDuration: z.coerce.number().min(15).max(120),
});

export async function submitBecomeDoctorApplication(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized",
        },
        { status: 401 },
      );
    }

    const body = await request.json();
    const data = becomeDoctorSchema.parse(body);

    const email = data.email.toLowerCase();
    if (email !== session.user.email.toLowerCase()) {
      return NextResponse.json(
        {
          success: false,
          message: "Email must match signed-in account",
        },
        { status: 403 },
      );
    }

    const normalizedAvailableDays = Array.from(new Set(data.availableDays))
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
      .sort((a, b) => a - b);

    if (normalizedAvailableDays.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "At least one valid available day is required",
        },
        { status: 400 },
      );
    }

    const existingUser = await findUserByEmail(email);

    const usersCollection = await dbConnect(collections.USERS);
    const doctorsCollection = await dbConnect(collections.DOCTORS);
    const doctorAvailabilitiesCollection = await dbConnect(
      collections.DOCTOR_AVAILABILITIES,
    );
    const now = new Date();

    const existingDoctor = await doctorsCollection.findOne({ email });

    if (existingDoctor?.approvalStatus === "approved") {
      return NextResponse.json(
        {
          success: false,
          message: "This account is already an approved doctor",
        },
        { status: 409 },
      );
    }

    const hashedPassword =
      !existingUser || !existingUser.password
        ? await bcrypt.hash(data.password, 12)
        : null;

    const doctorPayload = {
      fullName: data.fullName,
      email,
      phone: data.phone,
      gender: data.gender,
      age: data.age,
      address: {
        street: data.street,
        city: data.city,
        country: data.country,
        zipCode: data.zipCode,
      },
      specialization: data.specialization,
      licenseNumber: data.licenseNumber,
      consultationFee: data.consultationFee,
      availableDays: normalizedAvailableDays,
      startTime: data.startTime,
      endTime: data.endTime,
      slotDuration: data.slotDuration,
      role: "doctor",
      provider: existingUser?.provider || "credentials",
      isVerified: false,
      status: "pending",
      profileCompleted: true,
      approvalStatus: "pending",
      approvedBy: null,
      approvalReason: null,
      approvedAt: null,
      updatedAt: now,
    };

    let doctorId: any;

    if (existingDoctor) {
      const updatePayload: any = {
        ...doctorPayload,
      };

      if (hashedPassword) {
        updatePayload.password = hashedPassword;
      } else if (existingDoctor.password) {
        updatePayload.password = existingDoctor.password;
      }

      await doctorsCollection.updateOne(
        { _id: existingDoctor._id },
        {
          $set: updatePayload,
          $setOnInsert: {
            createdAt: now,
            profileImage: null,
          },
        },
      );

      doctorId = existingDoctor._id;
      await doctorAvailabilitiesCollection.deleteMany({ doctorId });
    } else {
      const doctorDoc: any = {
        ...doctorPayload,
        password: hashedPassword,
        profileImage: existingUser?.profileImage || null,
        createdAt: now,
      };

      const doctorResult = await doctorsCollection.insertOne(doctorDoc);
      doctorId = doctorResult.insertedId;
    }

    const userUpdatePayload: any = {
      fullName: data.fullName,
      email,
      phone: data.phone,
      gender: data.gender,
      age: data.age,
      address: {
        street: data.street,
        city: data.city,
        country: data.country,
        zipCode: data.zipCode,
      },
      role: existingUser?.role || "patient",
      provider: existingUser?.provider || "credentials",
      isVerified: false,
      status: "active",
      profileCompleted: true,
      doctorId,
      approvalStatus: "pending",
      updatedAt: now,
    };

    if (hashedPassword) {
      userUpdatePayload.password = hashedPassword;
    }

    await usersCollection.updateOne(
      { email },
      {
        $set: userUpdatePayload,
        $setOnInsert: {
          createdAt: now,
          profileImage: existingUser?.profileImage || null,
        },
      },
      { upsert: false },
    );

    try {
      const availabilityDocs = normalizedAvailableDays.map((dayOfWeek) => ({
        doctorId,
        dayOfWeek,
        startTime: data.startTime,
        endTime: data.endTime,
        slotDuration: data.slotDuration,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      }));

      await doctorAvailabilitiesCollection.insertMany(availabilityDocs);
    } catch (availabilityError) {
      if (!existingDoctor) {
        await doctorsCollection.deleteOne({ _id: doctorId });
      }
      throw availabilityError;
    }

    return NextResponse.json(
      {
        success: true,
        message: existingDoctor
          ? "Application updated successfully! Your profile is pending admin approval."
          : "Application submitted successfully! Your profile is now pending admin approval.",
        data: {
          doctorId,
          email: data.email,
          status: "pending",
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          message: "Validation error",
          errors: error.issues,
        },
        { status: 400 },
      );
    }

    console.error("Error in become-doctor:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Failed to submit application",
      },
      { status: 500 },
    );
  }
}
