/**
 * Module registry. Add new modules here as they ship; the process-payload pipeline
 * iterates this list to filter envelopes and dispatch detectors.
 */

import type { ModuleDefinition, ModuleId } from "@/lib/modules/types";
import { pipelineModule } from "@/lib/modules/pipeline";
import { csModule } from "@/lib/modules/cs";
import { teamModule } from "@/lib/modules/team";
import { initiativesModule } from "@/lib/modules/initiatives";
import { finservModule } from "@/lib/modules/finserv";
import { competitiveModule } from "@/lib/modules/competitive";
import { prioritiesModule } from "@/lib/modules/priorities";
import { commsModule } from "@/lib/modules/comms";

const MODULES: ModuleDefinition[] = [
  pipelineModule,
  csModule,
  teamModule,
  initiativesModule,
  finservModule,
  competitiveModule,
  prioritiesModule,
  commsModule,
];

export function getModule(id: ModuleId): ModuleDefinition | undefined {
  return MODULES.find((m) => m.id === id);
}

export function allModules(): ModuleDefinition[] {
  return MODULES;
}
