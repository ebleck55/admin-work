import { serve } from "inngest/next";

import { inngest } from "@/inngest/client";
import { processPayload } from "@/inngest/functions/process-payload";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processPayload],
});
