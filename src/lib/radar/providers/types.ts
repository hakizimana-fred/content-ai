/**
 * Provider-agnostic contracts for Live Radar.
 *
 * Five capabilities are deliberately separate. A provider may implement only some of them, and implementing one
 * never implies permission for another:
 *
 *   detection     – "is @user live right now?"            (this file: LiveDetectionProvider)
 *   streamAccess  – "give me a URL I can pull the stream" (this file: StreamAccessProvider, optional)
 *   recording     – app-level worker; requires `can(creator,'recording')` – see ../gate.ts
 *   archiving     – app-level; stores what recording produced
 *   distribution  – app-level; requires `can(creator,'redistribution', platform)`
 */

export type LiveState = 'live' | 'offline' | 'unknown';

/** Where the provider gets its data. This is a compliance fact, not a quality rating. */
export type DataSource =
  | 'official-api'          // documented, first-party API under its own terms
  | 'creator-authorized'    // creator connected their own account / sends us the signal
  | 'third-party-service'   // a vendor sells it; how they obtain it is theirs to disclose
  | 'unofficial-protocol'   // reverse-engineered platform interfaces
  | 'manual'                // a human observed it
  | 'none';

export interface ProviderInfo {
  id: string;
  name: string;
  dataSource: DataSource;
  /** Whether the provider's own terms permit our commercial use. 'unverified' until someone reads and records it. */
  commercialUse: 'permitted' | 'prohibited' | 'unverified';
  /** Whether using it is consistent with the *platform's* terms. Almost always 'unverified' or 'at-risk' for non-official sources. */
  platformTermsRisk: 'low' | 'unverified' | 'at-risk';
  capabilities: { detection: boolean; streamAccess: boolean };
  /** Suggested minimum gap between checks for one creator, to respect rate limits. */
  minPollIntervalMs: number;
}

export interface DetectionResult {
  username: string;
  state: LiveState;
  /** When our check ran (ms epoch). */
  checkedAt: number;
  viewerCount?: number;
  /** Provider's own start time for the session, if it reports one. */
  startedAt?: number;
  /** Provider-specific room/session id, useful for de-duplicating sessions. */
  sessionId?: string;
  /** Free-text provider detail. Never shown as fact; for debugging. */
  raw?: unknown;
}

/** Thrown for failures that are not "offline": network errors, auth, rate limits, schema changes. */
export class ProviderError extends Error {
  readonly kind: 'network' | 'auth' | 'rate-limit' | 'schema' | 'unavailable' | 'not-configured' | 'not-found';
  readonly retryAfterMs?: number;
  constructor(message: string, kind: ProviderError['kind'], retryAfterMs?: number) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface LiveDetectionProvider {
  readonly info: ProviderInfo;
  /** Must throw ProviderError on failure. It must NOT return 'offline' when it simply could not find out. */
  check(username: string, signal?: AbortSignal): Promise<DetectionResult>;
}

export interface StreamInfo {
  url: string;
  kind: 'hls' | 'flv' | 'other';
  expiresAt?: number;
}

/**
 * Optional, separate from detection. Callers must go through `streamForRecording` in ../gate.ts, which re-checks
 * the creator's permission immediately before asking for a stream.
 */
export interface StreamAccessProvider extends LiveDetectionProvider {
  getStream(username: string, signal?: AbortSignal): Promise<StreamInfo | null>;
}

export const hasStreamAccess = (p: LiveDetectionProvider): p is StreamAccessProvider =>
  p.info.capabilities.streamAccess && typeof (p as StreamAccessProvider).getStream === 'function';
