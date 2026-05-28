import type { ModuleDefinition } from "@/lib/modules/types";
import { CS_PALETTE } from "@/lib/modules/cs/palette";
import { CS_DETECTORS } from "@/lib/modules/cs/detectors";

export const csModule: ModuleDefinition = {
  id: "cs",
  name: "Customer Success",
  envelopeFilter: (env) => env.claims.some((c) => c.module_id === "cs"),
  signalDetectors: CS_DETECTORS,
  dashboardRoute: "/cs",
  palette: CS_PALETTE,
};
