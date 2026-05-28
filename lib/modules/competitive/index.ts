import type { ModuleDefinition } from "@/lib/modules/types";
import { COMPETITIVE_PALETTE } from "@/lib/modules/competitive/palette";
import { COMPETITIVE_DETECTORS } from "@/lib/modules/competitive/detectors";

export const competitiveModule: ModuleDefinition = {
  id: "competitive",
  name: "Competitive Intel",
  envelopeFilter: () => true,
  signalDetectors: COMPETITIVE_DETECTORS,
  dashboardRoute: "/competitive",
  palette: COMPETITIVE_PALETTE,
};
