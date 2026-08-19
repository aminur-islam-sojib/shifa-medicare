export const AppointmentStatus = {
  Scheduled: "scheduled",
  ConfirmedLower: "confirmed",
  InProgress: "in-progress",
  CompletedLower: "completed",
  CancelledLower: "cancelled",
  NoShow: "no-show",
  PendingPayment: "PendingPayment",
  Approved: "Approved",
  Confirmed: "Confirmed",
  Completed: "Completed",
  Cancelled: "Cancelled",
  Expired: "Expired",
};

export const allowedTransitions = {
  scheduled: ["confirmed", "cancelled", "no-show"],
  confirmed: ["in-progress", "cancelled", "no-show"],
  "in-progress": ["completed", "cancelled"],
  completed: [],
  cancelled: [],
  "no-show": [],
  PendingPayment: ["Cancelled"],
  Approved: ["Confirmed", "Cancelled"],
  Confirmed: ["completed", "Completed", "Cancelled"],
  Completed: [],
  Cancelled: [],
  Expired: [],
};

export function canTransition(from, to) {
  return allowedTransitions[from]?.includes(to);
}
