import { ApiResponse } from "@/infrastructure/lib/legacy/api";
import { getAmbulanceBookingById } from "@/modules/ambulance/services/booking.service";
import { serializeAmbulanceDoc } from "@/modules/ambulance/infrastructure/ambulance.serializer";
import { ambulanceRepository } from "@/modules/ambulance/infrastructure/ambulance.repository";
import {
  handleRouteError,
  requireSession,
} from "@/modules/ambulance/services/route-helpers";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireSession([
      "patient",
      "ambulance_provider",
      "admin",
    ]);
    if (auth.error || !auth.session) return auth.error || ApiResponse.unauthorized("Authentication required");

    const { session } = auth;
    const { id } = await params;
    const data = await getAmbulanceBookingById(id);

    if (session.user.role === "patient") {
      if (data.patientId.toString() !== session.user.id) {
        return ApiResponse.forbidden("Forbidden");
      }
    } else if (session.user.role === "ambulance_provider") {
      const provider = await ambulanceRepository.findProviderByUserId(session.user.id);
      if (
        !provider ||
        data.assignedProviderId?.toString() !== provider._id?.toString()
      ) {
        return ApiResponse.forbidden("Forbidden");
      }
    }

    return ApiResponse.success(serializeAmbulanceDoc(data));
  } catch (error) {
    return handleRouteError(error);
  }
}
