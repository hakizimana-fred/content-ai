# Live Radar — Phase 2 decision report

**Status:** for review. No provider has been purchased or integrated. **No prototype measurements exist yet**: the harness is built and
tested, but running it needs (a) a consenting test creator and (b) your approval of a specific provider to try. Every
number below is either quoted from a cited source or is arithmetic on a quoted number; anything I could not verify is marked **Unverified**.

> Not legal advice. The platform-terms section reports what the documents say; whether a given use is acceptable needs a lawyer who
> can read the *current* terms for the *jurisdictions involved* (Uganda, plus wherever TikTok's contracting entity and the provider sit).

---

## 1. Available technical approaches

| # | Approach | What it is |
|---|---|---|
| A | **Official TikTok APIs** | Login Kit, Content Posting, Display API, Research/Commercial Content APIs. |
| B | **Third-party hosted service** (EulerStream, Apify actors, similar) | A vendor sells "is X live" (and sometimes stream URLs, chat, gifts) over REST/WebSocket/webhook. |
| C | **Self-hosted unofficial library** (TikTok-Live-Connector, TikTokLive) | We run reverse-engineered client code that reads TikTok's internal Webcast data. |
| D | **Creator-authorized signal** | The consenting creator tells *us* when they start/stop (button, link, bot message, or their own tooling). No platform scraping. |
| E | **Creator-originated stream copy** | The creator's own streaming software (e.g. OBS / TikTok LIVE Studio, where their account is eligible) sends a copy to *our* ingest server. Authorized at the source. **Unverified here:** TikTok's eligibility rules for stream-key access. |
| F | **Creator upload of the replay** | Creator downloads their own LIVE replay from TikTok and uploads it. No detection, fully permitted, minutes-to-hours of delay. |

## 2. Official API limitations

- TikTok's developer overview lists Login & Identity, Share/Content Posting, Content Display, Research & Insights (Research API, Commercial Content API),
  Mini Games/Dramas, TikTok GO, plus Rate Limits and Webhooks as general resources. **It does not mention LIVE status, LIVE stream access, recording or LIVE events.**
  ([developers.tiktok.com/doc/overview](https://developers.tiktok.com/doc/overview))
- TikTok's "Events API" is an advertising-conversion product, not a LIVE feed. ([ads.tiktok.com](https://ads.tiktok.com/help/article/getting-started-events-api?lang=en))
- Research API: per search results it is limited to vetted academic/non-profit researchers in the US/EU with a stated daily cap and no commercial use. I could not open the eligibility page
  myself, so treat this as **Unverified**; either way it does not cover LIVE.
- I found **no evidence of an official LIVE partner program**, but absence in public docs is not proof. **Action for you:** ask TikTok's partner/developer team directly and get the answer in writing.

**Conclusion:** there is no documented, official way to learn that *another* creator went LIVE, nor to access their stream.

## 3. Provider comparison

Columns follow your checklist. "Unverified" = not established from a primary source in this investigation.

| | **B1. EulerStream** | **B2. Apify actors** (several authors) | **C. OSS library, self-hosted** | **D. Creator signal** | **E. Creator stream copy** |
|---|---|---|---|---|---|
| How it gets LIVE status | Not disclosed in its terms/pricing page. The OSS library it serves (signing service for TikTok-Live-Connector) is described as reverse-engineered. | Scrapers; each author's method is theirs. Unverified. | Reads TikTok's internal Webcast push service; README: *"not a production-ready API. It is a reverse engineering project."* | Creator tells us. | Creator's encoder sends it. |
| Official vs unofficial | Treat as **unofficial** until disclosed | **Unofficial** (scrapers) | **Unofficial**, "Unaffiliated with ByteDance" | n/a (consent-based) | n/a (consent-based) |
| Commercial use permitted? | Euler licenses use *"solely in connection with your own products, services, and internal business operations"* (§7.1); no resale (§7.2a). **Says nothing about TikTok's terms.** | Per-actor/Apify terms: Unverified | "Modified AGPL" per README body (sidebar says AGPL-3.0). **Copyleft implications for a hosted app: needs legal read.** | Yes (our own flow) | Yes (creator's choice) |
| Creator authorization supported | No concept of it | No | No | **Is** the authorization | **Is** the authorization |
| Uganda / target creators | **Unverified** (no regional claims found) | Unverified | Unverified | Works anywhere | Depends on creator's account eligibility (Unverified) |
| Pricing | Community $0 (1.5K req/day, 100 rooms/day, 25 sockets, 5 webhook alerts); Business 10K $50/mo (10K req/day, 1K rooms, 100 sockets, 50 alerts); 50K $100; 100K $150; 200K $250; add-ons $5–$50/mo. (Euler's pricing page; the GitHub README quotes a different free-tier number, so **re-verify**) | Pay-per-result, wildly different: ≈$0.30–$5.00 per 1,000 status checks across four actors (listing pages) | $0 + our hosting + whatever signing service it needs | Our dev time | Our ingest server + dev time |
| Detection reliability | **Unverified.** Only vendor claims. One vendor page admits detection is poll-based and can miss very short lives. | Unverified | Unverified; README warns TikTok can change the protocol without notice | Perfect *if the creator remembers*; human latency | High (stream is the signal) |
| Rate limits | Per plan (above); can change without notice (§8.1) | Per run/billing | Self-imposed; TikTok-side blocking risk | none | none |
| Historical reliability | **Unverified**; no public uptime history found. 99.95% is claimed only for a $25/mo "Enterprise Server Access" add-on; terms say "as is" (§6.1), no SLA | Unverified | Project links a BREAKING.md (not read); 7 open issues | n/a | n/a |
| LIVE start / end events | "Webhook LIVE alerts" exist; exact event types **unverified** | Polling per run | Polling (`waitUntilLive()` ≥30 s) or socket events | Start/end, human-timed | Stream start/stop |
| Stream access / recording | Not established | Some advertise "stream URLs" | `fetchRoomInfo()` returns an HLS pull URL (per README) | none | Yes (they send it) |
| Recording independently authorized? | **No.** Technical ability ≠ permission | No | No | n/a | **Yes**, at source |

## 4. Legal and platform-policy considerations

What the documents actually say (read in this session; versions matter):

- **TikTok Terms of Service.** The version I could fetch (the page showed 2019–2022 dates, so it may not be the current text) prohibits using *"automated scripts to collect information from or otherwise interact with the Services"* (US §5), and in the EEA/UK/CH version *"any automated system or software… to extract any data from the Service for commercial purposes"* (§7). It also frames the service as *"for private, non-commercial use"* (US §1). **Unverified:** the current text; re-read it before relying on any of this.
- **TikTok Developer Terms** (last modified 26 Dec 2025): limit use to the documented Developer Services; prohibit access *"not expressly authorized"* (III.3(r)), reverse engineering (III.3(a)), bypassing access restrictions (III.3(m)), and unauthorized robot/spider collection of user information (III.3(k)). They do not mention LIVE at all. These bind us **only if we are a registered developer**; the ToS bind account holders.
- **Creator consent does not fix platform terms.** A creator can authorize *us* to record/edit/redistribute *their* content. They cannot waive TikTok's rules about automated access to TikTok. Detection/recording via B or C may therefore be fine with the creator and still breach TikTok's terms.
- **Detection vs recording.** Even if detection were tolerated, recording is a distinct act: copying a stream, with music, guests and third-party material in it. Live Radar already separates these (`can()` per action, platform and expiry).
- **Practical consequence of a breach** (per secondary sources, not a lawyer): typically contract/account remedies (blocking, cease-and-desist, suit), not criminal. Sources disagree on US case law. This is a business risk to *price in*, not a reason it is "fine".
- **Open-source licence** (modified AGPL) and **vendor terms** (Euler §7.4: *you* are responsible for activity under your credentials) shift compliance burden onto us.
- **Data protection:** storing creator profiles, guests' voices and transcripts is personal data. Uganda's Data Protection and Privacy Act 2019 and, if any viewers/guests are in the EU/UK, GDPR need a lawyer's view. Not researched here.

## 5. Expected operating costs

Arithmetic on *quoted* prices; whether one "request" equals one status check on each vendor is **Unverified**.

Checks/month = creators × (86,400 ÷ interval seconds) × 30.

| Creators × interval | Checks/month | Apify @ $0.30/1k | Apify @ $5.00/1k | Euler (if REST-polled) |
|---|---|---|---|---|
| 20 × 5 min | 172,800 | ≈ $52 | ≈ $864 | 576/day → fits Community (1.5K/day) but **only 5 webhook alerts, 100 rooms/day** |
| 50 × 5 min | 432,000 | ≈ $130 | ≈ $2,160 | 14.4K/day → Business 50K ($100/mo) |
| 50 × 1 min | 2,160,000 | ≈ $648 | ≈ $10,800 | 72K/day → Business 100K ($150/mo) |
| 200 × 1 min | 8,640,000 | ≈ $2,592 | ≈ $43,200 | 288K/day → Enterprise (custom) |

Plus, for recording: storage and bandwidth (a 1080p livestream is on the order of 2–4 GB/hour; our largest source today is ~1.2 GB for 87 min), transcription compute, and engineering time to keep an unofficial integration working. Option D/E cost is development time and an ingest server, not per-check fees. **Hidden cost:** if a provider breaks (protocol change), detection silently degrades until fixed; the adapter treats schema drift as an *error*, not "offline", so it is at least visible.

## 6. Technical risks

1. **Fragility of non-official sources** (B/C): protocol changes without notice; vendor shutdown; CAPTCHA/anti-bot escalation.
2. **Platform enforcement** against accounts/IPs involved in automated access.
3. **Short lives are invisible to pollers** (a session shorter than the poll interval can be missed entirely); the evaluation flags these separately.
4. **False "offline"** from error handling: mitigated by design (errors ≠ offline).
5. **Regional coverage** (Uganda, Luganda/Swahili creators) is unknown for every provider.
6. **Compliance drift:** permissions expire or are revoked mid-stream. Mitigated: `authorize()` re-reads storage on every call and audits the outcome.
7. **AGPL** obligations if we embed or modify the OSS client.
8. **Single-operator JSON store** will not survive concurrent recorders; move to a real DB before Phase 3.

## 7. Recommended architecture (built where noted)

```
                ┌───────────────────────────┐
 providers  →   │  LiveDetectionProvider    │  detection only          [built: src/lib/radar/providers]
 (swappable)    │  (+ optional              │  declares dataSource, commercialUse,
                │   StreamAccessProvider)   │  platformTermsRisk – the compliance facts travel with the adapter
                └─────────────┬─────────────┘
                              │ DetectionResult | ProviderError(kind)   (errors are never "offline")
                              ▼
                      Monitoring worker        [Phase 2 build: per-provider interval, backoff, health state]
                              │ events → audit/activity feed
                              ▼
        authorize(creatorId, action, platform)  ← re-reads permission EVERY call, audits the result   [built: gate.ts]
              │                 │                 │
      stream access      recording          publishing
     (streamForRecording)  (Phase 3)        (Phase 5; also checks 'redistribution' + platform)
```

- Providers shipped: `none` (default: never reports live), `http-json` (generic, config-only, refuses to run unconfigured; declares its own compliance facts). A creator-signal provider (D) and an ingest receiver (E) are the first real Phase 2/3 candidates.
- Capabilities are separate by type: a provider with `streamAccess: false` cannot be asked for a stream; detection results never unlock recording.
- Measurement is first-class: `evaluate()` computes start/end latency, session recall, poll-level precision/recall, false-positive episodes, uptime, error kinds and stream availability from a log, and warns when the sample is too small to mean anything.
- Tests: `npm run test:radar` (permission logic, scoring maths, provider contract, gate incl. immediate revocation).

## 8. Prototype status and how to run it

**Built:** `scripts/radar-prototype.ts`, a detection-only experiment runner. It refuses to run unless the named creator has an *active* permission in Live Radar **and** a provider is explicitly configured. It records every poll and the creator's self-reported true start/end times, then `report` scores them. It never records or downloads a stream.

**Not done (needs you):**
- a named consenting test creator (ideally Ugandan, since coverage is the open question) with permission recorded in Live Radar;
- your approval to try one specific provider. The cheapest informative test is a free tier, detection only, ≥2 weeks, ≥10 genuine sessions at mixed times of day, including some very short ones.

```
node scripts/radar-prototype.ts poll   --creator <user> --name run1 --interval 30
node scripts/radar-prototype.ts truth  --name run1 start      # creator says "I'm live now"
node scripts/radar-prototype.ts truth  --name run1 end
node scripts/radar-prototype.ts report --name run1
```

**Pre-agreed pass bar (suggested; change it before the run, not after):** session recall ≥ 95%, median start latency ≤ 2× poll interval, zero false-positive episodes, provider error rate < 2%, on ≥10 sessions.

## 9. Go / no-go

| Decision | Recommendation |
|---|---|
| Build core product on third-party/unofficial detection **and recording of arbitrary creators** | **NO-GO.** Not documented as permitted, can break overnight, and recording rights would rest on a technical ability nobody authorized. |
| Phase 2 on a **consent-based** foundation (D + E + F) | **GO.** Permitted by construction, sustainable, and fits your "authorized creators" model. Costs dev time, not per-check fees. |
| Third-party **detection-only** as an optional, clearly-labelled add-on for creators who consented | **CONDITIONAL GO, after:** (1) a lawyer reads current TikTok terms for your use; (2) the 2-week prototype meets the pass bar for a Ugandan creator; (3) you accept the platform-terms risk in writing. Detection only; never wired to auto-record. |
| Self-hosted unofficial library in production | **NO-GO** (fragility + platform-terms + AGPL). Acceptable only as a throw-away measurement baseline if you approve it. |

**Next steps if you agree:** (1) ask TikTok in writing about any LIVE partner access; (2) you pick the test creator and approve one provider for the measurement; (3) I build the creator-signal provider and the monitoring worker (Phase 2) against the existing interface; (4) review results against the pass bar before any recording work.

## Sources

- TikTok developer overview — https://developers.tiktok.com/doc/overview
- TikTok Developer Terms of Service — https://www.tiktok.com/legal/page/global/tik-tok-developer-terms-of-service/en
- TikTok Terms of Service (version retrieved may be outdated) — https://www.tiktok.com/legal/page/global/terms-of-service/en
- TikTok on scraping — https://www.tiktok.com/privacy/blog/how-we-combat-scraping/en
- TikTok Research API — https://developers.tiktok.com/doc/research-api-specs-query-videos
- EulerStream pricing — https://www.eulerstream.com/pricing · terms — https://www.eulerstream.com/terms
- TikTok-Live-Connector (README) — https://github.com/zerodytrash/TikTok-Live-Connector
- Apify listings: https://apify.com/khadinakbar/tiktok-live-status-monitor · https://apify.com/neverempty/tiktok-live-status-monitor · https://apify.com/automation-lab/tiktok-live-room-stream-urls · https://apify.com/clover_folktale/tiktok-live-scraper
- Vendor commentary (commercial interest, treat with caution): https://tik.tools/ · https://dev.to/rngrow_26ac7d2e4c5dc10a00/there-is-no-official-tiktok-live-api-here-is-how-to-get-the-data-anyway-62n
