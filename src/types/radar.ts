export type RadarPlatform = 'tiktok';
export type MonitoringStatus = 'active' | 'paused';

/**
 * Persisted LIVE state. It only ever changes in response to a real provider answer:
 *   unknown – never successfully checked
 *   live / offline – the provider said so
 *   error – the last check FAILED (this is never interpreted as offline)
 * CHECKING (a request in flight) and PAUSED (monitoring === 'paused') are derived at display time.
 */
export type LiveState = 'unknown' | 'live' | 'offline' | 'error';

export interface LiveInfo {
  state: LiveState;
  /** ISO time this state began. */
  since?: string;
  checkedAt?: string;
  lastSuccessAt?: string;
  /** Our id for the currently open LiveSession, if any. */
  sessionId?: string;
  viewerCount?: number;
  provider?: string;
  error?: { kind: string; message: string; at: string };
  consecutiveErrors?: number;
  consecutiveOffline?: number;
  firstOfflineAt?: string;
  nextCheckAt?: string;
}

export interface LiveSession {
  id: string;
  creatorId: string;
  username: string;
  providerSessionId?: string;
  provider: string;
  firstDetectedAt: string;
  lastDetectedAt: string;
  /** The provider's own start time, when it reports one. */
  startedAt?: string;
  endedAt?: string;
  /** true = we observed OFFLINE; false = we lost contact or never confirmed the end. */
  endConfirmed: boolean;
  endReason?: 'offline-confirmed' | 'lost-contact' | 'session-changed';
  detectionResult: 'live';
  peakViewers?: number;
  lastViewerCount?: number;
  checks: number;
  /** Snapshot at detection time: was recording permitted? (Recording itself is a separate, later step.) */
  recordingAuthorized: boolean;
  recordingNote?: string;
}

export interface RadarNotification {
  id: string;
  at: string;
  kind: 'live-detected' | 'live-ended' | 'provider-error' | 'provider-recovered';
  creatorId?: string;
  username?: string;
  title: string;
  body: string;
  read: boolean;
}

export interface PermissionScope {
  recording: boolean;
  editing: boolean;
  redistribution: boolean;
  monetization: boolean;
}

export interface CreatorPermission {
  /** Who granted it, e.g. the creator's name or the contact who confirmed it. */
  grantedBy: string;
  /** How consent was obtained (email, signed agreement, DM...). Required so it can be audited. */
  evidence: string;
  scope: PermissionScope;
  platforms: string[];
  grantedAt: string;
  expiresAt?: string;
  revokedAt?: string;
  /** Guests, licensed music or other third-party material the permission does NOT cover. */
  thirdPartyNotes?: string;
}

export interface AuditEntry {
  at: string;
  action: string;
  detail?: string;
}

export interface Creator {
  id: string;
  platform: RadarPlatform;
  username: string;
  displayName: string;
  avatarUrl?: string;
  language: string;
  category: string;
  group?: string;
  monitoring: MonitoringStatus;
  notify: boolean;
  /** Optional channel ids / handles this creator's content may be distributed to. */
  channels: string[];
  notes?: string;
  permission?: CreatorPermission;
  live: LiveInfo;
  audit: AuditEntry[];
  createdAt: string;
  updatedAt: string;
}

export type PermissionStatus = 'none' | 'active' | 'expiring' | 'expired' | 'revoked';
