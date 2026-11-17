import type { LiveDetectionProvider } from './providers/types.ts';
import { nullProvider } from './providers/null.ts';
import { configFromEnv, createHttpJsonProvider } from './providers/http-json.ts';
import { DEFAULT_TRANSITION_CONFIG, type TransitionConfig } from './transition.ts';

export interface ProviderResolution {
  provider: LiveDetectionProvider;
  /** null = ready. Otherwise the precise reason nothing is being monitored. */
  problem: string | null;
}

const SOURCES = ['third-party-service', 'unofficial-protocol', 'official-api'];

/**
 * Builds the detection provider from environment variables ONLY (never hard-coded keys). Returns the null provider
 * plus an exact explanation when anything required is missing, and refuses non-official sources until the operator
 * explicitly acknowledges the platform-terms risk.
 */
export function resolveProvider(env: Record<string, string | undefined> = process.env): ProviderResolution {
  const missing: string[] = [];
  if (!env.RADAR_HTTP_URL) missing.push('RADAR_HTTP_URL (the provider endpoint, containing {username})');
  else if (!env.RADAR_HTTP_URL.includes('{username}')) missing.push('RADAR_HTTP_URL must contain the placeholder {username}');
  if (!env.RADAR_HTTP_LIVE_PATH) missing.push('RADAR_HTTP_LIVE_PATH (JSON path of the boolean "is live" field, e.g. data.isLive)');
  if (!env.RADAR_HTTP_SOURCE) missing.push(`RADAR_HTTP_SOURCE (how the provider gets its data: ${SOURCES.join(' | ')})`);
  else if (!SOURCES.includes(env.RADAR_HTTP_SOURCE)) missing.push(`RADAR_HTTP_SOURCE must be one of: ${SOURCES.join(', ')}`);
  if (missing.length) return { provider: nullProvider, problem: `No LIVE detection provider is configured. Missing: ${missing.join('; ')}.` };

  const cfg = configFromEnv(env);
  if (!cfg) return { provider: nullProvider, problem: 'Provider settings are present but invalid (check RADAR_HTTP_HEADERS is valid JSON).' };

  if (cfg.dataSource !== 'official-api' && env.RADAR_ACKNOWLEDGE_PLATFORM_TERMS !== 'yes') {
    return { provider: nullProvider, problem: `A "${cfg.dataSource}" provider is configured but not enabled. Detecting TikTok LIVE through it may conflict with TikTok's terms (see docs/LIVE_RADAR_PHASE2_DECISION_REPORT.md). To accept that risk and enable monitoring, set RADAR_ACKNOWLEDGE_PLATFORM_TERMS=yes.` };
  }
  return { provider: createHttpJsonProvider(cfg), problem: null };
}

export function transitionConfigFromEnv(env: Record<string, string | undefined> = process.env, providerMinMs = 0): TransitionConfig {
  const num = (k: string, d: number) => { const v = Number(env[k]); return Number.isFinite(v) && v > 0 ? v : d; };
  const interval = Math.max(num('RADAR_POLL_INTERVAL_S', 60) * 1000, providerMinMs);
  return { ...DEFAULT_TRANSITION_CONFIG, intervalMs: interval, confirmDelayMs: Math.max(Math.round(interval / 2), providerMinMs), offlineConfirmations: num('RADAR_OFFLINE_CONFIRMATIONS', DEFAULT_TRANSITION_CONFIG.offlineConfirmations) };
}
