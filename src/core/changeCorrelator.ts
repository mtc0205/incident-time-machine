/**
 * Change causality correlator: which deploy / merge most likely caused
 * this incident?
 *
 * Model (deterministic, explainable):
 *   suspectScore = timeProximity × serviceMatch × (1 + 0.3 × prRisk)
 *
 * - timeProximity: triangular kernel over a ±48h window around incident
 *   creation, PEAKING when the change landed 1-3 hours before the incident
 *   (the classic "we shipped at 14:00, alerts at 15:20" pattern).
 * - serviceMatch: 1.0 exact service overlap, 0.5 partial, 0.15 none.
 * - prRisk: pull requests that touch many services carry extra weight.
 */

import type { ChangeEvent, ScoredChange } from './types';

/** Changes older/newer than this window (hours) vs incident onset are ignored. */
export const WINDOW_HOURS = 48;

/** Kernel peak: changes 1-3h before onset score 1.0 on time proximity. */
export const PEAK_DELAY_HOURS = 2;

export const SERVICE_MATCH = { exact: 1.0, partial: 0.5, none: 0.15 } as const;

/**
 * Rank changes by how likely they caused the incident. Deterministic:
 * ties break by change id.
 */
export function findSuspectChanges(
  incident: { key: string; createdAt: string; services: readonly string[] },
  changes: readonly ChangeEvent[],
  limit = 3
): ScoredChange[] {
  const onset = new Date(incident.createdAt).getTime();
  const scored = changes
    .filter((c) => c.id !== incident.key)
    .map((change) => scoreChange(change, onset, incident.services))
    .filter((s) => s.score > 0);

  return scored
    .sort((a, b) => b.score - a.score || a.change.id.localeCompare(b.change.id))
    .slice(0, limit);
}

/** Score a single change against an incident onset. Exported for tests. */
export function scoreChange(change: ChangeEvent, onsetMs: number, incidentServices: readonly string[]): ScoredChange {
  const completedMs = new Date(change.completedAt).getTime();
  const hoursBefore = (onsetMs - completedMs) / 3_600_000; // >0: change before incident

  const timeK = timeProximity(hoursBefore);
  const service = serviceMatchLevel(change.services, incidentServices);
  const prRisk = change.kind === 'pull-request' ? prRiskScore(change) : 0;
  const score = timeK * service * (1 + 0.3 * prRisk);

  const explanation: string[] = [];
  explanation.push(
    hoursBefore >= 0
      ? `landed ${Math.abs(hoursBefore).toFixed(1)}h before the incident (time proximity ${(timeK * 100).toFixed(0)}%)`
      : `landed ${Math.abs(hoursBefore).toFixed(1)}h AFTER incident onset (time proximity ${(timeK * 100).toFixed(0)}%)`
  );
  explanation.push(
    service === SERVICE_MATCH.exact
      ? `touches the same service(s): ${overlap(change.services, incidentServices).join(', ')}`
      : service === SERVICE_MATCH.partial
        ? `touches a related service: ${overlap(change.services, incidentServices).join(', ') || change.services.join(', ')}`
        : 'no direct service overlap (exploratory signal only)'
  );
  if (prRisk > 0) explanation.push(`pull request spans ${change.services.length} services (risk +${(prRisk * 100).toFixed(0)}%)`);

  return { change, score: round(score), explanation };
}

/**
 * Triangular time kernel over hoursBefore (change completion minus onset):
 *
 *   1.0 ─────────────┐peak plateau 0-3h before
 *                    │╲
 *                    │ ╲  linear decay to 0 at ±WINDOW_HOURS
 *   ─────────────────┴─╲──────────────
 *  -48h          onset  0        +48h (change after onset)
 *
 * Changes after onset can still score (cascades, delayed jobs) but much less.
 */
export function timeProximity(hoursBefore: number): number {
  const abs = Math.abs(hoursBefore);
  if (abs >= WINDOW_HOURS) return 0;
  if (hoursBefore >= 0 && hoursBefore <= PEAK_DELAY_HOURS + 1) return 1; // 0..3h before onset
  const distance = hoursBefore > 0 ? hoursBefore - (PEAK_DELAY_HOURS + 1) : abs; // decay from peak edge
  return round(Math.max(0, 1 - distance / (WINDOW_HOURS - PEAK_DELAY_HOURS - 1)));
}

/**
 * Service match level. Exact when any service matches; partial when the
 * change touches a "related" service (shares a prefix namespace like
 * "payments" vs "payments-gateway"); none otherwise.
 */
export function serviceMatchLevel(changeServices: readonly string[], incidentServices: readonly string[]): number {
  if (overlap(changeServices, incidentServices).length > 0) return SERVICE_MATCH.exact;
  for (const cs of changeServices) {
    for (const is of incidentServices) {
      if (cs === is) continue; // handled above
      if (relatedNamespace(cs, is)) return SERVICE_MATCH.partial;
    }
  }
  return SERVICE_MATCH.none;
}

/** Two services are related when one is a hyphen-namespace child of the other. */
export function relatedNamespace(a: string, b: string): boolean {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()];
  return x !== y && (x.startsWith(`${y}-`) || y.startsWith(`${x}-`));
}

/** Pull-request risk proxy: broad PRs (many services) are riskier. */
export function prRiskScore(change: ChangeEvent): number {
  if (change.kind !== 'pull-request') return 0;
  const breadth = Math.min(change.services.length, 6) / 6; // saturates at 6 services
  return round(0.3 + 0.7 * breadth);
}

function overlap(a: readonly string[], b: readonly string[]): string[] {
  const sb = new Set(b.map((s) => s.toLowerCase()));
  return [...new Set(a.map((s) => s.toLowerCase()))].filter((s) => sb.has(s));
}

function round(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
