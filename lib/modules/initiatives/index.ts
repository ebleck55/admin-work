import type { ModuleDefinition } from "@/lib/modules/types";
import { INITIATIVES_PALETTE } from "@/lib/modules/initiatives/palette";
import { INITIATIVES_DETECTORS } from "@/lib/modules/initiatives/detectors";

export const initiativesModule: ModuleDefinition = {
  id: "initiatives",
  name: "Strategic Initiatives",
  envelopeFilter: (env) => env.claims.some((c) => c.module_id === "initiatives"),
  signalDetectors: INITIATIVES_DETECTORS,
  dashboardRoute: "/initiatives",
  palette: INITIATIVES_PALETTE,
};
