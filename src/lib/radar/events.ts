import { EventEmitter } from 'node:events';
import type { Creator, LiveSession, RadarNotification } from '../../types/radar.ts';

export type RadarEvent =
  | { type: 'creator-updated'; creator: Creator }
  | { type: 'creator-removed'; id: string }
  | { type: 'session'; session: LiveSession }
  | { type: 'notification'; notification: RadarNotification }
  | { type: 'notifications-read'; ids: string[] | 'all' }
  | { type: 'checking'; creatorId: string; on: boolean }
  | { type: 'provider-status'; problem: string | null };

/** Process-wide bus on globalThis (see store.ts for why). 'event' feeds the browser stream; 'kick' wakes the monitor. */
const g = globalThis as unknown as { __radarBus?: EventEmitter };
const em = (g.__radarBus ??= Object.assign(new EventEmitter(), {}));
em.setMaxListeners(200);

export const bus = {
  publish: (e: RadarEvent) => { em.emit('event', e); },
  subscribe: (fn: (e: RadarEvent) => void) => { em.on('event', fn); return () => { em.off('event', fn); }; },
  kick: (creatorId: string) => { em.emit('kick', creatorId); },
  onKick: (fn: (creatorId: string) => void) => { em.on('kick', fn); return () => { em.off('kick', fn); }; },
};
