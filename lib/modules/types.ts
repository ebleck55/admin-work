/**
 * Module contract. Every domain module (Pipeline, CS, Team, Initiatives, FinServ,
 * Competitive, Priorities, Comms) implements this interface and registers itself.
 */

import type { PayloadEnvelope, Claim } from "@/lib/ingestion/envelope";

export type ModuleId =
  | "pipeline"
  | "cs"
  | "team"
  | "initiatives"
  | "finserv"
  | "competitive"
  | "priorities"
  | "comms";

export interface ModulePalette {
  primary: string;
  accent: string;
  gradientFrom: string;
  gradientTo: string;
}

export interface SignalCandidate {
  kind:
    | "deal_risk"
    | "expansion_opp"
    | "churn_indicator"
    | "coaching_moment"
    | "regulatory_signal"
    | "competitive_mention"
    | "commitment"
    | "escalation";
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  summary: string;
  entityName?: string;
  entityKind?: "account" | "opportunity" | "contact" | "rep" | "initiative" | "competitor";
  claimIds: string[];
  attributes?: Record<string, unknown>;
}

export interface SignalDetectorContext {
  envelope: PayloadEnvelope;
  claims: Array<Claim & { id: string }>;
  /** Module-supplied helpers (DB access, retrieval, etc.). */
}

export type SignalDetector = (ctx: SignalDetectorContext) => Promise<SignalCandidate[]>;

export interface ModuleDefinition {
  id: ModuleId;
  name: string;
  /** Does this envelope belong to this module? Modules are not mutually exclusive. */
  envelopeFilter: (env: PayloadEnvelope) => boolean;
  signalDetectors: SignalDetector[];
  dashboardRoute: string;
  palette: ModulePalette;
}
