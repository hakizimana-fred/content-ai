import type { LiveDetectionProvider } from './types.ts';
import { ProviderError } from './types.ts';

/** Default. Honest "we cannot tell": every check fails with `not-configured`, so nothing is ever reported live. */
export const nullProvider: LiveDetectionProvider = {
  info: {
    id: 'none', name: 'No provider configured', dataSource: 'none', commercialUse: 'unverified', platformTermsRisk: 'low',
    capabilities: { detection: false, streamAccess: false }, minPollIntervalMs: 60_000,
  },
  async check() { throw new ProviderError('No LIVE detection provider is configured.', 'not-configured'); },
};
