import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "chief-of-staff",
  name: "Chief of Staff",
});

/**
 * Event channel. Keep payload shapes stable — adding fields is fine; renaming is not.
 */
export type AppEvents = {
  "ingestion/payload.received": {
    data: {
      ledgerId: string;
      sourceSystem: string;
      sourceId: string;
      documentId?: string;
      claimIds: string[];
      entityIds: string[];
    };
  };
  "briefing/preload.requested": {
    data: { forDate: string; moduleId?: string };
  };
  "briefing/audio.requested": {
    data: { briefingId: string };
  };
  "alerts/scan.requested": {
    data: { since?: string };
  };
  "situations/synthesize.requested": {
    data: { reason?: string };
  };
};
