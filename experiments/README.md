# Moment-detection experiments

Milestone 1: prove the engine finds good moments better than uniform or random cutting.

## 1. Label ground truth
Watch a video, note the intervals you would genuinely publish. Aim for 3-8 per hour, from
**at least 20 videos** across languages/formats before trusting any difference.

## 2. Manifest (`experiments/manifest.json`)
```json
{ "videos": [
  { "id": "luganda_talkshow_1", "path": "../storage/uploads/x.mp4",
    "transcript": "../storage/transcripts/x.json",
    "labels": [ { "start": 312.0, "end": 351.5 }, { "start": 1204, "end": 1250 } ] }
] }
```
## 3. Run
`npm run eval -- experiments/manifest.json --k 5 --iou 0.3`   (or `npm run eval -- --selftest`)

Strategies: `uniform` (evenly spaced), `random` (200-seed mean), `acoustic` (loudness+silence),
`hybrid` (acoustic + confidence-gated text). Reported: recall@k, precision, mean best IoU, and
per-video wins/losses vs uniform.

## Caveats
- `--selftest` data is synthetic and easy; it only validates the harness.
- Whisper `base` on Luganda/Kinyarwanda is often gibberish. Text features are weighted by
  `transcriptReliability`, so hybrid ~= acoustic until ASR improves for those languages.
