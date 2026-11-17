# Live Radar: automatic LIVE detection, setup and operations

## How it works

```
 server start ─ instrumentation.ts ─► monitor (in the Next.js server process)
                                         │  every second: which active creators are due?
                                         ▼
                      provider.check(username) ── real HTTP request to the configured provider
                                         │  answer (or failure)
                                         ▼
              transition.ts (pure state machine) ─► creator.live, LiveSession history, notifications
                                         │                       persisted to storage/radar.json
                                         ▼
                    event bus ─► /api/radar/events (SSE) ─► the page updates itself
```

- The **backend owns monitoring**. The browser only displays; closing it changes nothing.
- Adding a creator registers it immediately (default: monitored). Pause/resume persists.
- State survives restarts: on boot the monitor resumes from `storage/radar.json` and staggers the first checks.
- **Statuses:** `UNKNOWN` (never successfully checked) · `OFFLINE` · `LIVE` · `ERROR` (the last check *failed*; never treated as offline) · `PAUSED` · `CHECKING` (request in flight).
- **Ending a session** needs `RADAR_OFFLINE_CONFIRMATIONS` (default 2) consecutive offline answers. A single blip does not end it. If the provider fails for 30 minutes during a live session, the session is closed as *"contact lost, end unconfirmed"*.
- **Failures:** exponential back-off (capped at 10 min); `429` honours `Retry-After` and pauses all checks; unknown usernames (`404`) back off for 6 hours; bad credentials retry every 15 min and show a clear error.
- **Recording is separate.** On LIVE the system notifies you and snapshots whether recording is permitted. Nothing records yet (Phase 3); the recorder will have to call `authorize()` itself, which re-reads permission and audits the result.

## What is required before it detects anything real

Live Radar ships **without** a provider because TikTok has no official LIVE-status API (see `LIVE_RADAR_PHASE2_DECISION_REPORT.md`). You must supply:

| Variable | Meaning |
|---|---|
| `RADAR_HTTP_URL` | Provider endpoint containing `{username}` |
| `RADAR_HTTP_LIVE_PATH` | JSON path of the boolean "is live" field |
| `RADAR_HTTP_SOURCE` | `third-party-service` \| `unofficial-protocol` \| `official-api` |
| `RADAR_HTTP_API_KEY` (+ `_HEADER`) | Secret, sent as a header. Never commit it |
| `RADAR_ACKNOWLEDGE_PLATFORM_TERMS=yes` | Required for non-official sources. Your explicit acceptance of the platform-terms risk |

Copy `.env.example` to `.env.local`, fill it in, **restart the server** (`instrumentation.ts` runs once at start). The Radar page shows exactly which variable is missing.

The adapter is vendor-neutral: you need the vendor's endpoint and response shape from *their* documentation. (EulerStream's public docs list a "bulk live check" endpoint but I could not read its URL or response format, so I did not guess a preset.)

## Try the mechanism without TikTok

`scripts/radar-fixture-provider.ts` is a local stand-in that speaks the adapter format, so you can watch the full flow (detect → notify → end → history) with no account:

```
node scripts/radar-fixture-provider.ts
# .env.local: RADAR_HTTP_URL=http://127.0.0.1:4010/?user={username}  RADAR_HTTP_LIVE_PATH=data.isLive
#             RADAR_HTTP_SOURCE=third-party-service  RADAR_ACKNOWLEDGE_PLATFORM_TERMS=yes  RADAR_POLL_INTERVAL_S=5
curl 'localhost:4010/control?user=somename&mode=live&viewers=120'
```

This proves the pipeline. It does **not** prove detection against real TikTok.

## Tests

`npm run test:radar` runs: permissions, scoring, provider contract, the permission gate (incl. immediate revocation), the state machine (15 scenarios), and an end-to-end monitor test (add → auto-monitor → LIVE → notification → outage → recovery → offline → history, invalid username, rate limit, pause/resume, permission-gated recorder hook, restart recovery). Tests run in temp directories and never touch your `storage/`.

## Operational notes and limits

- **Cost:** one provider request per creator per interval. 50 creators at 60 s = 72,000 checks/day (see the report for vendor pricing). Raise `RADAR_POLL_INTERVAL_S` to cut cost; latency ≈ the interval, and a broadcast shorter than the interval can be missed.
- **Single process:** the monitor runs inside the Next.js server. Don't run two server instances against the same `storage/`. In `next dev`, the monitor restarts with the dev server. For production use `next start` under a process manager.
- **Storage:** JSON file, fine for one operator. Move to a database before concurrent recorders (Phase 3).
- **Browser/mobile notifications:** in-app + browser notifications work. Mobile push and email are not built.
