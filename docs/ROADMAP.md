# Content Intelligence — Architecture Map & Roadmap

## Current architecture (Next.js 16 monolith)
| Layer | Where | State |
|---|---|---|
| Ingestion | `lib/ingestion-service.ts`, `lib/youtube.ts`, `api/video/{upload,youtube}` | upload + yt-dlp, SSE progress. Reusable. |
| Cutting/production | `lib/ffmpeg.ts`, `api/video/cut` | cut, 9:16 blur-pad, multi-segment. Reusable. No subtitle burn-in / speaker framing yet. |
| Persistence | `lib/db.ts` → `storage/database.json` | Single JSON file, sync writes. **Limitation**: no concurrency safety; fine for 1 user. |
| ASR | `intelligence/transcribe.py` (faster-whisper) | word timestamps, marker-based sw/lg detection. **Weak for Luganda/Kinyarwanda** (see below). |
| Attention scoring | `intelligence/attention-scorer.ts` | audio-only (LUFS + silence) + **new** confidence-gated text fusion. |
| Experiments | `scripts/eval.ts`, `intelligence/evaluation.ts` | **new** uniform/random/acoustic/hybrid benchmark. |
| UI | `app/page.tsx`, `components/*` | editor + intelligence panel. Not yet the 8-workspace command center. |

## Limitations found
1. Scoring ignored meaning (loud ≠ interesting). Addressed in part by text features.
2. No ground truth, so no evidence the scorer beats uniform cutting. Harness added; **labels are needed from you**.
3. Whisper `base` output for the Luganda/Swahili sample is noise (reliability 0.08). Text scoring is gated on this.
4. Heuristic marker lists classify language per file, not per segment, so code-switching is not really handled.
5. Reports are cached per source; adding a transcript later does not re-score unless `forceReanalyze`.
6. Analysis runs in-process in API routes: no queue/retry. Redis/BullMQ and Postgres are not introduced yet (deliberately).

## Roadmap (incremental)
- **M1 (now)**: label 20+ videos, run `npm run eval`, tune weights against recall@k. Beat uniform with statistical honesty.
- **M2 ASR for African languages**: benchmark `small`/`medium`/`large-v3` and Swahili/Luganda fine-tunes (e.g. community Whisper fine-tunes, MMS) on a labelled WER set; per-segment language ID for code-switching.
- **M3 Conversation structure**: speaker diarization (pyannote/ECAPA), Q&A/interruption/laughter events, topic segmentation (TextTiling-style on embeddings).
- **M4 Clip construction + production**: burned word-highlight subtitles from word timestamps, face-tracked 9:16 (OpenCV), hook overlays.
- **M5 Human approval + rights metadata**: approval queue, per-source license/permission record (required before any distribution).
- **M6 Distribution & learning**: official APIs, scheduling, metrics ingest; ranking model (LightGBM) with account-size/time normalisation. Needs M1 labels as the seed dataset.
- **Infra, when pain appears**: Postgres + BullMQ at M5/M6. Live Radar after M5 (detection separate from recording permission).
