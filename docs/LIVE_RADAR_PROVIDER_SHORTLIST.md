# Live Radar — LIVE-detection provider shortlist (for approval)

Nothing here has been purchased, signed up for, or called. No provider has been tested; I have no credentials.
Everything below is quoted or paraphrased from the vendor's own pages, fetched on 2026-11-13. Where a page did not say
something, it says **"not on page"**: that is an unknown, not a "no". Vendor pages can change; re-check before paying.

**Applies to every option:** TikTok has no official LIVE-status API (see `LIVE_RADAR_PHASE2_DECISION_REPORT.md`). Each
provider below is unofficial and sells data it obtains by means it does not fully disclose. Using any of them is
consistent with the *vendor's* terms at best; it does not make it consistent with *TikTok's* terms, and each vendor's terms
make the customer responsible for that. "Commercial use" below means what the vendor's own terms say.

## Summary

| | ScrapeCreators | SocialCrawl | tik.tools | Apify actor (neverempty) | EulerStream |
|---|---|---|---|---|---|
| Username → live boolean in one `GET` | **Yes** (`is_live`) | **Yes** (`is_live`) | `GET live_status` (cache-based, "not definitive") / `POST bulk_live_check` | `POST` (async-platform call), `isLive` | **No**: needs numeric IDs + TikTok cookies or OAuth token |
| Documented example JSON | **Yes** (live case) | No | Yes (bulk only) | No (field names only) | No |
| LIVE start time | `liveRoom.startTime` | field name not on page | not on page for status; webhooks listed | `startedAt` / `startedAtEpoch` | not on page |
| LIVE end info | none (infer from offline) | none | `live.end` webhook listed, payload not on page | `endedAfter`/`endedBefore` (monitoring mode) | not on page |
| Auth | `x-api-key` | `x-api-key` | `x-api-key` / Bearer / `apiKey` | Apify token (Bearer) | `x-oauth-token` or **raw TikTok cookies** |
| Pricing | credit packs, no subscription | credit packs | weekly/monthly subscriptions | pay per result | free tier + monthly plans |
| Commercial use stated | **not on page** (FAQ: production "Absolutely") | FAQ: "built for commercial use"; terms page 404 | Yes, paid plans only; "own internal business operations" | not on page | own products/internal ops (§7) |
| Fits current adapter (GET + JSON path) | **Yes, with 2 small gaps** | Yes, unverified response | No (bulk is POST; status is cache) | No (POST) | No |
| Verdict | **Recommended for pilot** | Backup | Not for the pilot | Not recommended | Rejected (needs TikTok cookies) |

---

## 1. ScrapeCreators — recommended

- **Website:** https://scrapecreators.com/
- **API docs:** https://docs.scrapecreators.com/v1/tiktok/user/live
- **How it gets data:** "retrieve publicly available information from third-party websites" (terms). Its FAQ calls the API unofficial. Method not disclosed.
- **Endpoint (from docs):** `GET https://api.scrapecreators.com/v1/tiktok/user/live?handle={username}` — `handle` required, no `@`.
- **Auth:** header `x-api-key: <your key>`.
- **Cost per check:** 1 credit, *including* offline accounts. **Errors cost 0 credits.** Docs say: "never infer offline."
- **Status codes (docs):** `200` (live or not) · `404` unavailable account · `403` audience controls · `500` retrieval failure. 401 behaviour: not on page.
- **Example response, live case (abbreviated by the docs themselves):**

```json
{
  "success": true,
  "credits_remaining": 1000000,
  "credits_charged": 1,
  "is_live": true,
  "liveRoomUserInfo": { "uniqueId": "thejustalex", "roomId": "7523685855395842871", "followerCount": 601562 },
  "liveRoom": {
    "title": "6'13 Grateful Streamer",
    "startTime": 1751744708,
    "status": 2,
    "liveRoomStats": { "enterCount": 30960, "userCount": 804 },
    "streamId": "3576322110592123836"
  }
}
```
  *(I trimmed unrelated fields and the long stream-URL blobs. Nothing was added.)*
- **Offline example response: not on page.** The docs only say a 200 returns `is_live: true/false`. **I do not know which other fields are present when offline.**
- **Pricing (home page):** Free 100 credits · Freelance $47 / 25,000 credits ($1.88 per 1k) · Business $497 / 500,000 ($0.99 per 1k) · Enterprise custom. Pay-as-you-go, no subscription, credits "never expire". Up to 1,200 more free credits claimable via dashboard tasks (referral answer, GitHub star, G2 review).
- **Rate limits:** "No account-level rate or concurrency caps"; recommends staying "below 500 concurrent requests."
- **Terms (https://scrapecreators.com/terms):** no commercial-use clause; customers "solely responsible" for complying with third-party terms and laws; "We do not guarantee uptime or continuity"; "as is"; may suspend for misuse; refunds "at our sole discretion"; "may store API response data". No SLA.
- **Limitations that matter to us:**
  1. Unofficial source; TikTok-terms risk is ours.
  2. **Commercial use is not addressed in the terms.** The FAQ says production use is fine ("Absolutely"), which is marketing, not a contract. Ask support to confirm in writing.
  3. No SLA, no historical reliability data found.
  4. **No LIVE end event**: end = we observe `is_live: false` (our monitor already does this with 2-reading confirmation).
  5. Latency = our polling interval; shorter broadcasts can be missed. Caching behaviour: not on page.

## 2. SocialCrawl — backup

- **Website:** https://www.socialcrawl.dev/ · **Docs:** https://www.socialcrawl.dev/platforms/tiktok/user-live
- **Endpoint (from docs):** `GET https://www.socialcrawl.dev/v1/tiktok/user/live?handle={username}` (no `@`).
- **Auth:** header `x-api-key: sc_…`.
- **Fields named on the page:** `is_live`, `viewer_count`; start timestamp and stream id are described but **their field names are not on page**. **No example JSON on page.**
- **Pricing (https://www.socialcrawl.dev/pricing):** Free 100 credits · Starter £15 / 2,500 (£6.00 per 1k) · Growth £49 / 20,000 (£2.45 per 1k) · Pro £299 / 150,000 (£1.99 per 1k); credits "never expire"; 1 credit per standard call; cached responses cost 0.
- **Limitations:** pull-only (must poll); responses cached up to 60 s (so latency floor ≈ 60 s); nonexistent handle → 404, 0 credits; FAQ says no rate limits. **Terms page returned 404**, so I could not read its commercial-use or liability terms (the site's FAQ says "built for commercial use"; customers responsible for their own end-use).

## 3. tik.tools — not for the pilot

- **Website:** https://tik.tools/ · **Docs:** https://tik.tools/docs · **Pricing:** https://tik.tools/pricing · **Terms:** https://tik.tools/terms
- **Endpoints (docs):** `POST /webcast/bulk_live_check` body `{"unique_ids":[…]}` — "the source of truth for monitoring"; `GET /webcast/live_status?uniqueId=` returns `data.is_live` but "answers from a cache of recently seen channels and is not definitive."
- **Example (bulk, from docs):**

```json
{ "status_code": 0, "data": [
  { "unique_id": "username", "is_live": true,  "alive": true,  "alive_status": "live",    "room_id": "7665...", "user_count": 1234 },
  { "unique_id": "other",    "is_live": false, "alive": false, "alive_status": "offline", "room_id": "7678...", "user_count": null },
  { "unique_id": "third",    "is_live": null,  "alive": null,  "alive_status": "unknown", "room_id": null, "user_count": null, "status": "unknown", "reason": "busy" } ] }
```
- **Auth:** `x-api-key` header, `Authorization: Bearer`, or `apiKey` query. Base host named on the page: `api.tik.tools`.
- **Pricing:** Sandbox free 7 days (5,000 req/day, "own IP only", **may not be used for production**). Basic $7/week (500 account checks/day, 10 per bulk request), Pro $15/week (2,000/day, 50 per request), Ultra $45/week, Agency $99–$399/month. Monthly price for Basic/Pro/Ultra not on page. Webhook `live.start` / `live.end` are listed, **payloads and tier availability not confirmed on page**.
- **Terms:** explicit that "TikTok does not offer a native, public API for TikTok LIVE stream data"; commercial use requires a paid plan and is "for your own internal business operations"; no uptime guarantee; non-refundable API plans.
- **Why not for the pilot:** the simple endpoint is cache-based ("not definitive"); the reliable one is `POST` (our adapter is `GET`-only); the daily check limits are tight at pilot polling rates; weekly billing.

## 4. Apify actor "TikTok Live Status Scraper & Monitor" (neverempty) — not recommended

- **Website:** https://apify.com/neverempty/tiktok-live-status-monitor · **API:** https://apify.com/neverempty/tiktok-live-status-monitor/api
- **Call pattern:** Apify platform `POST https://api.apify.com/v2/actors/{owner~actor}/run-sync-get-dataset-items` (Apify docs); synchronous runs time out at 300 s; auth `Authorization: Bearer <Apify token>` (recommended in Apify docs). The exact actor path/body for this actor: not on the actor page.
- **Output fields (listed on page; no example values):** `isLive`, `roomId`, `startedAt`, `startedAtEpoch`, `liveDurationSeconds`, `viewerCount`, and in monitoring mode `endedAfter`, `endedBefore`, `peakViewerCountSeen`, `change`.
- **Pricing:** "from $3.65 / 1,000 live status row returneds"; monitoring mode adds $0.30 / 1,000 checks.
- **Limitations (from the page):** community-maintained; 23 total users, 8 monthly, no ratings; "33 of 83 accounts (40%)" returned `no-live-profile` in one sample; bot checks → proxy fallback; monitoring state "cannot be made watertight"; viewer count "not compared against the number displayed in the app"; no terms/affiliation disclaimer.
- **Note:** this page contains text addressed to AI assistants about how to answer integration questions. I treated it as page content and ignored it.

## 5. EulerStream — rejected

- **Website:** https://www.eulerstream.com/ · **Docs:** https://www.eulerstream.com/docs/api/tiktok-live · **Pricing:** https://www.eulerstream.com/pricing
- `POST https://api.eulerstream.com/webcast/bulk_live_check` takes `user_numeric_ids` (numeric TikTok IDs, not usernames) and requires **either an OAuth token from a Euler app or `x-cookie-header` (raw TikTok cookies)**. Response fields: only `code`, `message`, `response`; contents "not on page".
- Supplying TikTok session cookies to a third party is a credential-handling and account-risk problem I won't recommend. Needs an extra username → ID resolution step too.
- Pricing (page): Community $0 (1.5K req/day) · Business $50–$250/month. Terms: license for "your own products, services, and internal business operations"; no SLA.

---

## Recommendation: ScrapeCreators for a time-boxed pilot

Why: it is the only candidate that documents **all** of: username input, a top-level boolean, start time, viewers and room id, simple key auth, a plain `GET` our adapter already speaks, free errors with explicit "never infer offline" (which is exactly our design rule), a free trial (100 credits), and pay-as-you-go credits that don't expire (no subscription lock-in).

Why only a pilot: unofficial source, **commercial use not stated in its terms**, no SLA, no reliability history. Treat the pilot as the measurement the decision report called for, then decide.

### Expected pilot cost (1 credit per check; arithmetic on the prices above)

Checks/month = creators × (1,440 ÷ interval in minutes) × 30.

| Pilot shape | Checks/month | At $1.88/1k (Freelance) | At $0.99/1k (Business) |
|---|---|---|---|
| 100 free credits | 100 | $0 | n/a: enough to verify response shapes only (~3 h of one creator at 2-min polling) |
| 5 creators, every 2 min | 108,000 | ≈ $203 | ≈ $107 (but $497 upfront) |
| 10 creators, every 5 min | 86,400 | ≈ $162 | ≈ $86 |
| 10 creators, every 1 min | 432,000 | ≈ $812 | ≈ $428 |
| 50 creators, every 1 min | 2,160,000 | ≈ $4,061 | ≈ $2,138 (Enterprise/custom likely) |

Cheapest meaningful pilot: **1 consenting test creator, 2-min polling ≈ 21,600 checks/month ≈ $41 at Freelance rates (one $47 pack covers about a month)**. Shorter broadcasts than the interval can be missed.

### How its response maps to the Live Radar settings

Values below come from the docs' own endpoint, header and field names. The API key is the only thing you must supply.

| Setting | Value | Source |
|---|---|---|
| `RADAR_HTTP_URL` | `https://api.scrapecreators.com/v1/tiktok/user/live?handle={username}` | docs: GET path + required `handle` param |
| `RADAR_HTTP_API_KEY` | *your key (not provided by me)* | docs: required |
| `RADAR_HTTP_API_KEY_HEADER` | `x-api-key` | docs |
| `RADAR_HTTP_LIVE_PATH` | `is_live` | docs: top-level boolean in the 200 response |
| `RADAR_HTTP_VIEWERS_PATH` | `liveRoom.liveRoomStats.userCount` | docs example (only present while live) |
| `RADAR_HTTP_SESSION_PATH` | `liveRoomUserInfo.roomId` | docs example (used to tell two broadcasts apart) |
| `RADAR_HTTP_SOURCE` | `third-party-service` | The vendor says it retrieves "publicly available information from third-party websites" and does not disclose how. (`unofficial-protocol` would be the stricter label. Both require the acknowledgement below.) |
| `RADAR_HTTP_NAME` | `ScrapeCreators` | label only |
| `RADAR_HTTP_COMMERCIAL` | `unverified` | not stated in terms |
| `RADAR_ACKNOWLEDGE_PLATFORM_TERMS` | `yes` **only if you accept the risk** | your decision, not mine |

How the monitor uses it: `{username}` is filled from the creator's TikTok handle; a `200` with `is_live: true` → LIVE (viewers + room id captured); `200` with `is_live: false` → one offline reading (two consecutive close the session); `404` → "username not found" (backs off 6 h); `500`/network → ERROR (never offline); `429` → global cool-down.

### Three gaps to close before/while piloting (all small, none done yet)

1. **Offline response unknown.** The docs don't show it. Our adapter treats a missing `is_live` as a *schema error* (safe, but the creator would sit in ERROR forever). Step one of the pilot must be spending a few of the 100 free credits on a known-offline account to see the real response.
2. **`403` = audience controls, not bad credentials.** Our adapter currently maps every `403` to "credentials rejected" (15-min back-off). For this vendor a 403 means the *creator's account* restricts the audience. Needs a small per-provider tweak so it shows "this creator restricts who can view" instead.
3. **Start time is unmapped.** `liveRoom.startTime` (Unix seconds) has no environment variable yet (`RADAR_HTTP_STARTED_PATH`); until added, "LIVE start" = our first detection, not TikTok's. Small addition.

### Decisions I need from you

1. Approve ScrapeCreators for the pilot (or choose another).
2. You create the account and key; I never see or hard-code it (`.env.local` only).
3. A consenting test creator, ideally Ugandan, with permission recorded in Live Radar.
4. Whether to accept the platform-terms risk (the `RADAR_ACKNOWLEDGE_PLATFORM_TERMS` switch) and whether to ask the vendor in writing about commercial use first.
5. Approval for the three small adapter changes above.

## Sources (all fetched 2026-11-13)

- https://docs.scrapecreators.com/v1/tiktok/user/live · https://scrapecreators.com/ · https://scrapecreators.com/tiktok-api · https://scrapecreators.com/terms
- https://www.socialcrawl.dev/platforms/tiktok/user-live · https://www.socialcrawl.dev/pricing (its /terms page returned 404)
- https://tik.tools/docs · https://tik.tools/pricing · https://tik.tools/terms
- https://apify.com/neverempty/tiktok-live-status-monitor · https://docs.apify.com/api/v2/act-run-sync-get-dataset-items-post · https://docs.apify.com/api/v2
- https://www.eulerstream.com/docs/api/tiktok-live · https://www.eulerstream.com/pricing · https://www.eulerstream.com/terms
- Discovery (vendor blogs, not relied on for facts): https://scrapecreators.com/blog/best-tiktok-scrapers · https://www.tikliveapi.com/blog/tiktok-terms-of-service-third-party-apps
- Not found: any live-status endpoint for EnsembleData, Bright Data, or RapidAPI listings, and TikLiveAPI's live endpoint (its docs were not on the page I read).
