import crypto from 'node:crypto';
import { audioFile, getItem, listEntries, type LibraryEntry } from '../studio/library.ts';
import { musicBpm, SOUND_LICENSE, type Mood } from '../studio/sonic.ts';
import { assetPath } from './store.ts';
import type { AutoProject } from './types.ts';
import { STYLE_PROFILES, type Intent } from './profiles.ts';

export interface Soundtrack {
  source: 'library' | 'tray' | 'generated' | 'original' | 'none';
  file?: string; mood: Exclude<Mood, 'none'> | null; seed: number | null; intensity: 'low' | 'medium' | 'high';
  bpm: number | null; beatOffset: number; label: string; license: string; commercialOk: boolean | null; reason: string; libraryId?: string;
}

/** Moods that sit near each other, for recommendations when no exact match exists. */
const RELATED: Record<string, string[]> = {
  advertising: ['social', 'corporate', 'electronic', 'technology'], social: ['advertising', 'electronic', 'comedy'], african_fusion: ['advertising', 'social'], luxury: ['minimal', 'emotional', 'cinematic'],
  travel: ['inspirational', 'minimal', 'documentary', 'cinematic'], emotional: ['luxury', 'minimal', 'cinematic'], cinematic: ['suspense', 'documentary', 'emotional'], documentary: ['minimal', 'cinematic'],
  corporate: ['technology', 'advertising', 'inspirational'], technology: ['electronic', 'corporate'], electronic: ['technology', 'social'], inspirational: ['corporate', 'travel'], suspense: ['cinematic'],
  comedy: ['social'], minimal: ['luxury', 'documentary'], news_editorial: ['corporate'],
};
export interface Recommendation { entry: LibraryEntry; score: number; reasons: string[] }

export function recommend(intent: Pick<Intent, 'mood' | 'intensity'>, seconds: number, entries: LibraryEntry[], limit = 6): Recommendation[] {
  const want = intent.mood, wantEnergy = intent.intensity;
  const out: Recommendation[] = [];
  for (const e of entries) {
    if (e.kind !== 'music') continue; const reasons: string[] = []; let score = 0;
    if (want && e.mood === want) { score += 3; reasons.push(`mood matches (${want})`); } else if (want && e.mood && RELATED[want]?.includes(e.mood)) { score += 1.2; reasons.push(`related mood (${e.mood})`); } else if (!want) score += 0.5;
    if (e.energyLevel === wantEnergy) { score += 1; reasons.push(`${wantEnergy} energy`); } else if (e.energyLevel !== 'medium' && wantEnergy !== 'medium') score -= 0.5;
    if (e.seconds >= seconds) { score += 0.8; reasons.push(`long enough (${Math.round(e.seconds)}s)`); } else if (e.seconds >= seconds * 0.6) score += 0.1; else { score -= 0.4; reasons.push('shorter than the video; will loop'); }
    if (e.favourite) { score += 0.6; reasons.push('favourite'); }
    if (e.imported && e.license.commercialOk === null) reasons.push('licence unconfirmed');
    out.push({ entry: e, score: +score.toFixed(2), reasons });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

const stableSeed = (...parts: string[]) => (parseInt(crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 6), 16) % 9000) + 1;

/** Decide the soundtrack BEFORE composing, because the cut points are placed on its beats. */
export function resolveSoundtrack(p: AutoProject, intent: Intent, opts: { allowRecommend?: boolean } = {}): Soundtrack {
  const cfg = p.config, profile = STYLE_PROFILES[intent.style];
  const base = { intensity: intent.intensity, beatOffset: 0 };
  if (cfg.audioMode === 'original') return { ...base, source: 'original', mood: null, seed: null, bpm: profile.defaultBpm, label: 'original audio only', license: 'n/a', commercialOk: null, reason: 'you chose original audio only; cuts use a steady rhythm' };
  if (cfg.audioMode === 'none') return { ...base, source: 'none', mood: null, seed: null, bpm: profile.defaultBpm, label: 'no background music', license: 'n/a', commercialOk: null, reason: 'you chose no background music; cuts use a steady rhythm' };

  if (cfg.soundtrackId) {
    const it = getItem(cfg.soundtrackId), f = audioFile(cfg.soundtrackId);
    if (it && f && it.kind === 'music') {
      const generated = !it.imported && it.mood && it.seed;
      const bpm = it.imported ? it.bpm ?? null : generated ? musicBpm(it.mood as never, it.seed, (it.overrides ?? undefined) as never) : null;
      return { ...base, source: 'library', file: f.path, mood: (it.mood as never) ?? null, seed: it.seed || null, bpm: bpm ?? profile.defaultBpm, beatOffset: it.imported ? it.beatOffset ?? 0 : 0, label: it.label, license: it.license.license, commercialOk: it.license.commercialOk, libraryId: it.id,
        reason: `the track you selected${bpm ? ` (${bpm.toFixed(0)} BPM)` : '; tempo unknown, steady cut rhythm used'}` };
    }
  }
  const tray = p.assets.find((a) => a.kind === 'audio' && a.audio);
  if (tray && cfg.audioMode !== 'generate') {
    const t = tray.audio!;
    return { ...base, source: 'tray', file: assetPath(p, tray), mood: null, seed: null, bpm: t.bpm && t.confidence >= 0.25 ? t.bpm : profile.defaultBpm, beatOffset: t.bpm && t.confidence >= 0.25 ? t.beatOffset : 0, label: tray.name, license: 'user-provided (confirm you hold the rights)', commercialOk: null,
      reason: t.bpm && t.confidence >= 0.25 ? `your uploaded audio; detected ${t.bpm.toFixed(0)} BPM (confidence ${t.confidence})` : 'your uploaded audio; tempo not confident, steady cut rhythm used' };
  }
  if (cfg.audioMode === 'auto' && opts.allowRecommend !== false) {
    const top = recommend(intent, cfg.durationSec, listEntries(), 1)[0];
    // a matching OR related-mood library track is preferred over composing a new one (score 1.2 = related mood only)
    if (top && top.score >= 1.2 && audioFile(top.entry.id)) {
      const it = top.entry, bpm = it.imported ? it.bpm ?? null : musicBpm(it.mood as never, it.seed, (it.overrides ?? undefined) as never);
      return { ...base, source: 'library', file: audioFile(it.id)!.path, mood: (it.mood as never) ?? null, seed: it.seed || null, bpm: bpm ?? profile.defaultBpm, beatOffset: it.imported ? it.beatOffset ?? 0 : 0, label: it.label, license: it.license.license, commercialOk: it.license.commercialOk, libraryId: it.id,
        reason: `recommended from your library: ${top.reasons.join(', ')}` };
    }
  }
  const mood = (intent.mood ?? profile.defaultMood) as Exclude<Mood, 'none'>; const seed = stableSeed(p.id, cfg.prompt, mood);
  return { ...base, source: 'generated', mood: mood === ('none' as never) ? 'cinematic' : mood, seed, bpm: musicBpm(mood, seed), label: `generated ${mood} #${seed}`, license: SOUND_LICENSE.license, commercialOk: SOUND_LICENSE.commercialOk,
    reason: `no suitable track in your library; composing a ${mood} track (${musicBpm(mood, seed).toFixed(0)} BPM) for this video` };
}
