'use client';

import React, { useState } from 'react';
import { Wand2, Loader2, Sparkles, Check, AlertTriangle, Rocket, RotateCcw } from 'lucide-react';
import { EditingPlan, validatePlan, AUDIO_MOODS, ENDING_STYLES, CAPTION_PRESETS, STYLES, INTENSITIES } from '@/lib/studio/plan';
import { PRODUCTION_STYLES } from '@/lib/studio/styles';
import { productionFromPlan, ProduceResult } from '@/lib/studio/produce';
import type { Identity } from '@/lib/studio/identity';
import { SectionTitle, Select, Slider, Toggle } from './ui';

export interface DirectorMeta { source: 'rules' | 'hybrid'; explicit: string[]; notes: string[]; warnings: string[]; changedSections: string[]; llmMs: number | null; instruction: string }

interface Props {
  sourceId: string | null;
  range: { start: number | null; end: number | null };
  hasTranscript: boolean;
  sceneTimes: number[];
  track: { t: number; x: number }[] | null;
  clipTitle: string;
  plan: EditingPlan | null;
  meta: DirectorMeta | null;
  identityId: string;
  identities: Identity[];
  applied: { applied: string[]; skipped: string[] } | null;
  isProducing: boolean;
  onIdentityChange: (id: string) => void;
  onPlan: (plan: EditingPlan, meta: DirectorMeta | null, identity: Identity | null) => void;
  onApply: (r: ProduceResult, identity: Identity | null) => void;
  onProduce: (clip: { name: string; startTime: number; endTime: number; production: ProduceResult['production'] }, report: { applied: string[]; skipped: string[]; steps: string[] }) => void;
}

const EXAMPLES = ['Make the opening more dramatic', 'Reduce the background music', 'Make the subtitles larger', 'Remove unnecessary pauses', 'Create a more energetic version', 'Use a more sophisticated soundtrack'];
const label = (s: string) => s.replace(/_/g, ' ');

const Chip: React.FC<{ k: string; v: string; explicit?: boolean; changed?: boolean }> = ({ k, v, explicit, changed }) => (
  <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] ${changed ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-100' : explicit ? 'border-indigo-400/40 bg-indigo-500/10 text-indigo-100' : 'border-white/10 bg-white/[0.04] text-zinc-300'}`}>
    <span className="text-zinc-500">{k}</span>{v}
  </span>
);

export const DirectorPanel: React.FC<Props> = (p) => {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useModel, setUseModel] = useState(true);
  const [steps, setSteps] = useState<string[]>([]);
  const plan = p.plan;
  const ex = (path: string) => !!p.meta?.explicit.includes(path);
  const ch = (sec: string) => !!p.meta?.changedSections.includes(sec);
  const identity = p.identities.find((i) => i.id === p.identityId) ?? null;

  const ask = async (instruction: string, fresh: boolean) => {
    if (!instruction.trim()) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/studio/director', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instruction, basePlan: fresh ? undefined : plan ?? undefined, useModel, identityId: p.identityId || undefined }) });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || 'The Director could not make a plan.');
      p.onPlan(d.plan, { source: d.source, explicit: d.explicit, notes: d.notes, warnings: d.warnings, changedSections: d.changedSections, llmMs: d.llmMs, instruction }, d.identity ?? null);
      setText('');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const tweak = (patch: Record<string, unknown>) => {
    if (!plan) return;
    const v = validatePlan(patch, plan);
    if (!v.ok) { setError(v.errors.join('; ')); return; }
    setError(null);
    p.onPlan(v.plan, p.meta ? { ...p.meta, changedSections: Object.keys(patch) } : null, identity);
  };

  const preview = (): ProduceResult | null => plan ? productionFromPlan(plan, { identity, title: p.clipTitle, hasTranscript: p.hasTranscript, sceneTimesInClip: sceneRel(), seed: 1, track: p.track }) : null;
  const sceneRel = () => (p.range.start !== null && p.range.end !== null ? p.sceneTimes.filter((t) => t > p.range.start! + 1 && t < p.range.end! - 1).map((t) => +(t - p.range.start!).toFixed(2)) : []);

  const produce = async () => {
    if (!p.sourceId) return;
    setBusy(true); setError(null); setSteps([]);
    try {
      const instruction = p.meta?.instruction || text;
      if (!instruction.trim()) throw new Error('Describe what you want first.');
      const res = await fetch('/api/studio/produce', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceId: p.sourceId, instruction, identityId: p.identityId || undefined, start: p.range.start ?? undefined, end: p.range.end ?? undefined, useModel }) });
      const d = await res.json();
      if (!d.success) { setSteps(d.steps ?? []); throw new Error(d.error || 'Production failed.'); }
      setSteps(d.steps);
      p.onProduce(d.clip, { applied: d.applied, skipped: d.skipped, steps: d.steps });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold text-white tracking-tight flex items-center gap-2"><Wand2 className="w-4 h-4 text-violet-300" /> AI Creative Director</h2>
        <p className="text-xs text-zinc-400 mt-0.5">Describe the result you want. Runs fully offline on this computer.</p>
      </div>

      <section>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={2000}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void ask(text, !plan); } }}
          placeholder={plan ? 'Refine: “make the music more subtle”, “change the caption style”…' : 'e.g. Turn this into a 45-second TikTok. Premium documentary feel, suspenseful music, bold captions and a memorable ending.'}
          className="w-full rounded-xl bg-zinc-950/60 border border-white/10 focus:border-violet-400/60 outline-none p-3 text-sm text-zinc-100 placeholder:text-zinc-500 resize-none" />
        <div className="flex items-center gap-2 mt-2">
          <button onClick={() => void ask(text, !plan)} disabled={busy || !text.trim()} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-violet-500 hover:bg-violet-400 disabled:bg-zinc-700 disabled:text-zinc-400 text-white text-sm font-semibold transition-colors">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}{plan ? 'Refine plan' : 'Make a plan'}
          </button>
          {plan && <button onClick={() => void ask(text, true)} disabled={busy || !text.trim()} title="Ignore the current plan and start over with this instruction" className="p-2.5 rounded-xl border border-white/10 text-zinc-300 hover:bg-white/5 disabled:opacity-40"><RotateCcw className="w-4 h-4" /></button>}
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {EXAMPLES.map((e) => <button key={e} onClick={() => setText(e)} className="text-[11px] px-2 py-1 rounded-full border border-white/10 text-zinc-400 hover:text-white hover:border-white/25">{e}</button>)}
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Toggle checked={useModel} onChange={setUseModel} label="Use local AI model" />
          <Select label="Creative identity" value={p.identityId} onChange={p.onIdentityChange}>
            <option value="">None</option>{p.identities.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </Select>
        </div>
        {busy && useModel && <p className="text-[11px] text-zinc-500 mt-2">The local model can take up to a minute on a low-power laptop. Explicit requests (platform, length, mood) are applied instantly by rules.</p>}
      </section>

      {error && <div className="flex items-start gap-2 rounded-xl border border-rose-400/30 bg-rose-400/[0.07] px-3 py-2.5 text-xs text-rose-100"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{error}</div>}

      {plan && (
        <>
          <section>
            <SectionTitle hint={p.meta ? `${p.meta.source === 'hybrid' ? 'Local model + rules' : 'Rules only'}${p.meta.llmMs ? ` · model ${(p.meta.llmMs / 1000).toFixed(0)}s` : ''}. Blue = stated by you; green = just changed.` : undefined}>Current plan</SectionTitle>
            <div className="flex flex-wrap gap-1.5">
              <Chip k="format" v={label(plan.format)} explicit={ex('format')} changed={ch('format')} />
              <Chip k="length" v={`${plan.duration_target}s`} explicit={ex('duration_target')} changed={ch('duration_target')} />
              <Chip k="style" v={label(plan.style)} explicit={ex('style')} changed={ch('style')} />
              <Chip k="framing" v={label(plan.framing)} explicit={ex('framing')} changed={ch('framing')} />
              <Chip k="captions" v={`${plan.captions.preset} · ${plan.captions.position}${plan.captions.scale !== 1 ? ` · ${plan.captions.scale}×` : ''}`} explicit={ex('captions.preset')} changed={ch('captions')} />
              <Chip k="music" v={plan.audio.music ? `${label(plan.audio.mood)} · ${Math.round(plan.audio.music_volume * 100)}%` : 'off'} explicit={ex('audio.mood') || ex('audio.music')} changed={ch('audio')} />
              <Chip k="sfx" v={plan.audio.sound_effects ? 'on' : 'off'} explicit={ex('audio.sound_effects')} changed={ch('audio')} />
              <Chip k="ducking" v={plan.audio.ducking ? 'on' : 'off'} changed={ch('audio')} />
              <Chip k="ending" v={label(plan.ending.style)} explicit={ex('ending.style')} changed={ch('ending')} />
              {(plan.pacing.remove_silence || plan.pacing.speed !== 1) && <Chip k="pacing" v={`${plan.pacing.remove_silence ? 'no silence · ' : ''}${plan.pacing.speed}×`} changed={ch('pacing')} />}
            </div>
            {p.meta?.warnings.map((w, i) => <p key={i} className="text-[11px] text-amber-300/90 mt-1.5">• {w}</p>)}
          </section>

          <section className="rounded-2xl bg-white/[0.03] border border-white/[0.07] p-3 grid grid-cols-2 gap-3">
            <Select label="Production style" value={plan.style} onChange={(v) => tweak({ style: v })}>{STYLES.map((s) => <option key={s} value={s}>{PRODUCTION_STYLES[s].label}</option>)}</Select>
            <Select label="Caption look" value={plan.captions.preset} onChange={(v) => tweak({ captions: { preset: v } })}>{CAPTION_PRESETS.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>
            <Select label="Music mood" value={plan.audio.music ? plan.audio.mood : 'none'} onChange={(v) => tweak({ audio: v === 'none' ? { music: false, mood: 'none' } : { music: true, mood: v } })}>{AUDIO_MOODS.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>
            <Select label="Intensity" value={plan.audio.intensity} onChange={(v) => tweak({ audio: { intensity: v } })}>{INTENSITIES.map((s) => <option key={s}>{s}</option>)}</Select>
            <Select label="Ending" value={plan.ending.style} onChange={(v) => tweak({ ending: { style: v } })}>{ENDING_STYLES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>
            <div className="flex flex-col gap-2 justify-end">
              <Toggle checked={plan.audio.sound_effects} onChange={(v) => tweak({ audio: { sound_effects: v } })} label="Sound effects" />
              <Toggle checked={plan.audio.ducking} onChange={(v) => tweak({ audio: { ducking: v } })} label="Duck music under speech" />
            </div>
            <div className="col-span-2"><Slider label="Music level" value={plan.audio.music_volume} min={0} max={0.5} step={0.01} onChange={(v) => tweak({ audio: { music_volume: v } })} format={(v) => `${Math.round(v * 100)}%`} /></div>
          </section>

          {(() => { const r = preview(); return r && (
            <section className="text-xs">
              <SectionTitle hint="What this renderer will and won't do with the plan">Preview of the render</SectionTitle>
              {r.applied.map((a, i) => <div key={i} className="flex gap-2 text-zinc-300 py-0.5"><Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />{a}</div>)}
              {r.skipped.map((a, i) => <div key={i} className="flex gap-2 text-amber-200/90 py-0.5"><AlertTriangle className="w-3.5 h-3.5 text-amber-300 shrink-0 mt-0.5" />{a}</div>)}
            </section>
          ); })()}

          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => { const r = preview(); if (r) p.onApply(r, identity); }} className="py-2.5 rounded-xl border border-violet-400/50 text-violet-100 text-sm font-semibold hover:bg-violet-500/15 transition-colors">Apply to editor</button>
            <button onClick={produce} disabled={busy || p.isProducing || !p.sourceId} title="Pick the best moment, apply the plan and render a finished video" className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-sm font-bold disabled:from-zinc-700 disabled:to-zinc-700 disabled:text-zinc-400">
              {busy || p.isProducing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}Auto-produce
            </button>
          </div>
          <p className="text-[11px] text-zinc-500 -mt-3">“Apply” fills the Crop, Captions and Export settings so you can fine-tune. “Auto-produce” {p.range.start !== null ? 'renders your selected range' : 'picks the best moment and renders it'} with the plan.</p>
        </>
      )}

      {steps.length > 0 && <div className="text-[11px] text-zinc-400 border-t border-white/[0.06] pt-3">{steps.map((s, i) => <div key={i}>→ {s}</div>)}</div>}
      {p.applied && p.applied.skipped.length > 0 && <div className="text-[11px] text-amber-200/90">Last render skipped: {p.applied.skipped.join(' · ')}</div>}
    </div>
  );
};
