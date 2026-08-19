import { collections, dbConnect } from "@/infrastructure/db/dbConnect";
import axios from "axios";
import { ObjectId } from "mongodb";
import { v4 as uuidv4 } from "uuid";
import { getServerSession } from "next-auth";
import { authOptions } from "@/infrastructure/auth/auth.config";

const store_id = process.env.STORE_ID;
const store_passwd = process.env.STORE_PASSWD;
const is_live = process.env.SSL_MODE === "production";

export async function initializePayment(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();

    if (!body?.appointmentId || !ObjectId.isValid(body.appointmentId)) {
      return Response.json(
        { error: "Invalid appointment id" },
        { status: 400 },
      );
    }

    const appointmentsCollection = await dbConnect(collections.APPOINTMENTS);
    const usersCollection = await dbConnect(collections.USERS);
    const doctorsCollection = await dbConnect(collections.DOCTORS);

    const appointment = await appointmentsCollection.findOne({
      _id: new ObjectId(body.appointmentId),
      patient: new ObjectId(session.user.id),
    });

    if (!appointment) {
      return Response.json({ error: "Appointment not found" }, { status: 404 });
    }

    if (appointment.paymentStatus === "paid") {
      return Response.json(
        { error: "Appointment already paid" },
        { status: 409 },
      );
    }

    if (appointment.status !== "PendingPayment") {
      return Response.json(
        { error: "Only pending-payment appointments can be paid" },
        { status: 409 },
      );
    }

    const transactionID = uuidv4();
    const payableAmount = Number(appointment?.payment?.amount || 500);
    const doctorRate = 0.8;
    const platformRate = 0.2;
    const doctorAmount = Number((payableAmount * doctorRate).toFixed(2));
    const platformAmount = Number((payableAmount * platformRate).toFixed(2));

    const patient = await usersCollection.findOne({
      _id: new ObjectId(session.user.id),
    });
    const doctor = await doctorsCollection.findOne({
      _id: new ObjectId(appointment.doctor),
    });

    const customerName =
      patient?.fullName || session?.user?.name || "Shifa Patient";
    const customerEmail =
      patient?.email || session?.user?.email || "patient@shifa.app";
    const customerPhone = patient?.phone || "01700000000";
    const customerAddress = patient?.address || {};

    const productName = doctor?.fullName
      ? `Consultation with ${doctor.fullName}`
      : "Doctor Consultation";

    const data = {
      total_amount: payableAmount,
      currency: "BDT",
      tran_id: transactionID,
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/payment/success/${transactionID}`,
      fail_url: `${process.env.NEXT_PUBLIC_APP_URL}/payment/fail`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/payment/cancel`,
      ipn_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/payment/ipn`,
      shipping_method: "Courier",
      product_name: productName,
      product_category: doctor?.specialization || "Telemedicine",
      product_profile: "general",
      cus_name: customerName,
      cus_email: customerEmail,
      cus_add1: customerAddress?.street || "N/A",
      cus_add2: customerAddress?.street || "N/A",
      cus_city: customerAddress?.city || "Dhaka",
      cus_state: customerAddress?.city || "Dhaka",
      cus_postcode: customerAddress?.zipCode || "1000",
      cus_country: "Bangladesh",
      cus_phone: customerPhone,
      cus_fax: customerPhone,
      ship_name: customerName,
      ship_add1: customerAddress?.street || "N/A",
      ship_add2: customerAddress?.street || "N/A",
      ship_city: customerAddress?.city || "Dhaka",
      ship_state: customerAddress?.city || "Dhaka",
      ship_postcode: customerAddress?.zipCode || 1000,
      ship_country: "Bangladesh",
      store_id,
      store_passwd,
    };

    const gatewayUrl = is_live
      ? "https://securepay.sslcommerz.com/gwprocess/v4/api.php"
      : "https://sandbox.sslcommerz.com/gwprocess/v4/api.php";

    const response = await axios({
      method: "POST",
      url: gatewayUrl,
      data,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    const gatewayPageUrl = response.data.GatewayPageURL;
    if (gatewayPageUrl) {
      const updateData = {
        $set: {
          paymentStatus: "unpaid",
          payment: {
            ...(appointment.payment || {}),
            status: "pending",
            amount: payableAmount,
            currency: "BDT",
            transactionId: transactionID,
            gateway: "sslcommerz",
            appointmentId: appointment.appointmentId,
            customer: {
              name: customerName,
              email: customerEmail,
              phone: customerPhone,
            },
            distribution: {
              model: "doctor-platform-v1",
              doctorRate,
              platformRate,
              doctorAmount,
              platformAmount,
              calculatedAt: new Date(),
            },
            initiatedAt: new Date(),
          },
          updatedAt: new Date(),
        },
        $push: {
          auditTrail: {
            action: "Payment initiated",
            performedBy: "Patient",
            from: appointment.status,
            to: appointment.status,
            at: new Date(),
          },
        },
      };

      await appointmentsCollection.updateOne(
        { _id: appointment._id },
        updateData,
      );

      return Response.json({ url: gatewayPageUrl });
    }

    return Response.json(
      { error: "Unable to initialize payment" },
      { status: 502 },
    );
  } catch (err) {
    console.error("error", err);
    return new Response(
      JSON.stringify({
        error: "Payment initiation failed",
        message: err.message,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
