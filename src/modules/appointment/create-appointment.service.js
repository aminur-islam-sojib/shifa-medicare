import { authOptions } from "@/infrastructure/auth/auth.config";
import { AppointmentStatus } from "@/infrastructure/lib/legacy/appointmentStateMachine";
import { collections, dbConnect } from "@/infrastructure/db/dbConnect";
import { generateTimeSlots } from "@/infrastructure/lib/legacy/generateTimeSlots";
import {
  getUtcDateKey,
  getUtcDayOfWeek,
  getUtcTimeSlot,
  OCCUPYING_APPOINTMENT_STATUSES,
  parseUtcDate,
} from "@/modules/appointment/appointment-policy";
import { ObjectId } from "mongodb";
import { getServerSession } from "next-auth";

export async function createAppointment(req) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const patient = session.user.id;
    const body = await req.json();

    const { doctor, appointmentDate, consultationType, symptoms, amount } =
      body;

    if (!ObjectId.isValid(patient) || !ObjectId.isValid(doctor)) {
      return Response.json(
        { error: "Invalid patient or doctor ID" },
        { status: 400 },
      );
    }

    const appointmentDateObj = parseUtcDate(appointmentDate);

    if (!appointmentDateObj) {
      return Response.json(
        { error: "Invalid appointment date" },
        { status: 400 },
      );
    }

    const dateKey = getUtcDateKey(appointmentDateObj);
    const timeSlot = getUtcTimeSlot(appointmentDateObj);

    if (appointmentDateObj <= new Date()) {
      return Response.json(
        { error: "Cannot book appointment in the past" },
        { status: 400 },
      );
    }

    const appointmentsCollection = await dbConnect(collections.APPOINTMENTS);
    const countersCollection = await dbConnect(collections.COUNTERS);
    const usersCollection = await dbConnect(collections.USERS);
    const doctorsCollection = await dbConnect(collections.DOCTORS);

    const [patientProfile, doctorProfile] = await Promise.all([
      usersCollection.findOne(
        { _id: new ObjectId(patient) },
        {
          projection: {
            role: 1,
            status: 1,
            isBanned: 1,
            moderation: 1,
          },
        },
      ),
      doctorsCollection.findOne(
        { _id: new ObjectId(doctor) },
        {
          projection: {
            status: 1,
            isBanned: 1,
            moderation: 1,
            consultationFee: 1,
          },
        },
      ),
    ]);

    if (!patientProfile || patientProfile.role !== "patient") {
      return Response.json(
        { error: "Patient profile not found" },
        { status: 404 },
      );
    }

    if (!doctorProfile) {
      return Response.json(
        { error: "Doctor profile not found" },
        { status: 404 },
      );
    }

    const patientBlocked =
      patientProfile.status === "inactive" ||
      patientProfile.isBanned === true ||
      patientProfile?.moderation?.state === "banned";

    if (patientBlocked) {
      return Response.json(
        { error: "Patient account is restricted from booking appointments" },
        { status: 403 },
      );
    }

    const doctorBlocked =
      doctorProfile.status === "inactive" ||
      doctorProfile.isBanned === true ||
      doctorProfile?.moderation?.state === "banned";

    if (doctorBlocked) {
      return Response.json(
        { error: "Doctor account is not eligible for new appointments" },
        { status: 403 },
      );
    }

    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

    await appointmentsCollection.updateMany(
      {
        status: "PendingPayment",
        paymentStatus: "unpaid",
        createdAt: { $lte: fifteenMinutesAgo },
      },
      {
        $set: {
          status: "Expired",
          updatedAt: new Date(),
        },
        $push: {
          auditTrail: {
            action: "Auto Expired",
            performedBy: "System",
            from: "PendingPayment",
            to: "Expired",
            at: new Date(),
          },
        },
      },
    );

    const dayOfWeek = getUtcDayOfWeek(appointmentDateObj);

    const availabilityCollection = await dbConnect(
      collections.DOCTOR_AVAILABILITIES,
    );

    const availability = await availabilityCollection.findOne({
      doctorId: new ObjectId(doctor),
      dayOfWeek,
      isActive: true,
    });

    if (!availability) {
      return Response.json(
        { error: "Doctor is not available on this day" },
        { status: 400 },
      );
    }

    const validSlots = generateTimeSlots(
      availability.startTime,
      availability.endTime,
      availability.slotDuration,
      appointmentDateObj,
      { useUtc: true },
    );

    if (!validSlots.includes(timeSlot)) {
      return Response.json(
        { error: "Invalid time slot selection" },
        { status: 400 },
      );
    }

    const counterResult = await countersCollection.findOneAndUpdate(
      { _id: "appointment" },
      { $inc: { seq: 1 } },
      {
        upsert: true,
        returnDocument: "after",
      },
    );

    const sequenceNumber = counterResult.seq;

    const existingAppointment = await appointmentsCollection.findOne({
      doctor: new ObjectId(doctor),
      dateKey,
      timeSlot,
      status: {
        $in: OCCUPYING_APPOINTMENT_STATUSES,
      },
    });

    if (existingAppointment) {
      return Response.json(
        { error: "This time slot is already booked" },
        { status: 409 },
      );
    }

    const today = new Date();
    const datePart = today.toISOString().slice(0, 10).replace(/-/g, "");

    const appointmentId = `SHF-${datePart}-${sequenceNumber
      .toString()
      .padStart(5, "0")}`;

    const payableAmount =
      doctorProfile?.consultationFee !== undefined &&
      doctorProfile?.consultationFee !== null &&
      Number.isFinite(Number(doctorProfile.consultationFee))
        ? Number(doctorProfile.consultationFee)
        : 500;
    const doctorRate = 0.8;
    const platformRate = 0.2;
    const doctorAmount = Number((payableAmount * doctorRate).toFixed(2));
    const platformAmount = Number((payableAmount * platformRate).toFixed(2));

    const newAppointment = {
      appointmentId,
      patient: new ObjectId(patient),
      doctor: new ObjectId(doctor),
      appointmentDate: appointmentDateObj,
      dateKey,
      timeSlot,
      status: AppointmentStatus.PendingPayment,
      consultationType,
      symptoms,
      paymentStatus: "unpaid",
      payment: {
        status: "pending",
        amount: payableAmount,
        currency: "BDT",
        distribution: {
          model: "doctor-platform-v1",
          doctorRate,
          platformRate,
          doctorAmount,
          platformAmount,
          calculatedAt: new Date(),
        },
      },
      videoSession: {
        provider: "stream",
        callId: null,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      auditTrail: [
        {
          action: "Appointment Created",
          performedBy: "Patient",
          from: null,
          to: AppointmentStatus.PendingPayment,
          at: new Date(),
        },
      ],
    };

    let result;

    try {
      result = await appointmentsCollection.insertOne(newAppointment);
    } catch (err) {
      if (err.code === 11000) {
        return Response.json(
          { error: "This time slot is already booked" },
          { status: 409 },
        );
      }
      throw err;
    }

    return Response.json({
      message: "Appointment created successfully",
      insertedId: result.insertedId,
      appointmentId,
    });
  } catch (error) {
    console.error("Appointment POST error:", error);

    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
