import { serve } from "inngest/next";

import { inngest } from "@/inngest/client";
import {
  processPayload,
  embedDocument,
  generateBriefing,
  generateAudio,
  synthesizeSituations,
  generateMeetingPrep,
  resolveEntities,
  scoreAccountsWeekly,
  researchAccountFn,
} from "@/inngest/functions";

export const runtime = "nodejs";
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    processPayload,
    embedDocument,
    generateBriefing,
    generateAudio,
    synthesizeSituations,
    generateMeetingPrep,
    resolveEntities,
    scoreAccountsWeekly,
    researchAccountFn,
  ],
});
