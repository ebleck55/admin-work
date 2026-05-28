/**
 * Module registry. Add new modules here as they ship; the process-payload pipeline
 * iterates this list to filter envelopes and dispatch detectors.
 */

import type { ModuleDefinition, ModuleId } from "@/lib/modules/types";
import { pipelineModule } from "@/lib/modules/pipeline";

const MODULES: ModuleDefinition[] = [pipelineModule];

export function getModule(id: ModuleId): ModuleDefinition | undefined {
  return MODULES.find((m) => m.id === id);
}

export function allModules(): ModuleDefinition[] {
  return MODULES;
}
