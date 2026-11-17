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

---

# Idea-to-Video and Mixed Media (generate videos from scratch)

Pick a **Creation mode** at the top of Auto Studio:
| Mode | Input | What happens |
|---|---|---|
| Idea-to-Video | a description only (no uploads) | every scene is generated: animated backgrounds, animated typography, charts, transitions, soundtrack |
| Image-to-Video / Video-to-Video | photos / footage | the original photo-motion and footage editor (above) |
| Mixed media | your media plus a description | your media wrapped in generated intro / chart / text / outro scenes |

## How scenes are made (no GPU, no model, no browser)
`src/lib/auto/scene_render.py` draws each scene frame by frame with numpy, OpenCV and Pillow and pipes raw frames to ffmpeg.
Backgrounds (aurora, neon grid, particles, waves, gradient, solid, or your own image/video) are computed at quarter resolution and
upscaled; text is rendered once into sprites and animated (words, letters, fade-up, scale, slide); charts are drawn per frame (counting
ring, bars, CTA button). The scene clips then go through the **same** join (xfade/acrossfade on the beat), audio mix (ducking, SFX,
loudness, ending) and content-hash cache as everything else, so a music-only change reuses every scene.

Scene kinds: intro, text, quote, product (bullets), infographic, outro, image, footage, abstract (text-free motion). Each has its own
config and can be edited (Scene text editor) or removed ("remove the second scene").

## Creative Director (`idea.ts`, deterministic, offline)
Keyword/pattern rules turn the instruction into scene structure, a look (palette, font, background style, animation) and scene text:
"futuristic / AI / neon" → dark navy + cyan + grid; "luxury / elegant" → black + gold + serif; "restaurant / energetic" → warm + bold;
African, ocean, nature, corporate and cinematic looks also exist; explicit colour words, "light background", "monospace" and
"typewriter" are honoured. An explicit music genre ("electronic background music") beats style words for the soundtrack choice.
**Nothing is invented**: on-screen text is only quoted phrases, the headline/closing fields, the subject phrase after "for …", style
words you wrote, `features: a, b, c`, `quote: "…" - name`, and numbers like "50% faster". With nothing to say, scenes are text-free and the
report says what to add. An automated test asserts every on-screen word appears in the prompt.

## Local creative asset library
Backgrounds, footage, photos, overlays (your files; licence **required**, commercial use yes/no/unknown, stored as entered), plus built-in
procedural backgrounds, motion-graphic scene templates and typography presets (original output of this software) and the Sound Library
music/SFX (read-only here). Tick assets to feature them as scenes. Works offline. Files live in `storage/studio/creative/`.

## Preview vs final
**Preview** renders at half size (e.g. 540×960) for fast iteration; **Final** renders 1080×1920 / 1920×1080 / 1080×1080 at 30 fps.
Intermediate scene clips are cached per size, so a preview never wastes a full-size render.

## Measured on this laptop (4 threads, no GPU, everything `nice`d)
30 s, 9:16, 8–10 scenes, generated electronic soundtrack:
| | first render | audio-only refine | scene-text refine |
|---|---|---|---|
| Preview 540×960 | ~33–36 s | ~4.6 s | scenes re-rendered only where text changed |
| Final 1080×1920 | ~76 s (scenes 39 s, join 23 s, audio 7 s) | ~7 s | |

Scene renderer alone: about 1.5× real time at 1080×1920, about 1× at preview size (a 3 s scene ≈ 4–5 s / ≈ 3 s).
Optimisations that mattered: quarter-resolution backgrounds, uint8 frames, dithering at low resolution, ROI-only compositing, ffmpeg `ultrafast`
for intermediates.

## Limits
- Not a diffusion video model: visuals are procedural motion graphics (typography, shapes, charts, gradients), not photoreal footage. Footage/photo
  scenes only appear if you add your own licensed assets.
- The keyword Director is rules, not language understanding. The optional local model (Creative Director v2, below) is a 1.5B CPU model: valid structure, but modest judgement. Unusual phrasing may be misread; edit scene text or refine.
- Remotion / HTML-CSS rendering was not used: it needs a headless browser rendering every frame, too heavy for this hardware. (SVG is not used either.)
- Fonts: six bundled fonts (`assets/fonts`, OFL / DejaVu licences) plus fonts you upload (.ttf/.otf, licence recorded). Missing glyphs fall back to the bundled chain; fonts are not subsetted or embedded in the MP4 (text is rasterised, so the output never depends on a viewer's fonts).
- Requires Pillow in `.venv` (`.venv/bin/python3 -m pip install pillow`); the rest of the Python side already needed OpenCV and numpy.
- Chart values and labels come only from numbers in your prompt (`50% faster`); a prompt with a duration like "30-second" is not treated as a statistic.

## Creative Director v2, copy approval, QC (evolution pass)
**Pipeline:** instruction → *Creative plan* (local model if installed, else keywords) → validate/clamp → provenance + claim check → **you approve suggested copy** → scenes → render → **automated QC**.

**Director.** `creative.ts` asks the local model (Qwen2.5-1.5B-Instruct Q4_K_M via the existing llama.cpp runtime, grammar-constrained JSON) for concept, audience, objective,
direction, mood, ending, soundtrack mood, SFX and a scene list. `validateModelPlan` whitelists every enum, clamps weights/lengths, strips markup, caps abstract scenes, drops
duplicates and drops anything it cannot trust. Facts (numbers, feature lists, quotes, steps) always come from your instruction via the keyword parser, never from the model.
Where your wording clearly names a direction ("luxury", "neon", "restaurant") or soundtrack mood ("calm"), your wording overrides the model, and the plan says so.
If the model is missing, too big for the hardware, slow, or returns invalid output, the keyword Director plans it and the reason is shown.
*Benchmark (this laptop, 5 prompts, 1.5B Q4):* 5/5 schema-valid, 27–46 s per plan (model resident memory was not re-measured in this pass; the Studio Model Manager shows it). Quality is uneven (it repeats scenes, invents template labels such as "No Text", truncates
lines, mismatches directions), which is why the validator and claim checker exist. Only the 1.5B model was benchmarked: the 0.5B was not downloaded (needs your approval) and the 3B is
research-licensed and over this machine's limits. A 0.5B would be faster but weaker; not evaluated.

**Six creative directions** (`directions.ts`): Kinetic pop, Editorial luxe, Tech grid, Cinematic film, Clean corporate, Organic calm (+ Modern gradient default). Each differs in palette,
type, background family, scene layouts, texture (grain/leaks/blur/letterbox), motif and transition feel, so output looks visibly different.

**Copy provenance** (`copy.ts`). Every text item is classified *by code*: `user` (found verbatim in your prompt / headline / CTA / approved edit), `suggested` (Director-written
headline, hook, CTA, step labels) or `label`. Suggested copy must pass the claim check: no numbers/prices/%/links not in your text, no claim words (best, free, award, organic, faster,
delivery, warranty, …) unless you used them, no invented proper nouns/places, max 9 words, no cut-off lines or template labels. Quotes, features and chart values can never be suggested.
Passing suggestions are **blocked from rendering until you approve** (tick, edit, or skip) in the Creative plan panel; unapproved lines are removed. The original prompt is stored with the plan.
Rendering without ever creating a plan uses only your own words (suggestions are dropped).

**Visual engine** (`scene_render.py`): 11 backgrounds (aurora, mesh, bokeh, contours, beams, grid, geo with parallax depth, particles, waves, gradient, solid), 5 motifs for scene-to-scene identity,
kinetic typography (slam, stacked, split, wave, per-letter, per-word), layouts (left-aligned, cards, big number, donuts, quote bar), ring/bar/donut/big-number charts, step diagrams, a phone showcase
mockup with perspective (your photo as the screen if given), image pan/zoom, film grain, light leaks, rack-focus blur, letterbox, vignette, adaptive exposure and a text scrim. Everything is NumPy/OpenCV/Pillow; no new dependency except Pillow.
Not done: true 3D, particles with physics, user-supplied illustration placement (illustration/texture assets are stored with licences but are not yet composited into scenes), light-leak video overlays.

**Pipeline.** Preview/final size, 24/30 fps, real per-frame progress from the renderer, cancellation that kills the renderer process (verified: no orphan process), cached scenes keyed by content + renderer
version + font (a crashed or cancelled render resumes from finished scenes), commercial-use switch that blocks assets without a commercial licence.

**QC** (`qc.ts`, `auto_qc.py`), stored as `qc_*.json` beside the render and shown in the UI: file readable, resolution, duration vs plan, frame rate, audio present and not silent, A/V length drift,
unintended black frames (ffmpeg blackdetect; intentional fades excluded), frozen segments (freezedetect), every shot visible at its time (sampled frames), transition midpoints, text inside safe areas
(the renderer writes every text box; 6% side, 12% bottom margin on tall formats), missing assets. It found two real bugs during development (near-black dark-palette backgrounds), fixed in the renderer
and guarded by `scripts/check-backgrounds.py`. It does **not** check text contrast/legibility, audio-visual beat alignment or content quality.

**Fonts & assets.** Upload .ttf/.otf (validated by loading it and rendering glyphs; preview specimen; licence required). Texture/illustration/overlay kinds accept images with licence records.
Unknown-licence assets are never silently treated as commercial.

**Hardware (measured).** 4 threads, ~19.8 GB RAM, no GPU. Local plan: 27–46 s (model unloaded after 2 min idle). Preview 30 s ≈ 35 s, final 1080×1920 30 s ≈ 2–2.5 min including QC.
The scene renderer peaked at 307–854 MB per scene at 1080×1920 (recorded in each scene's metadata; scenes render sequentially, so memory does not accumulate).

## 2D / 2.5D / real 3D engine and Visual Intelligence

Three depth techniques exist and are kept apart in code, in the plan UI (badge on each scene) and in the render metadata:

| Technique | What it is | Where | Plan badge |
|---|---|---|---|
| **2D** | flat layers, kinetic type, charts, diagrams, motifs, bokeh/aurora/etc. backgrounds | `scene_render.py` | 2D |
| **2.5D** | *simulated* depth: flat layers moved at different rates (layered skyline / mountains, photo cards with a blurred far layer and perspective tilt, the perspective phone mockup). **Not 3D.** | `scenery25`, `photo25d`, `showcase` | 2.5D |
| **Real 3D** | triangle meshes in world space, a perspective camera, back-face culling, depth sorting, lighting, planar shadow, mirror reflection, 3D particles | `render3d.py` | 3D |

The renderer reports what it did in each scene's `.meta.json` (`engine3d` with face count and measured ms/frame, or `null`; `depth25`). A 2.5D scene never reports `engine3d`; `test-auto-3d.ts` asserts that.

### The 3D engine (`src/lib/auto/render3d.py`)
No new dependency: NumPy + OpenCV (already installed). Capabilities: sphere, torus, torus-knot, revolved profiles (the perfume bottle), box, rounded box, cylinder, gem; **extruded text and extruded logos** (outline found with OpenCV, Delaunay-triangulated caps, side walls); a **GLB loader** (positions, indices, node transforms, base-colour factors; decimates above 30k faces); a terrain mesh; lighting = key light + ambient + specular + a procedural studio "environment" for metal/gloss + rim; planar shadow (convex hull of the projected footprint), mirrored floor reflection with fade; fog; textured quad by homography (phone screen).

**What it is not:** a painter's-algorithm rasteriser, not a z-buffer. It is right for single objects and well-separated objects; two interpenetrating meshes can sort wrongly. Shading is per quad, smoothed in screen space (approximate Gouraud), so low-poly objects look faceted (the torus knot especially). No texture mapping on meshes (GLB textures are ignored, flat base colours are used and the upload says so), no real shadows between objects, no global illumination, no true curved reflections. It looks like stylised product 3D, not a photoreal render.

**Why not OpenGL / Blender?** Not benchmarked: neither moderngl/PyOpenGL nor Blender is installed here, there is no usable GPU compute, and installing them needs downloads that were not approved. The software path was built first because a CPU fallback is required in any case. If a GPU path is added later it should sit behind the same `Renderer3D.render()` interface.

**Measured (this laptop, 4 threads, nice'd, 1080x1920 output; the 3D layer is rasterised at 720 px wide and resized):**
- raster only, 2.3k-face bottle with floor, shadow and reflection at 540x960: about 65 ms/frame
- inside a real scene (including particles, text and encode): 217-310 ms/frame for 2.9k-7.5k faces
- scene-renderer peak RSS for 3D scenes: 0.8-2.6 GB (a full-frame float layer for particles and compositing dominates; one scene at a time, so it fits, but this is the biggest memory use in the app)
- final 30 s 1080x1920 videos with 3D scenes: 233-316 s end to end including QC

### Visual Intelligence (`visual.ts`)
`pickDomain(prompt)` matches the wording to a domain (luxury/fragrance, fitness, money/education explainer, motivation, restaurant/food, app/software). A domain supplies a **direction, palette, intro treatment and filler treatments**, applied after the Director has planned the text. It converts the intro (e.g. a real 3D bottle, an extruded title) and converts or inserts text-free scenes (gem close-up, dumbbell, coin, phone, terrain flyover, city skyline). Repeated treatments are mirrored and re-posed. It never edits text, and never invents 3D where the domain has none: a restaurant with no photos stays 2D, a restaurant with photos gets 2.5D photo cards. An explicit background choice by the user disables the conversions. Every conversion is listed in the plan's `decided` notes.

This is keyword matching, not understanding. Wording outside the six domains gets the generic 2D look.

### 3D models
Upload kind **3D model (.glb)** in the library: validated by `glb_info.py` (parses, counts triangles, rejects corrupt files, renders a preview still) and needs a licence record like every asset. A selected model is placed automatically as the hero object (intro) and a second close-up; no render instructions are needed. Textures are not applied (flat base colours).

### Known limits of this pass
- No new music/SFX logic: the plan's SFX list and per-scene audio cues are still not applied; soundtrack selection is unchanged.
- 3D text and logo layers are not part of the text-box QC (clipping/collision) because they are not 2D text boxes; they are fitted to 80 % of the frame width by construction.
- Scene-level regenerate exists only through the existing text edits and the plan/approval flow; there is no per-scene "change technique" control yet.
- AI-assisted generation (local image/illustration/narration models) is not implemented and nothing claims it: no such model is installed.
- Only GLB (not separate .gltf + bin files).

## Brand Identity, style-composed soundtracks and the Sound Studio

**Brand profiles** reuse the Identity record (Studio → Identities). Added: secondary colour, tagline, `logoStyle` (opening, closing, corner mark, size, reveal, optional 3D). Logos: PNG, SVG, WebP, JPEG. SVGs containing scripts, event handlers, `foreignObject`, entities or external references are refused; safe SVGs are rasterised by the installed Chrome to a transparent PNG (the original SVG is kept). Colours are extracted by k-means over the logo's own visible pixels (`brand_extract.py`) into primary/secondary/accent; when a logo has too few colours the missing roles are derived and the UI says so. Everything is editable.

**Brand Director** (`brand.ts`, deterministic): derives the video palette from the brand (pale brands get a light video; text contrast is enforced), recolours 3D objects, puts the logo on the opening and closing scenes (hero-size when there is no title), adds the tagline to the ending, keeps the corner mark unless turned off, and records each decision in `plan.brand.decisions`. The logo image is never recoloured or stretched (one scale factor, LANCZOS); if its tone matches the background a neutral plate sits behind it. The 3D logo ending is an explicit opt-in. The plan is rebuilt when the brand is edited. `POST /api/auto/brand/preview` renders a real low-resolution frame from the video renderer with unsaved settings.

**Style-composed soundtracks** (`blend.ts`, `sonic-compose.ts`): ten styles act as ingredients. A character (dramatic / elegant / modern / minimal) picks the lead style; tempo compatibility, energy gaps (clashing styles become influences), per-layer entry points, arc, intro/outro and frequency carving are decided by the engine. Variations are different arrangements, not volume-stacked tracks; all output is real synthesis saved to the library. Legacy recipes render exactly as before (the new shaping is opt-in).

**Playback**: one shared `<audio>` (`PlayerProvider`) with a persistent bottom player; only one track plays at a time.

Limits: tempo detection for imported tracks is unchanged; the 3D logo suits simple solid logos; the brand preview is a still frame, not motion.
