import type { ModuleDefinition } from "@/lib/modules/types";
import { FINSERV_PALETTE } from "@/lib/modules/finserv/palette";
import { FINSERV_DETECTORS } from "@/lib/modules/finserv/detectors";

export const finservModule: ModuleDefinition = {
  id: "finserv",
  name: "FinServ Vertical Intel",
  envelopeFilter: () => true, // run detectors on every payload — regulatory terms can show up anywhere
  signalDetectors: FINSERV_DETECTORS,
  dashboardRoute: "/finserv",
  palette: FINSERV_PALETTE,
};
