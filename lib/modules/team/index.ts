import type { ModuleDefinition } from "@/lib/modules/types";
import { TEAM_PALETTE } from "@/lib/modules/team/palette";
import { TEAM_DETECTORS } from "@/lib/modules/team/detectors";

export const teamModule: ModuleDefinition = {
  id: "team",
  name: "Team Performance",
  envelopeFilter: (env) => env.claims.some((c) => c.module_id === "team"),
  signalDetectors: TEAM_DETECTORS,
  dashboardRoute: "/team",
  palette: TEAM_PALETTE,
};
