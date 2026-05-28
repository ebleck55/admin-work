import { serve } from "inngest/next";

import { inngest } from "@/inngest/client";
import {
  processPayload,
  embedDocument,
  generateBriefing,
  generateAudio,
} from "@/inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processPayload, embedDocument, generateBriefing, generateAudio],
});
