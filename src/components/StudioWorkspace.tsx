'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Music, Fingerprint, Cpu, Loader2, Play, Trash2, Download, Check, AlertTriangle, Plus, Zap, Wand2 } from 'lucide-react';
import { SectionTitle, Select, Slider, Toggle, ColorField } from '@/components/editor/ui';
import { AUDIO_MOODS, STYLES, CAPTION_PRESETS, ENDING_STYLES } from '@/lib/studio/plan';
import { PRODUCTION_STYLES } from '@/lib/studio/styles';
import type { Identity, IdentityInput } from '@/lib/studio/identity';
import type { LibraryItem } from '@/lib/studio/library';
import { BrandPanel } from '@/components/BrandPanel';
import { SoundStudio } from '@/components/sound/SoundStudio';
import { DurationPicker } from '@/components/sound/DurationPicker';
import { usePlayer } from '@/components/sound/player';

export type SoundPick = { mood: string; intensity: string; seed: number; overrides: Record<string, unknown> };
type Tab = 'sonic' | 'library' | 'identities' | 'models';
const label = (s: string) => s.replace(/_/g, ' ');
const card = 'rounded-2xl bg-white/[0.03] border border-white/[0.07] p-4';
const btn = 'px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 text-zinc-200 hover:bg-white/5 disabled:opacity-40 transition-colors';
const primary = 'px-4 py-2 rounded-xl text-sm font-semibold bg-violet-500 hover:bg-violet-400 disabled:bg-zinc-700 disabled:text-zinc-400 text-white transition-colors';

async function api<T = any>(url: string, init?: RequestInit): Promise<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(url, init); const d = await r.json();
  if (!d.success) throw new Error(d.error || 'Request failed');
  return d;
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const ErrorBox: React.FC<{ msg: string | null }> = ({ msg }) => msg ? <div className="flex gap-2 items-start rounded-xl border border-rose-400/30 bg-rose-400/[0.07] px-3 py-2 text-xs text-rose-100"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{msg}</div> : null;

// ============================== Sonic Studio ==============================
const MOOD_TO_STYLE: Record<string, string> = { cinematic: 'cinematic', corporate: 'corporate', luxury: 'luxury', documentary: 'ambient', suspense: 'dramatic', inspirational: 'inspirational', electronic: 'electronic', african_fusion: 'african_fusion', minimal: 'minimal', technology: 'experimental', comedy: 'electronic', emotional: 'luxury', advertising: 'inspirational', news_editorial: 'minimal' };
const SonicTab: React.FC<{ onUseSound?: (p: SoundPick) => void; hasVideo: boolean; videoSeconds?: number }> = ({ onUseSound, hasVideo, videoSeconds }) => {
  const [meta, setMeta] = useState<{ categories: { id: string; label: string; description: string }[]; sfx: { id: string; label: string }[]; limits: { maxSeconds: number; maxVariations: number }; tier: string; library: LibraryItem[] } | null>(null);
  const [prompt, setPrompt] = useState(''); const [moods, setMoods] = useState<string[]>(['cinematic']); const [intensity, setIntensity] = useState('medium');
  const [seconds, setSeconds] = useState(30); const [variations, setVariations] = useState(2); const [introPad, setIntroPad] = useState(0); const [outroPad, setOutroPad] = useState(0);
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null); const [interp, setInterp] = useState<string[]>([]);
  const player = usePlayer();
  const load = useCallback(() => api('/api/studio/sound').then(setMeta).catch((e) => setErr(e.message)), []);
  useEffect(() => { void load(); }, [load]);

  const render = async (body: Record<string, unknown>, tag: string) => {
    setBusy(tag); setErr(null);
    try { const d = await api('/api/studio/sound', json('POST', body)); setInterp(d.interpreted ?? []); await load(); if (tag === 'sfx' || tag === 'sig') play(d.items[0].id); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  const toggleMood = (id: string) => setMoods((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id].slice(-4)));
  // Several chips are blended by the Sonic Engine into genuinely different variations (lead style, layers, tempo-checked); one chip keeps the classic single-mood render.
  const pads = { ...(introPad ? { introPadSec: introPad } : {}), ...(outroPad ? { outroPadSec: outroPad } : {}) };
  const generate = () => {
    const styles = [...new Set(moods.map((m) => MOOD_TO_STYLE[m]).filter(Boolean))];
    if (moods.length >= 2 && styles.length >= 1) return render({ styles, seconds, variations, ...pads, ...(prompt.trim() ? { prompt } : {}), ...(intensity !== 'medium' || !prompt.trim() ? { intensity } : {}) }, 'music');
    return render(prompt.trim() ? { prompt, seconds, variations, ...pads, ...(intensity !== 'medium' ? { intensity } : {}) } : { mood: moods[0] ?? 'cinematic', intensity, seconds, variations, ...pads }, 'music');
  };
  const play = (id: string) => player.toggle({ id, title: meta?.library.find((x) => x.id === id)?.label ?? 'Sound', src: `/api/studio/sound/file?id=${id}` });
  const playing = player.playing ? player.track?.id ?? null : null;
  const remove = async (id: string) => { try { await api(`/api/studio/sound?id=${id}`, { method: 'DELETE' }); await load(); } catch (e) { setErr((e as Error).message); } };
  if (!meta) return <p className="text-sm text-zinc-400">{err ?? 'Loading…'}</p>;
  const music = meta.library.filter((i) => i.kind === 'music');

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5">
      <div className="flex flex-col gap-4">
        <div className={card}>
          <SectionTitle hint={`Procedural synthesis on this ${meta.tier}-resource machine: up to ${meta.limits.maxSeconds}s and ${meta.limits.maxVariations} variations. No AI model or sample packs are used.`}>Describe a soundtrack</SectionTitle>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} maxLength={500} placeholder="e.g. premium corporate soundtrack with deep bass, elegant piano and a gradual build-up"
            className="w-full rounded-xl bg-zinc-950/60 border border-white/10 focus:border-violet-400/60 outline-none p-3 text-sm text-zinc-100 placeholder:text-zinc-500 resize-none" />
          <div className="flex flex-wrap gap-1.5 mt-3">
            {meta.categories.map((c) => <button key={c.id} type="button" aria-pressed={moods.includes(c.id)} onClick={() => toggleMood(c.id)} title={c.description} className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${moods.includes(c.id) ? 'bg-violet-500/25 border-violet-400/60 text-white' : 'border-white/10 text-zinc-400 hover:text-white'}`}>{c.label}</button>)}
          </div>
          <p className="text-[11px] text-zinc-500 mt-1.5">{moods.length >= 2 ? `Blending ${moods.length} styles: the engine picks a lead, balances the layers and makes each variation a different character.` : 'Pick one style, or select up to 4 to blend them into one soundtrack.'}</p>
          <div className="mt-3"><DurationPicker value={{ seconds, introPadSec: introPad, outroPadSec: outroPad }} max={meta.limits.maxSeconds} videoSeconds={videoSeconds} disabled={!!busy} onChange={(v) => { setSeconds(v.seconds); setIntroPad(v.introPadSec); setOutroPad(v.outroPadSec); }} /></div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <Select label="Intensity" value={intensity} onChange={setIntensity}>{['low', 'medium', 'high'].map((i) => <option key={i}>{i}</option>)}</Select>
            <Slider label="Variations" value={variations} min={1} max={meta.limits.maxVariations} onChange={setVariations} />
          </div>
          <button disabled={!!busy || (!moods.length && !prompt.trim())} onClick={generate} className={`${primary} mt-3 w-full flex items-center justify-center gap-2`}>
            {busy === 'music' ? <><Loader2 className="w-4 h-4 animate-spin" />Rendering… (about {Math.max(2, Math.round(seconds * variations / 6))}s)</> : <><Music className="w-4 h-4" />Generate {variations > 1 ? `${variations} variations` : 'soundtrack'}</>}
          </button>
          {interp.length > 0 && <p className="text-[11px] text-zinc-400 mt-2">Understood: {interp.join(' · ')}</p>}
        </div>
        <ErrorBox msg={err} />
        <div className={card}>
          <SectionTitle hint="Short procedural sounds. Click to audition.">Sound effects</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {meta.sfx.map((s) => <button key={s.id} disabled={!!busy} onClick={() => render({ sfx: s.id }, 'sfx')} className={btn}>{busy === 'sfx' ? '…' : <Play className="w-3 h-3 inline mr-1" />}{s.label}</button>)}
          </div>
        </div>
      </div>

      <div className={card}>
        <SectionTitle hint="Saved on this computer with licence details. Stays available offline.">Library ({music.length})</SectionTitle>
        {music.length === 0 && <p className="text-xs text-zinc-500">Nothing yet. Generate a soundtrack to audition it here.</p>}
        <div className="flex flex-col gap-2 max-h-[560px] overflow-y-auto">
          {music.map((i) => (
            <div key={i.id} className="rounded-xl border border-white/[0.07] bg-zinc-950/40 p-3">
              <div className="flex items-center gap-2">
                <button onClick={() => play(i.id)} className={`w-8 h-8 rounded-full flex items-center justify-center ${playing === i.id ? 'bg-violet-500 text-white' : 'bg-white/10 text-zinc-200 hover:bg-white/20'}`} aria-label={`Play ${i.label}`}><Play className="w-3.5 h-3.5" /></button>
                <div className="min-w-0 flex-1"><div className="text-sm text-white truncate">{label(i.label)}</div><div className="text-[11px] text-zinc-500 truncate">{i.intensity} · {i.seconds}s · rendered in {(i.renderMs / 1000).toFixed(1)}s{i.prompt ? ` · “${i.prompt}”` : ''}</div></div>
                {onUseSound && <button disabled={!hasVideo} title={hasVideo ? 'Use this exact sound in the current video' : 'Open a video first'} onClick={() => onUseSound({ mood: i.mood!, intensity: i.intensity!, seed: i.seed, overrides: i.overrides ?? {} })} className={btn}>Use</button>}
                <button onClick={() => remove(i.id)} className="p-1.5 text-zinc-500 hover:text-rose-300" aria-label="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
              <div className="text-[10px] text-zinc-600 mt-1.5">Licence: {i.license.license}. Commercial use OK, no attribution.</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ============================== Identities ==============================
const blank = (): IdentityInput => ({
  name: 'New identity', colors: { primary: '#0B0B0F', accent: '#F59E0B', text: '#FFFFFF' }, typography: { fontFamily: 'Poppins', fontWeight: 700 },
  caption: { preset: 'bold_dynamic', overrides: {} }, opening: { style: 'none', seconds: 2 }, ending: { style: 'clean_fade', text: '', seconds: 2 },
  sound: { signatureSeed: Math.floor(Math.random() * 9000) + 1, mood: 'cinematic', preferredMoods: ['cinematic'], sfx: true, musicVolume: 0.15 },
  transitions: 'soft', brand: { text: '', corner: 'none' }, framing: { framing: 'center' }, style: 'cinematic_storytelling', grade: 'style',
});

const IdentitiesTab: React.FC = () => {
  const [list, setList] = useState<Identity[]>([]); const [templates, setTemplates] = useState<{ key: string; name: string }[]>([]);
  const [draft, setDraft] = useState<(IdentityInput & { id?: string }) | null>(null); const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const player = usePlayer();
  const load = useCallback(() => api('/api/studio/identities').then((d) => { setList(d.identities); setTemplates(d.templates); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  const save = async () => {
    if (!draft) return; setBusy(true); setErr(null);
    try { const { id, logo: _logo, ...identity } = draft as typeof draft & { logo?: unknown }; void _logo; await api(id ? `/api/studio/identities?id=${id}` : '/api/studio/identities', json(id ? 'PUT' : 'POST', { identity })); setDraft(null); await load(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const fromTemplate = async (key: string) => { try { await api('/api/studio/identities', json('POST', { template: key })); await load(); } catch (e) { setErr((e as Error).message); } };
  const del = async (id: string) => { if (!confirm('Delete this identity? Videos already made are not affected.')) return; try { await api(`/api/studio/identities?id=${id}`, { method: 'DELETE' }); await load(); } catch (e) { setErr((e as Error).message); } };
  const signature = async () => { if (!draft) return; try { const d = await api('/api/studio/sound', json('POST', { signatureSeed: draft.sound.signatureSeed, mood: draft.sound.mood })); player.play({ id: d.items[0].id, title: 'Signature sound', src: `/api/studio/sound/file?id=${d.items[0].id}` }); } catch (e) { setErr((e as Error).message); } };
  const set = (fn: (d: IdentityInput & { id?: string }) => void) => setDraft((d) => { if (!d) return d; const c = JSON.parse(JSON.stringify(d)); fn(c); return c; });

  return (
    <div className="flex flex-col gap-4">
      <ErrorBox msg={err} />
      {!draft && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button className={primary} onClick={() => setDraft(blank())}><Plus className="w-4 h-4 inline mr-1" />New identity</button>
            {templates.map((t) => <button key={t.key} className={btn} onClick={() => fromTemplate(t.key)}>Add template: {t.name}</button>)}
          </div>
          {list.length === 0 && <p className="text-sm text-zinc-400">An identity gives every video for a page the same look and sound: colours, typography, caption style, sound signature, title/end cards and framing.</p>}
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            {list.map((i) => (
              <div key={i.id} className={card}>
                <div className="flex items-center gap-2"><span className="w-4 h-4 rounded-full border border-white/20" style={{ background: i.colors.accent }} /><span className="font-semibold text-white truncate">{i.name}</span></div>
                <p className="text-xs text-zinc-400 mt-1">{PRODUCTION_STYLES[i.style].label} · {i.typography.fontFamily} · {label(i.sound.mood)} · {label(i.ending.style)}</p>
                <div className="flex gap-2 mt-3"><button className={btn} onClick={() => setDraft({ ...i })}>Edit</button><button className={btn} onClick={() => del(i.id)}>Delete</button></div>
              </div>
            ))}
          </div>
        </>
      )}
      {draft && (
        <div className={`${card} flex flex-col gap-4`}>
          <div className="grid md:grid-cols-3 gap-3">
            <div className="md:col-span-3"><label className="text-xs text-zinc-300 block mb-1">Name</label><input value={draft.name} maxLength={60} onChange={(e) => set((d) => { d.name = e.target.value; })} className="w-full rounded-lg bg-zinc-950/60 border border-white/10 px-3 py-2 text-sm text-white" /></div>
            <ColorField label="Primary" value={draft.colors.primary} onChange={(v) => set((d) => { d.colors.primary = v; })} />
            <ColorField label="Accent / highlight" value={draft.colors.accent} onChange={(v) => set((d) => { d.colors.accent = v; })} />
            <ColorField label="Text" value={draft.colors.text} onChange={(v) => set((d) => { d.colors.text = v; })} />
            <Select label="Font" value={draft.typography.fontFamily} onChange={(v) => set((d) => { d.typography.fontFamily = v; })}>{['Poppins', 'Montserrat', 'Inter', 'Anton', 'Bebas Neue', 'Arial', 'Impact'].map((f) => <option key={f}>{f}</option>)}</Select>
            <Select label="Production style" value={draft.style} onChange={(v) => set((d) => { d.style = v as never; })}>{STYLES.map((s) => <option key={s} value={s}>{PRODUCTION_STYLES[s].label}</option>)}</Select>
            <Select label="Colour grade" value={draft.grade} onChange={(v) => set((d) => { d.grade = v as never; })}>{['style', 'none', 'cinematic', 'documentary', 'clean', 'warm'].map((s) => <option key={s}>{s}</option>)}</Select>
            <Select label="Caption look" value={draft.caption.preset} onChange={(v) => set((d) => { d.caption.preset = v as never; })}>{CAPTION_PRESETS.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>
            <Select label="Framing" value={draft.framing.framing} onChange={(v) => set((d) => { d.framing.framing = v as never; })}>{['center', 'speaker_tracking', 'blur_pad', 'wide'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>
            <Select label="Transitions" value={draft.transitions} onChange={(v) => set((d) => { d.transitions = v as never; })}>{['none', 'soft', 'punchy'].map((s) => <option key={s}>{s}</option>)}</Select>
            <Select label="Opening" value={draft.opening.style} onChange={(v) => set((d) => { d.opening.style = v as never; })}><option value="none">None</option><option value="title_card">Title card</option></Select>
            <Select label="Ending" value={draft.ending.style} onChange={(v) => set((d) => { d.ending.style = v as never; })}>{ENDING_STYLES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>
            <div><label className="text-xs text-zinc-300 block mb-1">End card text</label><input value={draft.ending.text} maxLength={80} onChange={(e) => set((d) => { d.ending.text = e.target.value; })} className="w-full rounded-lg bg-zinc-950/60 border border-white/10 px-3 py-2 text-sm text-white" /></div>
            <div><label className="text-xs text-zinc-300 block mb-1">Brand mark text</label><input value={draft.brand.text} maxLength={40} onChange={(e) => set((d) => { d.brand.text = e.target.value; })} className="w-full rounded-lg bg-zinc-950/60 border border-white/10 px-3 py-2 text-sm text-white" /></div>
            <Select label="Brand mark position" value={draft.brand.corner} onChange={(v) => set((d) => { d.brand.corner = v as never; })}>{[['none', 'Hidden'], ['tl', 'Top left'], ['tr', 'Top right'], ['bl', 'Bottom left'], ['br', 'Bottom right']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
            <BrandPanel draft={draft as never} set={set as never} reload={load} onErr={setErr} />
            <Select label="Signature mood" value={draft.sound.mood} onChange={(v) => set((d) => { d.sound.mood = v as never; if (!d.sound.preferredMoods.includes(v as never)) d.sound.preferredMoods.push(v as never); })}>{AUDIO_MOODS.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>
            <div className="flex items-end gap-2"><div className="flex-1"><label className="text-xs text-zinc-300 block mb-1">Sound signature seed</label><input type="number" min={1} max={999999} value={draft.sound.signatureSeed} onChange={(e) => set((d) => { d.sound.signatureSeed = Math.max(1, Math.round(Number(e.target.value) || 1)); })} className="w-full rounded-lg bg-zinc-950/60 border border-white/10 px-3 py-2 text-sm text-white" /></div><button className={btn} onClick={signature}><Play className="w-3 h-3 inline mr-1" />Hear</button></div>
            <Slider label="Default music level" value={draft.sound.musicVolume} min={0} max={0.5} step={0.01} onChange={(v) => set((d) => { d.sound.musicVolume = v; })} format={(v) => `${Math.round(v * 100)}%`} />
            <Toggle checked={draft.sound.sfx} onChange={(v) => set((d) => { d.sound.sfx = v; })} label="Use sound effects" />
          </div>
          <div className="flex gap-2"><button className={primary} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save identity'}</button><button className={btn} onClick={() => { setDraft(null); setErr(null); }}>Cancel</button></div>
          <p className="text-[11px] text-zinc-500">Applied to videos made with this identity: typography, colours, caption look and position, framing, sound signature, title/end cards, brand mark text and an optional logo image.</p>
        </div>
      )}
    </div>
  );
};

// ============================== Models & resources ==============================
interface ModelRow { id: string; name: string; kind: string; format: string; quant: string; downloadSizeMB: number; ramMB: number; minTier: string; license: string; commercialOk: boolean; licenseVerified: boolean; licenseNote: string; offlineCapable: boolean; installed: boolean; fileSizeMB: number | null; fit: { ok: boolean; reason?: string }; preferred: boolean; sourceUrl: string | null; download: { status: string; received: number; total: number; error?: string } | null; runtime: { ok: boolean; reason?: string } }
interface ModelsData { hardware: { tier: string; cpu: { model: string; cores: number; avx2: boolean }; ramMB: { total: number; available: number }; gpu: { name: string | null; vendor: string; vramMB: number | null }; diskFreeMB: number | null; modelRamBudgetMB: number; inferenceThreads: number; reasons: string[] }; models: ModelRow[]; runtimeBinary: { path: string; present: boolean }; resources: { ramTotalMB: number; ramUsedMB: number; load1: number; appRssMB: number; modelServerRssMB: number | null; gpu: { name: string; usedMB: number; totalMB: number; utilPct: number } | null; loaded: { id: string; state: string; ramMB: number } | null; queued: number; running: string | null; budgetMB: number } }

const Bar: React.FC<{ pct: number; tone?: string }> = ({ pct, tone = 'bg-indigo-400' }) => <div className="h-1.5 rounded-full bg-white/10 overflow-hidden"><div className={`h-full ${tone}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div>;

const ModelsTab: React.FC = () => {
  const [d, setD] = useState<ModelsData | null>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState<string | null>(null); const [test, setTest] = useState<Record<string, string>>({});
  const load = useCallback(() => api<ModelsData & { success: boolean }>('/api/studio/models').then((x) => { setD(x); setErr(null); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { void load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, [load]);
  const act = async (id: string, action: string) => {
    setBusy(id + action); setErr(null);
    try {
      const x = await api('/api/studio/models', json('POST', { id, action }));
      if (action === 'test') { const r = x.result; setTest((t) => ({ ...t, [id]: r.ok ? `OK: plan in ${(r.totalMs / 1000).toFixed(1)}s (model ${((r.llmMs ?? 0) / 1000).toFixed(1)}s), ${r.rssMB ?? '?'} MB` : `Failed: ${r.error}` })); }
      await load();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  const remove = async (m: ModelRow) => { if (!confirm(`Remove ${m.name}? It frees ${m.fileSizeMB} MB and can be downloaded again.`)) return; try { await api(`/api/studio/models?id=${m.id}`, { method: 'DELETE' }); await load(); } catch (e) { setErr((e as Error).message); } };
  const download = (m: ModelRow) => { if (confirm(`Download ${m.name} (${m.downloadSizeMB} MB)? This needs an internet connection and is verified with a checksum afterwards.`)) void act(m.id, 'download'); };
  if (!d) return <p className="text-sm text-zinc-400">{err ?? 'Detecting hardware…'}</p>;
  const h = d.hardware, r = d.resources;

  return (
    <div className="flex flex-col gap-4">
      <ErrorBox msg={err} />
      <div className="grid md:grid-cols-2 gap-4">
        <div className={card}>
          <SectionTitle>This computer</SectionTitle>
          <div className="text-sm text-white font-medium">{h.cpu.model}</div>
          <div className="text-xs text-zinc-400 mt-1">{h.cpu.cores} threads · {Math.round(h.ramMB.total / 1024)} GB RAM · {h.gpu.name ?? 'no GPU'}{h.diskFreeMB !== null ? ` · ${(h.diskFreeMB / 1024).toFixed(0)} GB free disk` : ''}</div>
          <div className="mt-2 flex items-center gap-2"><span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide ${h.tier === 'low' ? 'bg-amber-400/15 text-amber-200' : h.tier === 'standard' ? 'bg-sky-400/15 text-sky-200' : 'bg-emerald-400/15 text-emerald-200'}`}>{h.tier}-resource</span><span className="text-[11px] text-zinc-500">{h.reasons.join('; ')}</span></div>
          <p className="text-[11px] text-zinc-500 mt-2">Models may use up to {h.modelRamBudgetMB} MB of RAM and {h.inferenceThreads} CPU threads. One model is loaded at a time.</p>
        </div>
        <div className={card}>
          <SectionTitle hint="Updates every 3 seconds">Resource monitor</SectionTitle>
          <div className="text-xs text-zinc-300 flex justify-between"><span>RAM</span><span>{r.ramUsedMB} / {r.ramTotalMB} MB</span></div><Bar pct={(r.ramUsedMB / r.ramTotalMB) * 100} tone={r.ramUsedMB / r.ramTotalMB > 0.85 ? 'bg-rose-400' : 'bg-indigo-400'} />
          <div className="text-xs text-zinc-300 flex justify-between mt-2"><span>CPU load (1 min)</span><span>{r.load1} / {h.cpu.cores}</span></div><Bar pct={(r.load1 / h.cpu.cores) * 100} tone="bg-violet-400" />
          <div className="text-xs text-zinc-300 flex justify-between mt-2"><span>GPU</span><span>{r.gpu ? `${r.gpu.utilPct}% · ${r.gpu.usedMB}/${r.gpu.totalMB} MB` : 'not available (CPU inference)'}</span></div>
          <div className="text-xs text-zinc-400 mt-3 grid grid-cols-2 gap-y-1"><span>Model loaded</span><span className="text-right text-zinc-200">{r.loaded ? `${r.loaded.id} (${r.loaded.state})` : 'none (unloads when idle)'}</span><span>Model memory</span><span className="text-right text-zinc-200">{r.modelServerRssMB ? `${r.modelServerRssMB} MB` : '—'}</span><span>Queue</span><span className="text-right text-zinc-200">{r.running ? `running: ${r.running}` : 'idle'}{r.queued ? `, ${r.queued} waiting` : ''}</span><span>App memory</span><span className="text-right text-zinc-200">{r.appRssMB} MB</span></div>
        </div>
      </div>

      {!d.runtimeBinary.present && <div className="flex gap-2 rounded-xl border border-amber-400/30 bg-amber-400/[0.06] px-3 py-2 text-xs text-amber-100"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>The local inference engine (llama.cpp) is not installed at <code className="font-mono">{d.runtimeBinary.path}</code>. The Director still works using rules only. See docs/STUDIO_PHASE1.md to build it.</span></div>}

      <div className="flex flex-col gap-3">
        {d.models.map((m) => (
          <div key={m.id} className={card}>
            <div className="flex flex-wrap items-center gap-2">
              <Cpu className="w-4 h-4 text-violet-300" /><span className="font-semibold text-white">{m.name}</span>
              <span className="text-[11px] text-zinc-500">{m.format.toUpperCase()} {m.quant}</span>
              {m.installed && <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-400/15 text-emerald-200">installed</span>}
              {m.preferred && m.installed && <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-400/20 text-violet-200">selected</span>}
              {r.loaded?.id === m.id && <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-400/20 text-sky-200">loaded</span>}
              <div className="ml-auto flex flex-wrap gap-1.5">
                {!m.installed && <button className={btn} disabled={!m.sourceUrl || !!m.download && m.download.status === 'downloading' || !!busy} onClick={() => download(m)} title={m.sourceUrl ? '' : 'No verified source registered'}><Download className="w-3 h-3 inline mr-1" />Download {m.downloadSizeMB} MB</button>}
                {m.installed && !m.preferred && <button className={btn} disabled={!m.fit.ok || !!busy} onClick={() => act(m.id, 'select')}>Use this</button>}
                {m.installed && <button className={btn} disabled={!m.fit.ok || !m.runtime.ok || !!busy} onClick={() => act(m.id, 'test')}>{busy === m.id + 'test' ? <Loader2 className="w-3 h-3 inline animate-spin" /> : <Zap className="w-3 h-3 inline mr-1" />}Test speed</button>}
                {m.installed && <button className={btn} onClick={() => remove(m)}><Trash2 className="w-3 h-3 inline mr-1" />Remove</button>}
              </div>
            </div>
            <div className="text-xs text-zinc-400 mt-2 grid sm:grid-cols-4 gap-x-4 gap-y-1">
              <span>Download: {m.downloadSizeMB} MB</span><span>RAM: ~{m.ramMB} MB</span><span>Needs: {m.minTier} tier+</span><span>{m.offlineCapable ? 'Works offline' : 'Needs internet'}</span>
            </div>
            <div className="text-xs mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className={m.commercialOk ? 'text-emerald-300' : 'text-rose-300'}>{m.license} · {m.commercialOk ? 'commercial use OK' : 'NOT for commercial use'}</span>
              <span className={m.licenseVerified ? 'text-emerald-300/80' : 'text-amber-300'}>{m.licenseVerified ? <><Check className="w-3 h-3 inline" /> licence checked</> : 'licence NOT yet verified'}</span>
              {!m.fit.ok && <span className="text-amber-300">Won&apos;t run here: {m.fit.reason}</span>}
            </div>
            <p className="text-[11px] text-zinc-500 mt-1">{m.licenseNote}</p>
            {m.download && m.download.status !== 'done' && <div className="mt-2"><Bar pct={(m.download.received / Math.max(1, m.download.total)) * 100} tone={m.download.status === 'error' ? 'bg-rose-400' : 'bg-violet-400'} /><div className="text-[11px] text-zinc-400 mt-1">{m.download.status === 'error' ? m.download.error : `${m.download.status}… ${Math.round(m.download.received / 1048576)} / ${Math.round(m.download.total / 1048576)} MB`}</div></div>}
            {test[m.id] && <div className="text-[11px] text-zinc-300 mt-2">{test[m.id]}</div>}
          </div>
        ))}
      </div>
    </div>
  );
};

// ============================== Workspace ==============================
// ============================== Sound Library ==============================
const ImportForm: React.FC<{ onDone: () => void; cats: { id: string; label: string }[] }> = ({ onDone, cats }) => {
  const [f, setF] = useState({ label: '', genre: '', mood: '', description: '', license: '', commercialOk: 'unknown', source: '', attribution: '', energy: '', confirm: false });
  const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    if (!file) return setErr('Choose an audio file.'); setBusy(true); setErr(null);
    const fd = new FormData(); fd.append('file', file); Object.entries(f).forEach(([k, v]) => fd.append(k, String(v)));
    try { const d = await api('/api/studio/sound/import', { method: 'POST', body: fd }); void d; onDone(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const inp = 'w-full rounded-lg bg-zinc-950/60 border border-white/10 px-3 py-2 text-sm text-white';
  return (
    <div className={`${card} flex flex-col gap-3`}>
      <SectionTitle hint="The licence is recorded exactly as you enter it. Nothing is assumed to be usable commercially.">Import a licensed track</SectionTitle>
      <ErrorBox msg={err} />
      <input type="file" accept="audio/mpeg,audio/wav,audio/mp4,audio/ogg,audio/flac,.mp3,.wav,.m4a,.ogg,.flac" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-xs text-zinc-400 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-xs file:text-zinc-200" />
      <div className="grid sm:grid-cols-2 gap-3">
        <div><label className="text-xs text-zinc-300 block mb-1">Name</label><input className={inp} value={f.label} maxLength={80} onChange={(e) => setF({ ...f, label: e.target.value })} /></div>
        <div><label className="text-xs text-zinc-300 block mb-1">Genre</label><input className={inp} value={f.genre} maxLength={40} placeholder="e.g. Afrobeat" onChange={(e) => setF({ ...f, genre: e.target.value })} /></div>
        <Select label="Mood / category" value={f.mood} onChange={(v) => setF({ ...f, mood: v })}><option value="">Not set</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select>
        <Select label="Energy" value={f.energy} onChange={(v) => setF({ ...f, energy: v })}><option value="">Not set</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></Select>
        <div className="sm:col-span-2"><label className="text-xs text-zinc-300 block mb-1">Description</label><input className={inp} value={f.description} maxLength={300} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
        <div className="sm:col-span-2"><label className="text-xs text-zinc-300 block mb-1">Licence (required)</label><input className={inp} value={f.license} maxLength={200} placeholder='e.g. "Purchased from <source>, standard licence"' onChange={(e) => setF({ ...f, license: e.target.value })} /></div>
        <Select label="Commercial use allowed?" value={f.commercialOk} onChange={(v) => setF({ ...f, commercialOk: v })}><option value="unknown">I do not know</option><option value="yes">Yes</option><option value="no">No</option></Select>
        <div><label className="text-xs text-zinc-300 block mb-1">Source / purchase reference</label><input className={inp} value={f.source} maxLength={200} onChange={(e) => setF({ ...f, source: e.target.value })} /></div>
        <div className="sm:col-span-2"><label className="text-xs text-zinc-300 block mb-1">Attribution required</label><input className={inp} value={f.attribution} maxLength={200} placeholder="leave empty if none" onChange={(e) => setF({ ...f, attribution: e.target.value })} /></div>
      </div>
      <label className="flex gap-2 items-start text-xs text-zinc-300"><input type="checkbox" checked={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.checked })} className="mt-0.5" />I have the right to use this file in the way I recorded above.</label>
      <div><button className={primary} disabled={busy || !file || !f.license.trim() || !f.confirm} onClick={() => void submit()}>{busy ? 'Analysing and saving…' : 'Add to library'}</button></div>
    </div>
  );
};

export const StudioWorkspace: React.FC<{ onUseSound?: (p: SoundPick) => void; hasVideo: boolean; videoSeconds?: number }> = ({ onUseSound, hasVideo, videoSeconds }) => {
  const [tab, setTab] = useState<Tab>('sonic');
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'sonic', label: 'Sonic Studio', icon: <Music className="w-3.5 h-3.5" /> },
    { id: 'library', label: 'Sound Library', icon: <Music className="w-3.5 h-3.5" /> },
    { id: 'identities', label: 'Identities', icon: <Fingerprint className="w-3.5 h-3.5" /> },
    { id: 'models', label: 'Models & Resources', icon: <Cpu className="w-3.5 h-3.5" /> },
  ];
  return (
    <div className="max-w-6xl mx-auto w-full px-4 py-6 flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold text-white tracking-tight flex items-center gap-2"><Wand2 className="w-5 h-5 text-violet-300" />Creative Studio</h1>
        <span className="text-xs text-zinc-500">Everything here runs on this computer, offline.</span>
        <div className="ml-auto flex gap-1 rounded-full bg-zinc-900/70 border border-white/[0.07] p-1 max-w-full overflow-x-auto" role="tablist">
          {tabs.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] font-medium transition-all ${tab === t.id ? 'bg-white text-zinc-950' : 'text-zinc-400 hover:text-white'}`}>{t.icon}{t.label}</button>)}
        </div>
      </div>
      {tab === 'sonic' && <SonicTab onUseSound={onUseSound} hasVideo={hasVideo} videoSeconds={videoSeconds} />}
      {tab === 'library' && <SoundStudio onUseSound={onUseSound} hasVideo={hasVideo} videoSeconds={videoSeconds} />}
      {tab === 'identities' && <IdentitiesTab />}
      {tab === 'models' && <ModelsTab />}
    </div>
  );
};
