import { collections, dbConnect } from "@/infrastructure/db/dbConnect";
import { canTransition } from "@/infrastructure/lib/legacy/appointmentStateMachine";
import { ObjectId } from "mongodb";
import { getServerSession } from "next-auth";
import { authOptions } from "@/infrastructure/auth/auth.config";
import { createCall, generateCallId } from "@/modules/video/video.service";
import { parseUtcDate } from "@/modules/appointment/appointment-policy";

function isPaymentCompleted(appointment) {
  return (
    appointment?.paymentStatus === "paid" &&
    appointment?.payment?.status === "completed"
  );
}

function normalizeNewStatus(newStatus) {
  const normalized = String(newStatus || "")
    .trim()
    .toLowerCase();
  if (normalized === "complete" || normalized === "completed") {
    return "completed";
  }
  return newStatus;
}

function isCompletedAppointmentStatus(status) {
  const normalized = String(status || "")
    .trim()
    .toLowerCase();
  return normalized === "complete" || normalized === "completed";
}

function getAuditMessage({ oldStatus, newStatus, isPatientOwner }) {
  if (newStatus === "Cancelled") return "Patient cancelled";
  if (newStatus === "Expired") return "System expired";
  if (newStatus === "completed") return "Appointment completed";
  if (oldStatus === "PendingPayment" && newStatus === "Confirmed") {
    return "Appointment confirmed";
  }
  if (oldStatus === "Confirmed" && newStatus === "Approved") {
    return "Doctor approved";
  }
  return `${isPatientOwner ? "Patient" : "Doctor"} changed status to ${newStatus}`;
}

export async function patchAppointmentStatus(req, context) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const { newStatus } = await req.json();
    const normalizedNewStatus = normalizeNewStatus(newStatus);

    if (!ObjectId.isValid(id)) {
      return Response.json({ error: "Invalid ID" }, { status: 400 });
    }

    const appointmentsCollection = await dbConnect(collections.APPOINTMENTS);

    const appointment = await appointmentsCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!appointment) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const userId = session.user.id;
    const sessionDoctorId = session.user.doctorId?.toString?.() || null;
    const isPatientOwner = appointment.patient.toString() === userId;
    const appointmentDoctorId = appointment.doctor.toString();
    const isDoctorOwner =
      appointmentDoctorId === userId ||
      (sessionDoctorId && appointmentDoctorId === sessionDoctorId);

    if (!isPatientOwner && !isDoctorOwner) {
      return Response.json(
        { error: "Not allowed to modify this appointment" },
        { status: 403 },
      );
    }

    if (normalizedNewStatus === "Approved") {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    if (["Confirmed", "completed"].includes(normalizedNewStatus) && !isDoctorOwner) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    if (newStatus === "Cancelled") {
      if (!isPatientOwner) {
        const now = new Date();
        const appointmentTime = parseUtcDate(appointment.appointmentDate);

        if (!appointmentTime) {
          return Response.json(
            { error: "Invalid appointment time" },
            { status: 400 },
          );
        }

        const oneHourBefore = new Date(
          appointmentTime.getTime() - 60 * 60 * 1000,
        );

        if (now > oneHourBefore) {
          return Response.json(
            {
              error: "Cannot cancel within 1 hour of appointment",
              reasonCode: "CANCELLATION_WINDOW_CLOSED",
              cancelDeadlineUtc: oneHourBefore.toISOString(),
            },
            { status: 400 },
          );
        }
      }

      if (
        isCompletedAppointmentStatus(appointment.status) ||
        appointment.status === "Expired"
      ) {
        return Response.json(
          { error: "Cannot cancel this appointment" },
          { status: 400 },
        );
      }
    }

    if (!canTransition(appointment.status, normalizedNewStatus)) {
      return Response.json(
        { error: "Invalid status transition" },
        { status: 400 },
      );
    }

    const isConfirmTransition =
      normalizedNewStatus === "Confirmed" ||
      normalizedNewStatus === "confirmed";

    if (isConfirmTransition) {
      if (!isDoctorOwner) {
        return Response.json(
          { error: "Only assigned doctor can confirm appointment" },
          { status: 403 },
        );
      }

      if (!isPaymentCompleted(appointment)) {
        return Response.json(
          {
            error: "Appointment payment must be completed before confirmation",
          },
          { status: 400 },
        );
      }
    }

    const actionMessage = getAuditMessage({
      oldStatus: appointment.status,
      newStatus: normalizedNewStatus,
      isPatientOwner,
    });

    const updatePayload = {
      $set: {
        status: normalizedNewStatus,
        updatedAt: new Date(),
      },
      $push: {
        auditTrail: {
          action: actionMessage,
          performedBy: isPatientOwner ? "Patient" : "Doctor",
          from: appointment.status,
          to: normalizedNewStatus,
          at: new Date(),
        },
      },
    };

    if (isConfirmTransition) {
      const callId =
        appointment?.videoSession?.callId ||
        generateCallId(appointment._id.toString());

      await createCall({
        callId,
        appointmentId: appointment._id.toString(),
        createdByUserId: userId,
        doctorId: appointment.doctor.toString(),
        patientId: appointment.patient.toString(),
      });

      updatePayload.$set.videoSession = {
        provider: "stream",
        ...(appointment.videoSession || {}),
        callId,
      };
    }

    await appointmentsCollection.updateOne(
      { _id: appointment._id },
      updatePayload,
    );

    return Response.json({
      message: "Status updated successfully",
    });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
