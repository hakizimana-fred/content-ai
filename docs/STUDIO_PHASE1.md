# Creative Studio — Phase 1 (hardware, models, Creative Director)

## Machine profile (dev laptop)
Intel i7-6600U (2 cores / 4 threads, AVX2, no AVX-512), 19 GB RAM (~10 GB free typical), Intel HD 520 (no CUDA), NVMe disk.
Classified **low-resource**: model RAM budget ~7 GB, 3 inference threads, GPU inference off.

## Architecture
- `src/lib/studio/hardware.ts` — detection + tier + RAM budget.
- `src/lib/studio/models.ts` — model catalog (size, RAM, tier, license, commercial flag) and `ResourceManager`
  (one resident model, serial queue, RAM/tier/license gates, idle unload).
- `src/lib/studio/plan.ts` — strict editing-plan schema/validator. Models never touch media; only validated plans execute.
- `src/lib/studio/rules.ts` — deterministic parser for explicit cues. Always wins over model output.
- `src/lib/studio/director.ts` — rules → optional model (schema-constrained) → per-field salvage → validation → rules fallback.
- `src/lib/studio/llama-runtime.ts` — llama.cpp `llama-server` child process, 127.0.0.1 only, `nice -n 10`, killed on exit.
- `POST/GET /api/studio/director`, `GET /api/studio/hardware`.

## Installed locally (outside the repo, `~/.local/share/content-ai/`)
- llama.cpp (MIT) built CPU-only with `-j2` under a thermal guard (pause >85C). cmake installed into `.venv` (no sudo).
- Qwen2.5-1.5B-Instruct Q4_K_M GGUF, 1,117,320,736 bytes, SHA-256 verified against the Hugging Face header
  (`6a1a2eb6…9407e`). License: Apache-2.0 per the model card (tag read 2026-11-17; full LICENSE text not reviewed).

## Measurements (this machine, 3 threads, nice 10, ctx 2048)
| Metric | Result |
|---|---|
| Model load to ready | 4.2 s |
| RAM (RSS) | 1.83 GB idle, 1.86 GB after a request |
| Prompt processing | ~23 tok/s |
| Generation | ~6.1 tok/s |
| Fresh plan via model | 18–46 s (varies with prompt length) |
| Rule-only refinement | 2–4 ms, no model |
| Vague refinement via model | ~15–30 s |
| CPU package temperature | 74–75 °C under load, no thermal pauses |

## Findings
- Unconstrained, the 1.5B model misreads explicit cues (TikTok → landscape, suspense → cinematic, malformed `ending`).
  Hence rules-first: stated cues are authoritative, the model only fills unstated choices, invalid fields are dropped one by one.
- Vague refinements ("more like a thriller trailer") can return an unchanged plan; the director now warns instead of
  pretending a change happened.
- Not yet tested: offline mode with the network disconnected (nothing in this path makes network calls; confirm formally in Phase 2 acceptance).
- Not implemented yet: UI, plan execution through ffmpeg (Phase 2), sound design (Phase 3), identities (Phase 4).

## Commands
`npm run test:studio` (unit, fake model) · `node scripts/studio-live.ts` (real model, ~2 min on this laptop).
