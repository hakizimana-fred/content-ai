# Auto Studio — raw media to a finished short video

Open **Auto Studio** (top nav) → add photos/videos (and optional music) → describe the video → pick format/duration/style/audio → **CREATE**
→ preview → refine in plain English → **Export MP4**. No timeline. Everything runs locally and offline; no paid API.

## Pipeline (each stage reports real state in the UI)
`ingest (type sniffed from bytes, EXIF-aware) → analyse (OpenCV/ffmpeg) → understand instruction (rules, optional local LLM) → soundtrack → compose (beat-quantised) → render shots (cached) → transcribe (speech shots only) → join (xfade/acrossfade, one encode) → audio mix → finish`

| Piece | File |
|---|---|
| Photo/video analysis (sharpness, faces, saliency subject box, mouth motion, scenes) | `src/lib/auto/auto_analyze.py`, `analyze.ts` |
| Intent → style profile | `profiles.ts` |
| Soundtrack choice (selected → tray audio → library recommendation → generated) | `soundtrack.ts` |
| Tempo/beat detection for imported tracks | `tempo.ts` |
| Shot selection, order, trims, transitions on the beat | `compose.ts` |
| Photo motion (zoom, pan, Ken Burns, subject focus, layered) | `auto_motion.py` |
| Render + cache + audio pass | `render.ts`, `pipeline.ts` |
| Conversational refinement (edits the config, not the media) | `refine.ts` |
| API | `src/app/api/auto/*`, `src/app/api/studio/sound/{import,favourite}` |

Refinement only rebuilds what changed: shots and the assembly are cached by content hash, so a music change takes ~2 s and reuses the pictures.
Supported phrases: more cinematic/social/…; change / calmer / more energetic soundtrack; reduce/raise music; no music; smoother/punchier transitions;
bigger/smaller text; captions on/off; more engaging opening; remove the Nth/last scene; make it N seconds / shorter / longer; change the headline/closing message to "…"; another version; square/landscape/vertical.
Unrecognised wording is reported as not understood; nothing is changed.

## Sound Library (Studio → Sound Library)
Filter by category (16 moods incl. the spec's 14), energy, duration, favourites, search. Preview, favourite, download, generate an alternative, delete.
Import a licensed track: the licence text and commercial-use flag are required and stored exactly as entered ("unknown" is allowed); nothing is assumed commercially usable. Tempo is detected on import.

## Limits (honest)
- Analysis is classical CV: Haar frontal faces only; "active speaker" is a mouth-motion heuristic; subject box is saliency, not recognition.
- Tempo detection can pick a rhythmic multiple on polyrhythmic tracks (generated tracks use exact BPM).
- Captions need a transcribed speech shot (faster-whisper `base`, slow on CPU); photo-only videos have no captions. The e2e test runs without transcription, so caption rendering from a real transcript is not covered by an automated test.
- Headline/closing text uses only the words you type. Nothing is invented.
- Luganda/Swahili: transcription depends on the whisper model's language support; not verified here.
- Landscape photos in 9:16 often use the layered (fitted over blurred) layout instead of a crop, by design.
- Layered/animated shots cost CPU: ~a few seconds per shot on this 4-thread laptop. One render at a time.
- The Next dev server must be restarted if it was running before the `auto_projects` table was added.

## Tests
`npm run test:studio` (includes tempo, analyse, compose, refine) · `npm run test:auto:e2e` (3 photos + 1 MP4 → 15 s 1080×1920 video with audible mix).
