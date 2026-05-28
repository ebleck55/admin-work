import type { ModuleDefinition } from "@/lib/modules/types";
import { PRIORITIES_PALETTE } from "@/lib/modules/priorities/palette";

/**
 * Priorities module has no per-payload detectors — it computes a ranked feed from
 * the cross-module signals. The ranker lives separately and runs nightly (Phase 5+).
 */
export const prioritiesModule: ModuleDefinition = {
  id: "priorities",
  name: "Priority Feed",
  envelopeFilter: () => false,
  signalDetectors: [],
  dashboardRoute: "/priorities",
  palette: PRIORITIES_PALETTE,
};
