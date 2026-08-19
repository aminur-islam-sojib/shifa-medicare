import React from "react";
import { CheckCircle2, Download, ArrowRight, Printer } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import Link from "next/link";
import { getPaymentTransactionDetails } from "@/modules/payment/payment.service";

const Success = async ({
  params,
}: {
  params: Promise<{ tran_id: string }>;
}) => {
  const { tran_id } = await params;
  const transaction = await getPaymentTransactionDetails(tran_id);

  if (!transaction) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
        <Card className="max-w-lg w-full p-8 text-center">
          <h1 className="text-2xl font-bold text-slate-900 mb-2">
            Transaction Not Found
          </h1>
          <p className="text-slate-500 mb-6">
            We could not find payment details for this transaction id.
          </p>
          <Button asChild>
            <Link href="/dashboard/patient/appointments">
              Back to My Appointments
            </Link>
          </Button>
        </Card>
      </div>
    );
  }

  const paidAmount = Number(transaction?.payment?.amount || 0);
  const paidCurrency = transaction?.payment?.currency || "BDT";
  const paidAtRaw =
    transaction?.payment?.completedAt ||
    transaction?.payment?.initiatedAt ||
    transaction?.updatedAt ||
    new Date().toISOString();
  const paidDate = new Date(paidAtRaw).toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="min-h-screen bg-slate-50/50 flex items-center justify-center p-4 font-sans">
      <Card className="max-w-xl w-full border-none shadow-2xl bg-white/80 backdrop-blur-md overflow-hidden">
        <div className="h-2 bg-emerald-500 w-full" />

        <CardHeader className="text-center pt-10 pb-6">
          <div className="flex justify-center mb-4">
            <div className="rounded-full bg-emerald-100 p-3 animate-in zoom-in duration-500">
              <CheckCircle2 className="w-12 h-12 text-emerald-600" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
            Payment Successful
          </h1>
          <p className="text-slate-500 mt-2">
            Your payment was captured successfully.
          </p>
        </CardHeader>

        <CardContent className="space-y-6 px-8">
          <div className="rounded-2xl bg-slate-100/50 p-6 border border-slate-200/60">
            <div className="flex justify-between items-center mb-4">
              <span className="text-sm font-medium text-slate-500 uppercase tracking-wider">
                Transaction Details
              </span>
              <Badge
                variant="secondary"
                className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-none"
              >
                {transaction?.paymentStatus === "paid"
                  ? "Completed"
                  : "Pending"}
              </Badge>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Transaction ID</span>
                <span className="font-mono font-medium text-slate-900">
                  {tran_id}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Appointment ID</span>
                <span className="font-medium text-slate-900">
                  {transaction?.appointmentId ||
                    transaction?.payment?.appointmentId ||
                    "N/A"}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Doctor</span>
                <span className="font-medium text-slate-900">
                  {transaction?.doctor?.name || "N/A"}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Paid On</span>
                <span className="font-medium text-slate-900">{paidDate}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Payment Method</span>
                <span className="font-medium text-slate-900">
                  {transaction?.payment?.gateway || "sslcommerz"}
                </span>
              </div>
              <div className="pt-3 border-t border-slate-200 flex justify-between items-center">
                <span className="font-semibold text-slate-900">
                  Amount Paid
                </span>
                <span className="text-xl font-bold text-emerald-600">
                  {paidCurrency} {paidAmount.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          <p className="text-xs text-center text-slate-400">
            Download your invoice or print a receipt from the actions below.
          </p>
        </CardContent>

        <CardFooter className="flex flex-col gap-3 px-8 pb-10">
          <div className="grid grid-cols-2 gap-4 w-full">
            <Button
              asChild
              variant="outline"
              className="border-slate-200 hover:bg-slate-50 py-6 group"
            >
              <a href={`/api/payment/invoice/${tran_id}?download=1`}>
                <Download className="mr-2 h-4 w-4 transition-transform group-hover:translate-y-0.5" />
                Get Invoice
              </a>
            </Button>
            <Button
              asChild
              variant="outline"
              className="border-slate-200 hover:bg-slate-50 py-6"
            >
              <a
                href={`/api/payment/invoice/${tran_id}?print=1`}
                target="_blank"
                rel="noreferrer"
              >
                <Printer className="mr-2 h-4 w-4" />
                Print Receipt
              </a>
            </Button>
          </div>

          <Button
            asChild
            className="w-full py-6 bg-slate-900 hover:bg-slate-800 text-white shadow-lg shadow-slate-200"
          >
            <Link href="/dashboard/patient/appointments">
              Go to My Appointments
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>

          <Button variant="ghost" asChild className="text-slate-500">
            <Link href="/">Back to Home</Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
};

export default Success;
