import type { ModuleDefinition } from "@/lib/modules/types";
import { PIPELINE_PALETTE } from "@/lib/modules/pipeline/palette";
import { PIPELINE_DETECTORS } from "@/lib/modules/pipeline/detectors";

export const pipelineModule: ModuleDefinition = {
  id: "pipeline",
  name: "Pipeline",
  envelopeFilter: (env) => {
    if (env.source_system === "salesforce") return true;
    return env.claims.some((c) => c.module_id === "pipeline");
  },
  signalDetectors: PIPELINE_DETECTORS,
  dashboardRoute: "/pipeline",
  palette: PIPELINE_PALETTE,
};
