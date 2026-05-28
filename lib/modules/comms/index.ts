import type { ModuleDefinition } from "@/lib/modules/types";
import { COMMS_PALETTE } from "@/lib/modules/comms/palette";

/**
 * Exec Communications module — no per-payload detectors. Drafts are produced
 * on-demand from the Q&A console or the briefing engine. The dashboard lists
 * recently-generated artifacts (Phase 5+).
 */
export const commsModule: ModuleDefinition = {
  id: "comms",
  name: "Exec Communications",
  envelopeFilter: () => false,
  signalDetectors: [],
  dashboardRoute: "/comms",
  palette: COMMS_PALETTE,
};
