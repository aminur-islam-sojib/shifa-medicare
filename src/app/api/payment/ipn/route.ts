import { NextResponse } from "next/server";
import { verifyAndConfirmSslcommerzPayment } from "@/modules/payment/payment.service";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const valId = String(form.get("val_id") || "");
    const tranId = String(form.get("tran_id") || "");
    const status = String(form.get("status") || "");

    if (!valId || !tranId) {
      return NextResponse.json({ error: "Invalid IPN parameters" }, { status: 400 });
    }

    await verifyAndConfirmSslcommerzPayment({ valId, tranId, gatewayStatus: status });
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("IPN payment verification failed:", error);
    const status = error.status || 500;
    return NextResponse.json({ error: error.message || "IPN validation error" }, { status });
  }
}
