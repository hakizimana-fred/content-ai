import type { LiveDetectionProvider, DetectionResult, StreamAccessProvider, StreamInfo } from './types.ts';
import { ProviderError } from './types.ts';

/**
 * Generic adapter for any HTTP+JSON service that answers "is this user live?". It is configuration, not an
 * integration: it knows nothing about a particular vendor. Nothing runs unless every required setting is supplied.
 *
 *   RADAR_HTTP_URL         e.g. https://api.example.com/live?user={username}      (required)
 *   RADAR_HTTP_API_KEY     secret, sent as header RADAR_HTTP_API_KEY_HEADER (default x-api-key)  (optional)
 *   RADAR_HTTP_HEADERS     JSON object of extra headers                                      (optional)
 *   RADAR_HTTP_LIVE_PATH   dot path to the live flag, e.g. data.isLive              (required)
 *   RADAR_HTTP_VIEWERS_PATH / RADAR_HTTP_SESSION_PATH / RADAR_HTTP_STREAM_PATH      (optional)
 *   RADAR_HTTP_SOURCE      declared data source: third-party-service | unofficial-protocol | official-api
 *
 * The declared source and the two compliance fields are what YOU assert after reading the vendor's terms.
 */
export interface HttpJsonConfig {
  url: string; headers?: Record<string, string>; livePath: string;
  viewersPath?: string; sessionPath?: string; streamPath?: string;
  dataSource: 'third-party-service' | 'unofficial-protocol' | 'official-api';
  commercialUse?: 'permitted' | 'prohibited' | 'unverified';
  timeoutMs?: number; minPollIntervalMs?: number; name?: string;
}

const dig = (o: unknown, path?: string): unknown => path?.split('.').reduce<unknown>((a, k) => (a && typeof a === 'object' ? (a as Record<string, unknown>)[k] : undefined), o);

export function configFromEnv(env: Record<string, string | undefined> = process.env): HttpJsonConfig | null {
  if (!env.RADAR_HTTP_URL || !env.RADAR_HTTP_LIVE_PATH || !env.RADAR_HTTP_SOURCE) return null;
  const src = env.RADAR_HTTP_SOURCE as HttpJsonConfig['dataSource'];
  if (!['third-party-service', 'unofficial-protocol', 'official-api'].includes(src)) return null;
  let headers: Record<string, string> | undefined;
  if (env.RADAR_HTTP_HEADERS) { try { headers = JSON.parse(env.RADAR_HTTP_HEADERS); } catch { return null; } }
  if (env.RADAR_HTTP_API_KEY) headers = { ...headers, [env.RADAR_HTTP_API_KEY_HEADER || 'x-api-key']: env.RADAR_HTTP_API_KEY };
  return { url: env.RADAR_HTTP_URL, headers, livePath: env.RADAR_HTTP_LIVE_PATH, viewersPath: env.RADAR_HTTP_VIEWERS_PATH, sessionPath: env.RADAR_HTTP_SESSION_PATH, streamPath: env.RADAR_HTTP_STREAM_PATH, dataSource: src, commercialUse: (env.RADAR_HTTP_COMMERCIAL as HttpJsonConfig['commercialUse']) ?? 'unverified', minPollIntervalMs: Number(env.RADAR_HTTP_MIN_INTERVAL_MS) || 30_000, name: env.RADAR_HTTP_NAME };
}

export function createHttpJsonProvider(cfg: HttpJsonConfig, fetchImpl: typeof fetch = fetch): StreamAccessProvider {
  const call = async (username: string, signal?: AbortSignal) => {
    const url = cfg.url.replace('{username}', encodeURIComponent(username));
    let res: Response;
    try { res = await fetchImpl(url, { headers: cfg.headers, signal: signal ?? AbortSignal.timeout(cfg.timeoutMs ?? 15_000) }); }
    catch (e) { throw new ProviderError(`Request failed: ${(e as Error).message}`, 'network'); }
    if (res.status === 401 || res.status === 403) throw new ProviderError(`Provider rejected credentials (${res.status}).`, 'auth');
    if (res.status === 404) throw new ProviderError('The provider could not find that username.', 'not-found');
    if (res.status === 429) throw new ProviderError('Rate limited by provider.', 'rate-limit', Number(res.headers.get('retry-after')) * 1000 || undefined);
    if (res.status >= 500) throw new ProviderError(`Provider error (${res.status}).`, 'unavailable');
    if (!res.ok) throw new ProviderError(`Unexpected status ${res.status}.`, 'schema');
    return res.json().catch(() => { throw new ProviderError('Provider returned non-JSON.', 'schema'); });
  };
  return {
    info: {
      id: 'http-json', name: cfg.name ?? 'HTTP JSON provider', dataSource: cfg.dataSource, commercialUse: cfg.commercialUse ?? 'unverified',
      platformTermsRisk: cfg.dataSource === 'official-api' ? 'low' : cfg.dataSource === 'unofficial-protocol' ? 'at-risk' : 'unverified',
      capabilities: { detection: true, streamAccess: !!cfg.streamPath }, minPollIntervalMs: cfg.minPollIntervalMs ?? 30_000,
    },
    async check(username, signal): Promise<DetectionResult> {
      const body = await call(username, signal);
      const flag = dig(body, cfg.livePath);
      // A missing/garbled flag is a schema failure, never "offline": silently treating it as offline would hide breakage.
      if (typeof flag !== 'boolean') throw new ProviderError(`Field "${cfg.livePath}" missing or not boolean (provider format changed?).`, 'schema');
      const v = dig(body, cfg.viewersPath); const s = dig(body, cfg.sessionPath);
      return { username, state: flag ? 'live' : 'offline', checkedAt: Date.now(), viewerCount: typeof v === 'number' ? v : undefined, sessionId: s != null ? String(s) : undefined };
    },
    async getStream(username, signal): Promise<StreamInfo | null> {
      if (!cfg.streamPath) return null;
      const u = dig(await call(username, signal), cfg.streamPath);
      if (typeof u !== 'string' || !u) return null;
      return { url: u, kind: /\.m3u8/.test(u) ? 'hls' : /\.flv/.test(u) ? 'flv' : 'other' };
    },
  };
}
