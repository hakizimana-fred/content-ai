# Live Radar — feasibility and plan

## What we verified (and what we did not)

- **No official TikTok API reports another creator's LIVE status.** Searching for one turned up none; the TikTok developer
  products found are login, content posting and basic profile data. Third-party sources
  (e.g. tik.tools, Apify actors, the open-source `TikTok-Live-Connector` / `TikTokLive` libraries) say the same.
  *Caveat:* this came from web search of vendor and community pages, not a review of TikTok's current developer terms.
  Confirm against TikTok's documentation before committing to anything.
- **Third-party options exist but are not guaranteed.** Hosted APIs poll and can miss very short lives; open-source libraries
  read the same websocket a viewer would, are unofficial, and break when TikTok changes things. They may also conflict with
  TikTok's terms of service. Nothing in production should assume they keep working.
- **Detecting a LIVE is not permission to record it.** These are separate in the design: detection is a *provider*;
  recording is gated by the permission module.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Store | JSON file `storage/radar.json` (same approach as `database.json`) | One user, local-first; Postgres/Supabase adds infra with no Phase 1 benefit. Revisit when multi-user. |
| Queue/workers | Not yet. Redis is installed locally, BullMQ is not a dependency. Add it in Phase 2/3 when a worker exists. | "No unnecessary infrastructure". |
| Live status | `unknown` until a provider is configured. UI never shows a creator as live without a provider reporting it. | "Do not fabricate LIVE status". |
| Permissions | Single gate `can(creator, action, platform)` in `src/lib/radar/permissions.ts`. Missing, expired, revoked, out-of-scope or wrong-platform = blocked. Granting requires who + evidence. | Rights are core, auditable, and testable (`npm run test:radar`). |
| Avatars | Initials fallback + optional URL. We do not scrape TikTok profile images. | No reliance on unofficial access. |

## Phase status

1. **Creator management — built.** Add/remove/pause/resume, groups, language/category, search & filters, per-creator
   notification flag, permission records (scope, platforms, evidence, expiry, revocation, third-party notes) and an audit trail.
   API: `/api/radar/creators`, `/api/radar/creators/[id]`, `/api/radar/creators/[id]/permission`.
2. **Live detection — feasibility done, decision pending.** See `LIVE_RADAR_PHASE2_DECISION_REPORT.md`. Provider abstraction, permission gate and an experiment harness are built; no provider is integrated.
   Original plan: Needs a decision on a provider (see above). Plan: a `LiveStatusProvider` interface
   (`check(username) → live | offline | error`), a background worker with per-provider rate limits, backoff and health
   state, events written to the same audit/activity feed, then real-time push to the dashboard.
3. **Authorized recording — not started.** Recorder worker (FFmpeg/yt-dlp class tooling) that refuses to start unless
   `can(creator, 'recording')`; health checks, retry/resume, validation (duration, resolution, audio), registration in the Library.
4. **Content intelligence on recordings** — reuse the existing transcription/scoring pipeline; needs Luganda/Swahili
   transcription quality evaluation on real recordings first (see `experiments/`).
5. **Distribution** — YouTube Data API (OAuth), short-form publishing with approval; every publish checks `can(…, 'redistribution', platform)`.
6. **Mobile** — after 1–5 are stable.

## Open questions for you

- Which LIVE-status provider (if any) are you willing to use and pay for? That decides Phase 2.
- Do you have, or will you obtain, written permission from the creators you intend to record?
