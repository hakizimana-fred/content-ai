# Creative Studio — what exists, how it works, what it can't do yet

Offline-first creative production layered on the existing editor. The AI layer only produces a validated **editing plan**;
the existing ffmpeg pipeline renders. Phase 1 details and benchmarks: `docs/STUDIO_PHASE1.md`.

## Using it
- **Editor → AI Director** tab: describe the result (or refine the current plan). Rules apply what you state explicitly; the local
  model (if installed) fills the rest. **Apply to editor** fills Crop/Captions/Export settings; **Auto-produce** picks the best
  moment (or uses your selected range), applies the plan and renders through the normal export flow.
- **Studio** (top nav): **Sonic Studio** (generate/audition soundtracks and SFX, "Use" one in the current video),
  **Identities** (brand kits), **Models & Resources** (hardware profile, live monitor, model download/test/remove/select, licences).

## Pipeline
`instruction → rules (explicit cues, instant) → optional local LLM (schema-constrained JSON) → per-field salvage → validatePlan →
identity inheritance → productionFromPlan → existing cut route (cutVideoSegment + ASS captions/overlays) → sound-design post-pass`

| Piece | File |
|---|---|
| Plan schema + validator | `src/lib/studio/plan.ts` |
| Rule parser / Director | `rules.ts`, `director.ts` |
| Local LLM runtime + resource manager | `llama-runtime.ts`, `models.ts`, `service.ts` |
| DSP + procedural music/SFX | `dsp.ts`, `sonic.ts` |
| Mix (ducking, SFX placement, loudness, grade) | `mix.ts`, `audio-spec.ts` |
| Styles, identities, overlays | `styles.ts`, `identity.ts`, `overlay.ts` |
| Plan → render settings (reports applied/skipped) | `produce.ts` |
| Pacing / retiming | `pacing.ts` (time map), `retime.ts` (ffmpeg) |
| Keywords | `keywords.ts` |
| Storage | `storage/studio/` (`studio.db` SQLite, library/*.wav, logos/, audio-cache/), gitignored; `studio-db.ts`, `identity-store.ts`, `logo-store.ts` |

## Sound design (Phase 3)
- 16 categories (Cinematic … Social Media) and 10 SFX types, all **procedural** (oscillators, biquad filters, Schroeder reverb,
  delay, compression, distortion, envelopes). No neural audio model and no third-party samples, so licensing is simply "original output of
  this software, commercial use OK" (stored in each library item's sidecar JSON).
- Why not Stable Audio / ACE-Step: not evaluated on this hardware. A 2-core, 19 GB, no-GPU laptop with ~17 GB free disk is far below what they
  need, so the architecture uses procedural synthesis (the fallback your spec describes). They can be added as optional models later; their
  weight licences must be checked first.
- Natural-language requests ("elegant piano, deep bass, gradual build-up") are parsed into mood + layer overrides. It is keyword
  understanding, not a language model; unknown wording falls back to the default mood and says so ("Understood: …").
- Mixing: music is ducked under speech with a sidechain compressor (measured −13.8 dB under speech, returns in gaps; flat without ducking),
  fades, SFX placed at the intro/scene changes/ending, **two-pass linear loudness normalisation to −16 LUFS** (single-pass loudnorm made
  music surge in quiet gaps, so it is not used). Video is stream-copied unless a colour grade is requested.
- Measured here: 14 moods × 5 s in 8 s; a 45 s bed renders in roughly 5 s; mix pass 12.5 s on a 10 s 1080×1920 clip including grade re-encode.

## Limits that are real (not hidden)
Closed in the latest pass (each has a real-media test):
- **Silence removal and speed** (`pacing`): pauses over 0.7 s are shortened (leading/trailing silence removed), speed 0.9-1.25x. The segment is retimed
  first, then captions, face-track keyframes, title/end cards and sound all follow the same time map so nothing drifts. Costs one extra encode.
  A failure falls back to the plain cut and says so in the clip report.
- **1:1 and 4:5 output**: for landscape sources, both crop and blur layouts (1080x1080, 1080x1350). A source that is already portrait is left as is.
- **Keyword highlighting**: numbers, mid-sentence names, strong/emotive words and topical repeats (English plus a small Swahili list) are coloured and
  enlarged for the whole clip, independent of the spoken-word highlight. Heuristic, not semantic: it can miss or over-pick; filler never qualifies.
- **Logo images**: PNG/JPEG/WebP up to 2 MB per identity, type checked from the file's bytes, drawn at the brand corner (replaces the text mark there).
- **Offline**: the whole `npm run test:studio` suite, the real-render e2e and the real local-model planner all pass inside a network-less Linux
  namespace (`unshare -rn`, internet verified unreachable). The only network use is the explicit model download button.
- **Storage**: Studio metadata (identities, sound library index, settings) is SQLite (`storage/studio/studio.db`, Node built-in `node:sqlite`, no
  dependency). Legacy JSON files are imported once and kept as `*.migrated`. Audio files stay on disk; the existing `database.json` is untouched.
- **Models**: the 0.5B entry now has a verified source URL, SHA-256 and Apache-2.0 card tag (checked 2026-11-17). The 3B is `qwen-research` (not
  Apache), blocked for commercial use and by hardware tier, with no download registered. Licence checks read the model card tag only; read the full
  LICENSE text before shipping.
- **Planner speed**: the model is asked only for fields the rules did not decide (smaller JSON, fewer tokens); a typical plan dropped from ~30 s to ~18 s.

Still not done:
- **Audio-driven transition sync** beyond scene-change cues, and **per-section partial re-render** (a refinement re-renders the clip; only the plan edit is partial).
- **Keyword highlighting is ignored with karaoke-style captions** (the animation already colours words as they are spoken).
- The speed range is 0.9-1.25x by plan validation; the retimer itself supports 0.5-2x.
- Speaker tracking needs OpenCV in `.venv` (existing feature). Without it, framing falls back to centre and says so.
- Plans from the 1.5B model alone are unreliable; rules override it for anything you state explicitly, and it sometimes picks a format you did not ask
  for (visible in the plan chips). Vague refinements may produce no change (the UI says so).
- `produce.ts` returns an `applied` / `skipped` list for every plan, shown in the Director panel.

## Tests
`npm run test:studio` — unit/integration (plan, rules, pruned schema, SQLite store + migration, DSP/sonic for all 14 moods, real-ffmpeg mixing incl. ducking proof, identities, overlays, mapper, pacing maths, real silence removal/speed, 1:1/4:5 canvases, keywords, logos with pixel checks).
`npm run test:studio:e2e` — real ffmpeg + libass: overlays visible in the frame, sound pass, grade (≈20 s on this laptop, peak 76 °C).
`node scripts/studio-live.ts` — real local model against the spec's prompts.
