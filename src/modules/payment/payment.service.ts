import "server-only";

import { collections, dbConnect } from "@/infrastructure/db/dbConnect";
import { createCall, generateCallId } from "@/modules/video/video.service";
import {
  buildConsultationLink,
  getJoinWindow,
} from "@/modules/video/video.schedule";

function serialize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export async function getPaymentTransactionDetails(transactionId: string) {
  if (!transactionId) {
    throw new Error("Transaction id is required");
  }

  const appointmentsCollection = await dbConnect(collections.APPOINTMENTS);

  const result = await appointmentsCollection
    .aggregate([
      {
        $match: {
          "payment.transactionId": transactionId,
        },
      },
      {
        $lookup: {
          from: "doctors",
          localField: "doctor",
          foreignField: "_id",
          as: "doctorInfo",
        },
      },
      {
        $unwind: {
          path: "$doctorInfo",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "patient",
          foreignField: "_id",
          as: "patientInfo",
        },
      },
      {
        $unwind: {
          path: "$patientInfo",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          _id: 1,
          appointmentId: 1,
          appointmentDate: 1,
          status: 1,
          paymentStatus: 1,
          consultationType: 1,
          symptoms: 1,
          payment: 1,
          videoSession: 1,
          doctor: {
            id: "$doctorInfo._id",
            name: "$doctorInfo.fullName",
            specialization: "$doctorInfo.specialization",
          },
          patient: {
            id: "$patientInfo._id",
            fullName: "$patientInfo.fullName",
            email: "$patientInfo.email",
            phone: "$patientInfo.phone",
          },
        },
      },
    ])
    .toArray();

  return serialize(result[0] || null);
}

async function querySslcommerz(valId: string) {
  const base =
    process.env.SSL_MODE === "production"
      ? "https://securepay.sslcommerz.com"
      : "https://sandbox.sslcommerz.com";
  const url =
    `${base}/validator/api/validationserverAPI.php` +
    `?val_id=${encodeURIComponent(valId)}` +
    `&store_id=${encodeURIComponent(process.env.STORE_ID || "")}` +
    `&store_passwd=${encodeURIComponent(process.env.STORE_PASSWD || "")}` +
    `&format=json`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`SSLCommerz query failed with status ${res.status}`);
  }
  return res.json();
}

export async function verifyAndConfirmSslcommerzPayment(input: {
  valId: string;
  tranId: string;
  gatewayStatus: string;
}) {
  const { valId, tranId, gatewayStatus } = input;
  if (!valId || !tranId) {
    throw Object.assign(new Error("Invalid parameters"), { status: 400 });
  }

  const validation = await querySslcommerz(valId);
  if (validation?.status !== "VALID" && validation?.status !== "VALIDATED") {
    throw Object.assign(new Error("Gateway validation failed"), { status: 402 });
  }
  if (String(validation.tran_id) !== tranId) {
    throw Object.assign(new Error("tran_id mismatch"), { status: 400 });
  }

  const appointmentsCollection = await dbConnect(collections.APPOINTMENTS);
  const appointment = await appointmentsCollection.findOne({
    "payment.transactionId": tranId,
  });

  if (!appointment) {
    throw Object.assign(new Error("Appointment not found"), { status: 404 });
  }

  const expectedAmount = Number(appointment.payment?.amount);
  const paidAmount = Number(validation.amount ?? validation.currency_amount);
  if (!Number.isFinite(paidAmount) || Math.abs(paidAmount - expectedAmount) > 0.01) {
    throw Object.assign(new Error("Amount mismatch"), { status: 400 });
  }

  if (appointment.paymentStatus !== "paid") {
    const grossAmount = expectedAmount;
    const doctorRate = 0.8;
    const platformRate = 0.2;
    const doctorAmount = Number((grossAmount * doctorRate).toFixed(2));
    const platformAmount = Number((grossAmount * platformRate).toFixed(2));

    const updatePayload: any = {
      $set: {
        paymentStatus: "paid",
        status: "Approved",
        "payment.status": "completed",
        "payment.completedAt": new Date(),
        "payment.valId": valId,
        "payment.gatewayStatus": gatewayStatus,
        "payment.distribution": {
          model: "doctor-platform-v1",
          doctorRate,
          platformRate,
          doctorAmount,
          platformAmount,
          calculatedAt: new Date(),
        },
        updatedAt: new Date(),
      },
      $push: {
        auditTrail: {
          action: "Payment confirmed via IPN",
          performedBy: "System",
          from: appointment.status,
          to: "Approved",
          at: new Date(),
        },
      },
    };

    if (appointment.consultationType === "video") {
      try {
        const callId =
          appointment?.videoSession?.callId ||
          generateCallId(appointment._id.toString());
        const meetingLink = buildConsultationLink(appointment._id.toString());
        const { joinFrom, joinUntil } = getJoinWindow(
          appointment.appointmentDate,
        );

        const usersCollection = await dbConnect(collections.USERS);
        const doctorsCollection = await dbConnect(collections.DOCTORS);

        const [patientUser, doctorProfile] = await Promise.all([
          usersCollection.findOne({ _id: appointment.patient }),
          doctorsCollection.findOne({ _id: appointment.doctor }),
        ]);

        let doctorUser = await usersCollection.findOne({
          doctorId: appointment.doctor,
        });

        if (!doctorUser && doctorProfile?.email) {
          doctorUser = await usersCollection.findOne({
            email: doctorProfile.email.toLowerCase(),
          });
        }

        const patientUserId = appointment.patient.toString();
        const doctorUserId =
          doctorUser?._id?.toString?.() || appointment.doctor.toString();
        const patientName =
          patientUser?.fullName || appointment?.payment?.customer?.name;
        const doctorName = doctorUser?.fullName || doctorProfile?.fullName;

        await createCall({
          callId,
          appointmentId: appointment._id.toString(),
          createdByUserId: patientUserId,
          doctorId: doctorUserId,
          patientId: patientUserId,
          createdByName: patientName,
          doctorName,
          patientName,
        });

        updatePayload.$set.videoSession = {
          provider: "stream",
          ...(appointment.videoSession || {}),
          callId,
          meetingLink,
          joinFrom,
          joinUntil,
          doctorUserId,
          patientUserId,
          createdAt: new Date(),
        };

        updatePayload.$push.auditTrail.$push = {
          action: "Video session created",
          performedBy: "System",
          from: "Approved",
          to: "Approved",
          at: new Date(),
        };
      } catch (videoError) {
        console.error("Failed to create video session:", videoError);
      }
    }

    await appointmentsCollection.findOneAndUpdate(
      {
        "payment.transactionId": tranId,
        paymentStatus: { $ne: "paid" },
      },
      updatePayload,
      { returnDocument: "after" },
    );
  }

  return getPaymentTransactionDetails(tranId);
}

export async function confirmPaymentByTransactionId(transactionId: string) {
  if (!transactionId) {
    throw new Error("Transaction id is required");
  }
  return getPaymentTransactionDetails(transactionId);
}
