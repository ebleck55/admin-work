/**
 * Per-provider circuit breaker.
 *
 * Ported from `bart-app/server/lib/orchestrator.js:248-305`. Bart maintained one breaker
 * for Opus; we generalize so any provider key can have its own breaker. Defaults match
 * Bart's settings: 2 consecutive failures or >15s response = open for 10 minutes.
 */

export interface CircuitBreakerConfig {
  /** Open after this many consecutive failures. */
  maxConsecutiveFailures: number;
  /** Cooldown duration once open. */
  cooldownMs: number;
  /** Slow responses (above this) count as failures. */
  slowResponseMs: number;
}

const DEFAULTS: CircuitBreakerConfig = {
  maxConsecutiveFailures: 2,
  cooldownMs: 10 * 60 * 1000,
  slowResponseMs: 15_000,
};

interface BreakerState {
  consecutiveFailures: number;
  openUntil: number;
}

const breakers = new Map<string, BreakerState>();
const configs = new Map<string, CircuitBreakerConfig>();

function getState(key: string): BreakerState {
  let state = breakers.get(key);
  if (!state) {
    state = { consecutiveFailures: 0, openUntil: 0 };
    breakers.set(key, state);
  }
  return state;
}

function getConfig(key: string): CircuitBreakerConfig {
  return configs.get(key) ?? DEFAULTS;
}

export function configureBreaker(key: string, config: Partial<CircuitBreakerConfig>): void {
  configs.set(key, { ...DEFAULTS, ...config });
}

/** True if the breaker is currently open. Resets the state once cooldown has elapsed. */
export function isCircuitOpen(key: string): boolean {
  const state = getState(key);
  if (state.openUntil === 0) return false;
  if (Date.now() < state.openUntil) return true;
  state.openUntil = 0;
  state.consecutiveFailures = 0;
  return false;
}

export function recordResult(
  key: string,
  result: { success: boolean; durationMs?: number },
): void {
  const state = getState(key);
  const config = getConfig(key);
  const isSlow =
    result.durationMs !== undefined && result.durationMs > config.slowResponseMs;
  if (result.success && !isSlow) {
    state.consecutiveFailures = 0;
    return;
  }
  state.consecutiveFailures += 1;
  if (state.consecutiveFailures >= config.maxConsecutiveFailures) {
    state.openUntil = Date.now() + config.cooldownMs;
  }
}

/** For tests. */
export function _reset(): void {
  breakers.clear();
  configs.clear();
}
