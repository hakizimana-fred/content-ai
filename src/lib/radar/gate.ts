import { getCreator, addAudit } from './store';
import { can, type Action } from './permissions';
import type { LiveDetectionProvider, StreamInfo } from './providers/types';
import { hasStreamAccess } from './providers/types';

export class PermissionError extends Error { constructor(message: string) { super(message); this.name = 'PermissionError'; } }

/**
 * The single checkpoint for anything beyond detection. It re-reads the creator from storage on EVERY call (never a
 * cached copy) so a revocation or expiry takes effect immediately, and writes the outcome to the audit trail.
 * Call it right before recording starts, again when stream access is requested, and again right before publishing.
 */
export function authorize(creatorId: string, action: Action, opts: { platform?: string; purpose?: string } = {}) {
  const c = getCreator(creatorId);
  if (!c) throw new PermissionError('Creator no longer exists.');
  const d = can(c, action, opts.platform);
  addAudit(creatorId, d.allowed ? `${action} allowed` : `${action} blocked`, [opts.purpose, opts.platform, d.reason].filter(Boolean).join(' · ') || undefined);
  if (!d.allowed) throw new PermissionError(d.reason ?? `${action} is not permitted.`);
  return c;
}

/** Stream access for recording: permission first, provider second. Detection alone never reaches this. */
export async function streamForRecording(provider: LiveDetectionProvider, creatorId: string, signal?: AbortSignal): Promise<StreamInfo | null> {
  const c = authorize(creatorId, 'recording', { purpose: `stream access via ${provider.info.id}` });
  if (!hasStreamAccess(provider)) return null;
  return provider.getStream(c.username, signal);
}
