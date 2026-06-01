/**
 * Manual trigger for situation synthesis. Fires the
 * `situations/synthesize.requested` event into Inngest. Useful for kicking off
 * synthesis after backfilling data or for "refresh" actions in the UI.
 *
 * Cron + per-signal triggers also run automatically; this endpoint is for
 * on-demand use.
 */

import { withHandler } from "@/lib/api/handler";
import { inngest } from "@/inngest/client";

export const runtime = "nodejs";

export const POST = withHandler(async () => {
  await inngest.send({
    name: "situations/synthesize.requested",
    data: { reason: "manual" },
  });
  return { queued: true };
});
