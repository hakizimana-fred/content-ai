'use client';

import { usePlayer } from '@/components/sound/player';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Clapperboard, Upload, Trash2, Loader2, Check, AlertTriangle, ArrowLeft, ArrowRight, RefreshCw, Download, Music, Play, Send, Plus, X, CircleDashed, Sparkles } from 'lucide-react';
import { SectionTitle, Select, Toggle } from '@/components/editor/ui';
import { ModePicker, CreativeLibrary, SceneEditor, CreativePlanPanel, QcPanel, TypographyPicker } from '@/components/AutoIdeaPanels';
import type { AutoAsset, AutoConfig, AutoProject, StageState } from '@/lib/auto/types';
import type { LibraryEntry } from '@/lib/studio/library';

const card = 'rounded-2xl bg-white/[0.03] border border-white/[0.07] p-4';
const btn = 'px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 text-zinc-200 hover:bg-white/5 disabled:opacity-40 transition-colors';
const primary = 'px-5 py-2.5 rounded-xl text-sm font-semibold bg-violet-500 hover:bg-violet-400 disabled:bg-zinc-700 disabled:text-zinc-400 text-white transition-colors flex items-center gap-2';
const input = 'w-full rounded-lg bg-zinc-950/60 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-zinc-600';

async function api<T = any>(url: string, init?: RequestInit): Promise<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(url, init); const d = await r.json().catch(() => ({ success: false, error: 'Unexpected response from the server.' }));
  if (!d.success) throw new Error(d.error || 'Request failed');
  return d;
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const IDEA_EXAMPLES = [
  'Create a 30-second futuristic advertisement for an AI technology company. Use dark backgrounds, elegant animated typography, electronic background music and cinematic transitions.',
  'Make a 20-second elegant luxury brand teaser. "Timeless Craft" in the title, gold accents, calm piano-like atmosphere.',
  'Create an energetic 15-second product announcement. Features: fast setup, simple pricing, friendly support. 3x faster checkout.',
];
const EXAMPLES = [
  'Create a beautiful 30-second promotional video for a restaurant. Make it energetic, modern and appetising, with an upbeat African-inspired soundtrack.',
  'Turn these photographs into an emotional travel montage with smooth camera movements and atmospheric music.',
  'Create a premium advertisement for this product. Make it look luxurious with sophisticated background music.',
];
const SFX_CHOICES: [string, string][] = [['whoosh', 'Whoosh'], ['riser', 'Riser'], ['impact', 'Cinematic impact'], ['bass_impact', 'Bass impact'], ['click', 'Subtle click'], ['stinger', 'Short stinger'], ['notification', 'Notification'], ['electronic_accent', 'Electronic accent'], ['ambient_texture', 'Ambient texture'], ['transition', 'Transition']];
const SOUND_STYLES: [string, string][] = [['cinematic', 'Cinematic'], ['corporate', 'Corporate'], ['luxury', 'Luxury'], ['ambient', 'Ambient'], ['electronic', 'Electronic'], ['african_fusion', 'African Fusion'], ['inspirational', 'Inspirational'], ['dramatic', 'Dramatic'], ['minimal', 'Minimal'], ['experimental', 'Experimental']];
const REFINE_CHIPS = ['Make it more cinematic', 'Change the soundtrack', 'Make the transitions smoother', 'Increase the text size', 'Make the opening more engaging', 'Reduce the background music', 'Use a more energetic soundtrack', 'Remove the second scene'];

const ErrorBox: React.FC<{ msg: string | null; onClose?: () => void }> = ({ msg, onClose }) => msg ? (
  <div role="alert" className="flex gap-2 items-start rounded-xl border border-rose-400/30 bg-rose-400/[0.07] px-3 py-2 text-xs text-rose-200"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span className="flex-1">{msg}</span>{onClose && <button onClick={onClose} aria-label="Dismiss"><X className="w-3.5 h-3.5" /></button>}</div>
) : null;

const StageRow: React.FC<{ s: StageState }> = ({ s }) => (
  <li className="flex gap-3 items-start py-1.5">
    <span className="mt-0.5 shrink-0">{s.status === 'done' ? <Check className="w-4 h-4 text-emerald-400" /> : s.status === 'running' ? <Loader2 className="w-4 h-4 text-violet-300 animate-spin" /> : s.status === 'error' ? <AlertTriangle className="w-4 h-4 text-rose-400" /> : s.status === 'skipped' ? <CircleDashed className="w-4 h-4 text-zinc-600" /> : <span className="block w-4 h-4 rounded-full border border-white/15" />}</span>
    <div className="min-w-0 flex-1">
      <div className={`text-sm ${s.status === 'pending' ? 'text-zinc-500' : 'text-zinc-100'}`}>{s.label}{s.ms ? <span className="text-[11px] text-zinc-500 ml-2">{s.ms >= 1000 ? `${(s.ms / 1000).toFixed(1)} s` : `${s.ms} ms`}</span> : null}</div>
      {s.detail && <div className={`text-xs mt-0.5 break-words ${s.status === 'error' ? 'text-rose-300' : 'text-zinc-400'}`}>{s.detail}</div>}
      {s.status === 'running' && typeof s.progress === 'number' && <div className="mt-1.5 h-1.5 rounded-full bg-white/10 overflow-hidden" role="progressbar" aria-valuenow={s.progress} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-violet-400 transition-all" style={{ width: `${s.progress}%` }} /></div>}
    </div>
  </li>
);

export const AutoStudioWorkspace: React.FC<{ identities?: { id: string; name: string }[] }> = ({ identities = [] }) => {
  const [list, setList] = useState<{ id: string; name: string; assets: number; hasVideo: boolean }[]>([]);
  const [p, setP] = useState<AutoProject | null>(null);
  const [cfg, setCfg] = useState<AutoConfig | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [refineText, setRefineText] = useState(''); const [refineMsg, setRefineMsg] = useState<{ changes: string[]; notes: string[] } | null>(null);
  const [tracks, setTracks] = useState<LibraryEntry[]>([]); const [recs, setRecs] = useState<{ entry: LibraryEntry; score: number; reasons: string[] }[]>([]);
  const [showTracks, setShowTracks] = useState(false); const [dragId, setDragId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null); const replaceRef = useRef<HTMLInputElement>(null); const replaceTarget = useRef<string | null>(null); const player = usePlayer();

  const running = !!p?.render.running;
  const reloadList = useCallback(() => api('/api/auto/projects').then((d) => setList(d.projects)).catch(() => {}), []);
  const load = useCallback(async (id: string) => { const d = await api(`/api/auto/projects?id=${id}`); setP(d.project); setCfg((c) => (c && c !== null && d.project.render.running ? c : d.project.config)); }, []);
  useEffect(() => { void reloadList(); }, [reloadList]);
  // poll for REAL progress while the server is rendering
  useEffect(() => { if (!p || !running) return; const t = setInterval(() => { void load(p.id).catch(() => {}); }, 1000); return () => clearInterval(t); }, [p, running, load]);
  useEffect(() => { if (p && !running && p.render.finishedAt) void reloadList(); }, [p, running, reloadList]);

  const open = async (id: string) => { setErr(null); try { await load(id); const d = await api(`/api/auto/projects?id=${id}`); setCfg(d.project.config); } catch (e) { setErr((e as Error).message); } };
  const create = async () => { setErr(null); try { const d = await api('/api/auto/projects', json('POST', { name: `Video ${list.length + 1}` })); setP(d.project); setCfg(d.project.config); await reloadList(); } catch (e) { setErr((e as Error).message); } };
  const del = async () => { if (!p || !confirm('Delete this project and its media? This cannot be undone.')) return; try { await api(`/api/auto/projects?id=${p.id}`, { method: 'DELETE' }); setP(null); setCfg(null); await reloadList(); } catch (e) { setErr((e as Error).message); } };
  const save = async (patch: Partial<AutoConfig>) => { if (!p) return; const next = { ...(cfg as AutoConfig), ...patch }; setCfg(next); try { const d = await api(`/api/auto/projects?id=${p.id}`, json('PATCH', patch)); setP(d.project); } catch (e) { setErr((e as Error).message); } };

  const upload = async (files: FileList | File[], replaceId?: string) => {
    if (!p) return; setErr(null); const arr = [...files]; const errors: string[] = [];
    for (let i = 0; i < arr.length; i++) {
      setUploading(`Uploading ${arr[i].name} (${i + 1} of ${arr.length})`);
      const fd = new FormData(); fd.append('file', arr[i]); if (replaceId) fd.append('replace', replaceId);
      try { const d = await api(`/api/auto/assets?project=${p.id}`, { method: 'POST', body: fd }); setP(d.project); } catch (e) { errors.push(`${arr[i].name}: ${(e as Error).message}`); }
    }
    setUploading(null); if (errors.length) setErr(errors.join('  •  ')); void reloadList();
  };
  const removeAsset = async (a: AutoAsset) => { if (!p) return; try { const d = await api(`/api/auto/assets?project=${p.id}&asset=${a.id}`, { method: 'DELETE' }); setP(d.project); } catch (e) { setErr((e as Error).message); } };
  const reorder = async (order: string[]) => { if (!p) return; try { const d = await api(`/api/auto/assets?project=${p.id}`, json('PUT', { order })); setP(d.project); } catch (e) { setErr((e as Error).message); } };
  const move = (a: AutoAsset, dir: -1 | 1) => { if (!p) return; const ids = p.assets.map((x) => x.id), i = ids.indexOf(a.id), j = i + dir; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; void reorder(ids); };
  const dropOn = (target: AutoAsset) => { if (!p || !dragId || dragId === target.id) return; const ids = p.assets.map((x) => x.id).filter((x) => x !== dragId); ids.splice(ids.indexOf(target.id), 0, dragId); setDragId(null); void reorder(ids); };

  const create_ = async () => {
    if (!p || !cfg) return; setErr(null); setRefineMsg(null);
    try { const d = await api(`/api/auto/projects?id=${p.id}`, json('PATCH', cfg)); setP(d.project); await api(`/api/auto/render?project=${p.id}`, { method: 'POST' }); await load(p.id); }
    catch (e) { setErr((e as Error).message); }
  };
  const cancel = async () => { if (!p) return; try { await api(`/api/auto/render?project=${p.id}`, { method: 'DELETE' }); } catch (e) { setErr((e as Error).message); } };
  const doRefine = async (text: string) => {
    if (!p || !text.trim()) return; setErr(null); setRefineMsg(null);
    try { const d = await api(`/api/auto/refine?project=${p.id}`, json('POST', { instruction: text })); setP(d.project); setCfg(d.project.config); setRefineMsg({ changes: d.changes, notes: d.notes }); if (d.understood) setRefineText(''); if (d.startError) setErr(d.startError); if (d.started) await load(p.id); }
    catch (e) { setErr((e as Error).message); }
  };
  const loadTracks = async () => { if (!p) return; try { const [a, b] = await Promise.all([api('/api/studio/sound'), api(`/api/auto/soundtracks?project=${p.id}`)]); setTracks((a.library as LibraryEntry[]).filter((x) => x.kind === 'music')); setRecs(b.recommendations); setShowTracks(true); } catch (e) { setErr((e as Error).message); } };
  const auditionSfx = async (kind: string, label: string) => {
    try { const r = await fetch('/api/studio/sound', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sfx: kind, seed: 1 + (cfg?.sfxVariation ?? 0) * 7919 }) }); const j = await r.json(); if (j.success && j.items?.[0]) player.toggle({ id: j.items[0].id, title: label, src: `/api/studio/sound/file?id=${j.items[0].id}` }); } catch { /* preview is best-effort */ }
  };
  const preview = (id: string, title = 'Soundtrack') => player.toggle({ id, title, src: `/api/studio/sound/file?id=${id}` });

  const used = new Map<string, number>(); p?.timeline?.shots.forEach((s, i) => { if (!used.has(s.assetId)) used.set(s.assetId, i + 1); });
  const left = new Map((p?.timeline?.dropped ?? []).map((d) => [d.assetId, d.why]));
  const media = p?.assets.filter((a) => a.kind !== 'audio') ?? [];
  const needsMedia = !!cfg && ((cfg.mode ?? 'video') === 'video' || cfg.mode === 'image');
  const canCreate = !!p && !!cfg && (!needsMedia || media.length > 0) && cfg.prompt.trim().length > 0 && !running && !uploading;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-white"><Clapperboard className="w-5 h-5 text-violet-300" /><h1 className="text-lg font-semibold">Auto Studio</h1></div>
        <span className="text-xs text-zinc-500 hidden sm:inline">Add your photos and videos, describe the video, and it is edited for you. Everything runs on this computer.</span>
        <div className="ml-auto flex items-center gap-2">
          {list.length > 0 && <select aria-label="Project" value={p?.id ?? ''} onChange={(e) => e.target.value && void open(e.target.value)} className="rounded-lg bg-zinc-900 border border-white/10 text-xs text-zinc-200 px-2 py-1.5 max-w-[200px]"><option value="">Open a project…</option>{list.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.assets})</option>)}</select>}
          <button className={btn} onClick={() => void create()}><span className="flex items-center gap-1"><Plus className="w-3.5 h-3.5" />New video</span></button>
        </div>
      </div>
      <ErrorBox msg={err} onClose={() => setErr(null)} />

      {!p || !cfg ? (
        <div className={`${card} text-center py-14`}>
          <Clapperboard className="w-9 h-9 mx-auto text-violet-300/80 mb-3" />
          <p className="text-zinc-200 text-sm mb-1">Make a finished short video from ordinary photos and clips.</p>
          <p className="text-zinc-500 text-xs mb-5">Upload media, say what you want, press Create. No timeline needed.</p>
          <button className={`${primary} mx-auto`} onClick={() => void create()}><Plus className="w-4 h-4" />Start a new video</button>
        </div>
      ) : (<>
        <ModePicker mode={cfg.mode ?? 'video'} disabled={running} onChange={(m) => void save({ mode: m })} />
        {(cfg.mode ?? 'video') === 'idea' ? <div className={`${card} text-xs text-zinc-400`}>Idea-to-Video needs no uploads: scenes, animation, typography and sound are generated on this computer from your description. Every word on screen comes from your instruction or the fields below.</div> : null}
        {(cfg.mode ?? 'video') !== 'idea' && <>
        {/* 1. MEDIA */}
        <section className={card} aria-label="Media tray">
          <div className="flex items-center justify-between mb-2"><SectionTitle hint="Photos (JPEG, PNG, WebP), videos (MP4, MOV, WebM) and optional music (MP3, WAV, M4A). Drag to reorder.">1 · Your media</SectionTitle>
            <div className="flex gap-2"><button className={btn} disabled={running || !!uploading} onClick={() => fileRef.current?.click()}><span className="flex items-center gap-1"><Upload className="w-3.5 h-3.5" />Add files</span></button><button className={btn} disabled={running} onClick={() => void del()}><Trash2 className="w-3.5 h-3.5" /></button></div></div>
          <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,audio/mpeg,audio/wav,audio/mp4,audio/ogg,audio/flac,.mp4,.mov,.webm,.jpg,.jpeg,.png,.webp,.mp3,.wav,.m4a,.ogg,.flac" className="hidden" onChange={(e) => { if (e.target.files?.length) void upload(e.target.files); e.target.value = ''; }} />
          <input ref={replaceRef} type="file" className="hidden" accept="image/*,video/*,audio/*" onChange={(e) => { if (e.target.files?.[0] && replaceTarget.current) void upload([e.target.files[0]], replaceTarget.current); e.target.value = ''; }} />
          {p.assets.length === 0 ? (
            <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) void upload(e.dataTransfer.files); }} onClick={() => fileRef.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && fileRef.current?.click()}
              className="border border-dashed border-white/15 rounded-xl py-10 text-center text-sm text-zinc-400 cursor-pointer hover:border-violet-400/50 hover:text-zinc-200 transition-colors"><Upload className="w-6 h-6 mx-auto mb-2 text-zinc-500" />Drop photos and videos here, or click to choose</div>
          ) : (
            <ul className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-3" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) void upload(e.dataTransfer.files); }}>
              {p.assets.map((a, i) => (
                <li key={a.id} draggable={!running} onDragStart={() => setDragId(a.id)} onDragEnd={() => setDragId(null)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.stopPropagation(); dropOn(a); }} className={`group relative rounded-xl overflow-hidden border bg-zinc-900/60 ${dragId === a.id ? 'opacity-40 border-violet-400' : 'border-white/10'}`}>
                  <div className="aspect-square bg-zinc-950 flex items-center justify-center">
                    {a.thumb ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={`/api/auto/asset-file?project=${p.id}&asset=${a.id}&thumb=1`} alt={a.name} className="w-full h-full object-cover" draggable={false} /> : <Music className="w-7 h-7 text-zinc-500" />}
                  </div>
                  <div className="absolute top-1.5 left-1.5 flex gap-1"><span className="px-1.5 py-0.5 rounded bg-black/70 text-[10px] text-zinc-200 uppercase tracking-wide">{a.kind}{a.kind !== 'photo' ? ` ${fmtDur(a.duration)}` : ''}</span>{used.has(a.id) && <span className="px-1.5 py-0.5 rounded bg-violet-500/80 text-[10px] text-white">shot {used.get(a.id)}</span>}{left.has(a.id) && !used.has(a.id) && <span title={left.get(a.id)} className="px-1.5 py-0.5 rounded bg-amber-500/80 text-[10px] text-black">left out</span>}</div>
                  <div className="p-2"><div className="truncate text-[11px] text-zinc-300" title={a.name}>{a.name}</div>{left.has(a.id) && !used.has(a.id) && <div className="text-[10px] text-amber-300/90 leading-tight mt-0.5">{left.get(a.id)}</div>}</div>
                  {!running && <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button aria-label="Move earlier" disabled={i === 0} onClick={() => move(a, -1)} className="p-1 rounded bg-black/70 text-white disabled:opacity-30"><ArrowLeft className="w-3 h-3" /></button>
                    <button aria-label="Move later" disabled={i === p.assets.length - 1} onClick={() => move(a, 1)} className="p-1 rounded bg-black/70 text-white disabled:opacity-30"><ArrowRight className="w-3 h-3" /></button>
                    <button aria-label="Replace" onClick={() => { replaceTarget.current = a.id; replaceRef.current?.click(); }} className="p-1 rounded bg-black/70 text-white"><RefreshCw className="w-3 h-3" /></button>
                    <button aria-label="Remove" onClick={() => void removeAsset(a)} className="p-1 rounded bg-black/70 text-rose-300"><X className="w-3 h-3" /></button></div>}
                </li>
              ))}
            </ul>
          )}
          {uploading && <div className="mt-3 flex items-center gap-2 text-xs text-zinc-300"><Loader2 className="w-3.5 h-3.5 animate-spin" />{uploading}</div>}
          {p.assets.some((a) => a.kind === 'audio') && <p className="text-[11px] text-zinc-500 mt-2">Your uploaded audio is used as the soundtrack. Confirm you hold the rights to it.</p>}
        </section>

        </>}
        {((cfg.mode ?? 'video') === 'idea' || cfg.mode === 'mixed') && <CreativeLibrary selected={cfg.creativeAssetIds ?? []} disabled={running} onSelect={(ids) => void save({ creativeAssetIds: ids })} />}
        {/* 2. INSTRUCTION */}
        <section className={card} aria-label="Creative instruction">
          <SectionTitle hint="Say what you want in your own words: the mood, the music, the style.">2 · Describe the video</SectionTitle>
          <textarea value={cfg.prompt} onChange={(e) => setCfg({ ...cfg, prompt: e.target.value })} onBlur={() => void save({ prompt: cfg.prompt })} disabled={running} rows={4} maxLength={1500} placeholder={(cfg.mode === 'idea' ? IDEA_EXAMPLES : EXAMPLES)[0]} aria-label="Creative instruction" className={`${input} text-base leading-relaxed resize-y`} />
          <div className="flex flex-wrap gap-2 mt-2">{(cfg.mode === 'idea' ? IDEA_EXAMPLES : EXAMPLES).map((e, i) => <button key={i} disabled={running} className="text-[11px] px-2.5 py-1 rounded-full border border-white/10 text-zinc-400 hover:text-white hover:border-white/25 text-left" onClick={() => { setCfg({ ...cfg, prompt: e }); void save({ prompt: e }); }}>{(cfg.mode === 'idea' ? ['Futuristic AI ad', 'Luxury teaser', 'Product announcement'] : ['Restaurant promo', 'Travel montage', 'Luxury product ad'])[i]}</button>)}</div>
        </section>

        {((cfg.mode ?? 'video') === 'idea' || cfg.mode === 'mixed') && <CreativePlanPanel project={p} disabled={running} onChanged={() => load(p.id)} />}
        {/* 3. CONFIG */}
        <section className={card} aria-label="Production settings">
          <SectionTitle>3 · Settings</SectionTitle>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div><div className="text-xs text-zinc-300 mb-1">Format</div><div className="flex gap-1.5" role="radiogroup" aria-label="Video format">{([['9:16', 'TikTok / Reels / Shorts'], ['16:9', 'Landscape'], ['1:1', 'Square']] as const).map(([v, l]) => <button key={v} role="radio" aria-checked={cfg.format === v} disabled={running} onClick={() => void save({ format: v })} className={`flex-1 px-2 py-2 rounded-lg text-[11px] border leading-tight ${cfg.format === v ? 'bg-violet-500/20 border-violet-400/60 text-white' : 'border-white/10 text-zinc-400 hover:text-white'}`}><div className="font-semibold text-xs">{v}</div>{l}</button>)}</div></div>
            <div><div className="text-xs text-zinc-300 mb-1">Duration</div><div className="flex gap-1.5 items-center">{[15, 30, 45, 60].map((d) => <button key={d} disabled={running} onClick={() => void save({ durationSec: d })} className={`px-2.5 py-2 rounded-lg text-xs border ${cfg.durationSec === d ? 'bg-violet-500/20 border-violet-400/60 text-white' : 'border-white/10 text-zinc-400 hover:text-white'}`}>{d}s</button>)}<input aria-label="Custom duration in seconds" type="number" min={5} max={180} disabled={running} value={cfg.durationSec} onChange={(e) => setCfg({ ...cfg, durationSec: Number(e.target.value) })} onBlur={() => void save({ durationSec: Math.max(5, Math.min(180, Number(cfg.durationSec) || 30)) })} className="w-16 rounded-lg bg-zinc-950/60 border border-white/10 px-2 py-2 text-xs text-white" /></div></div>
            <Select label="Creative style" value={cfg.style} onChange={(v) => void save({ style: v as AutoConfig['style'] })}><option value="auto">Automatic (from your instruction)</option><option value="commercial">Commercial</option><option value="cinematic">Cinematic</option><option value="documentary">Documentary</option><option value="social">Social</option></Select>
            <Select label="Audio" value={cfg.audioMode} onChange={(v) => void save({ audioMode: v as AutoConfig['audioMode'] })}><option value="auto">Automatic soundtrack selection</option><option value="library">Choose from the sound library</option><option value="generate">Generate a soundtrack</option><option value="original">Original audio only</option><option value="none">No background music</option></Select>
            <div><label className="text-xs text-zinc-300 block mb-1" htmlFor="as-head">Opening headline (optional)</label><input id="as-head" className={input} maxLength={80} disabled={running} value={cfg.headline ?? ''} placeholder="Your own words" onChange={(e) => setCfg({ ...cfg, headline: e.target.value })} onBlur={() => void save({ headline: cfg.headline ?? '' })} /></div>
            <div><label className="text-xs text-zinc-300 block mb-1" htmlFor="as-cta">Closing message (optional)</label><input id="as-cta" className={input} maxLength={80} disabled={running} value={cfg.cta ?? ''} placeholder="e.g. Book your table today" onChange={(e) => setCfg({ ...cfg, cta: e.target.value })} onBlur={() => void save({ cta: cfg.cta ?? '' })} /></div>
            {((cfg.mode ?? 'video') === 'idea' || cfg.mode === 'mixed') && <TypographyPicker value={cfg.fontAssetId} disabled={running} onChange={(id) => void save({ fontAssetId: (id ?? null) as never })} />}
            <Select label="Frame rate" value={String(cfg.fps ?? 30)} onChange={(v) => void save({ fps: Number(v) as 24 | 30 })}><option value="30">30 fps (smooth)</option><option value="24">24 fps (cinematic, faster to render)</option></Select>
            <div className="flex items-center gap-2.5 sm:col-span-2 lg:col-span-1"><Toggle checked={!!cfg.commercial} onChange={(x) => void save({ commercial: x })} label="Commercial use" /><span className="text-xs text-zinc-300">Commercial use (block assets without a commercial licence)</span></div>
            {identities.length > 0 && <Select label="Creative identity (brand kit)" value={cfg.identityId ?? ''} onChange={(v) => void save({ identityId: v || undefined })}><option value="">None</option>{identities.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</Select>}
          </div>
          {cfg.identityId && <p className="text-[11px] text-violet-200/80 mt-2" data-testid="brand-note">The Creative Director will use this brand&apos;s logo, palette and tagline: logo reveal at the start, a branded ending, and video colours taken from your palette. Edit it in Studio → Identities (the logo is never altered).</p>}
          <p className="text-[11px] text-zinc-500 mt-2">Headline and closing text only ever use the words you type: nothing about your business is invented.</p>
          <div className="grid sm:grid-cols-3 gap-3 mt-4">{([['Captions from speech', cfg.captions, 'captions'], ['Keep my media order', cfg.keepOrder, 'keepOrder'], ['Use the local AI model to read my instruction (slower)', !!cfg.useModel, 'useModel']] as const).map(([l, v, k]) => <div key={k} className="flex items-center gap-2.5"><Toggle checked={v} onChange={(x) => void save({ [k]: x })} label={l} /><span className="text-xs text-zinc-300">{l}</span></div>)}</div>
          {(cfg.audioMode === 'auto' || cfg.audioMode === 'library') && !cfg.soundtrackId && <div className="mt-4 border-t border-white/[0.06] pt-3" data-testid="style-picker">
            <div className="text-xs text-zinc-300 mb-1">Compose the soundtrack from styles (optional)</div>
            <div className="flex flex-wrap gap-1.5">{SOUND_STYLES.map(([id, l]) => { const on = (cfg.soundtrackStyles ?? []).includes(id); return <button key={id} type="button" aria-pressed={on} data-testid={`auto-style-${id}`} disabled={running} onClick={() => { const cur = cfg.soundtrackStyles ?? []; void save({ soundtrackStyles: on ? cur.filter((x) => x !== id) : [...cur, id].slice(0, 4) }); }} className={`px-2.5 py-1 rounded-full text-[11px] border ${on ? 'bg-violet-500/30 border-violet-300/60 text-white' : 'border-white/10 text-zinc-300 hover:bg-white/5'}`}>{l}</button>; })}</div>
            {(cfg.soundtrackStyles?.length ?? 0) > 0 && <div className="flex items-center gap-3 mt-2 text-[11px] text-zinc-400"><label>Alternatives to save: {cfg.soundtrackVariations ?? 1}<input type="range" min={1} max={4} value={cfg.soundtrackVariations ?? 1} onChange={(e) => void save({ soundtrackVariations: Number(e.target.value) })} className="ml-2 align-middle accent-violet-400" aria-label="Soundtrack variations" /></label><span>The engine blends these into one real composition for your video; extra variations are saved to your Sound Library.</span></div>}
          </div>}
          {cfg.audioMode !== 'original' && cfg.audioMode !== 'none' && <div className="mt-4 border-t border-white/[0.06] pt-3" data-testid="sfx-picker">
            <div className="text-xs text-zinc-300 mb-1">Sound effects on the transitions (optional)</div>
            <div className="flex flex-wrap gap-1.5">{SFX_CHOICES.map(([id, l]) => { const on = (cfg.sfxKinds ?? []).includes(id); return <span key={id} className={`inline-flex items-center rounded-full border text-[11px] ${on ? 'bg-violet-500/30 border-violet-300/60 text-white' : 'border-white/10 text-zinc-300'}`}>
              <button type="button" aria-pressed={on} data-testid={`auto-sfx-${id}`} disabled={running} onClick={() => { const cur = cfg.sfxKinds ?? []; void save({ sfxKinds: on ? cur.filter((x) => x !== id) : [...cur, id].slice(0, 6) }); }} className="pl-2.5 pr-1.5 py-1 rounded-l-full hover:bg-white/5">{l}</button>
              <button type="button" aria-label={`Hear ${l}`} title="Hear this effect" onClick={() => void auditionSfx(id, l)} className="pr-2 pl-1 py-1 rounded-r-full text-zinc-400 hover:text-white"><Play className="w-3 h-3" /></button></span>; })}</div>
            <div className="flex items-center gap-3 mt-2 text-[11px] text-zinc-400"><button type="button" data-testid="sfx-variation" disabled={running} onClick={() => void save({ sfxVariation: (cfg.sfxVariation ?? 0) + 1 })} className="px-2.5 py-1 rounded-full border border-white/10 text-zinc-200 hover:bg-white/5 inline-flex items-center gap-1.5"><RefreshCw className="w-3 h-3" />New variation</button><span>{(cfg.sfxKinds?.length ?? 0) > 0 ? `Your chosen effects take turns on the transitions. Variation ${(cfg.sfxVariation ?? 0) + 1}: each press renders different takes.` : 'Nothing chosen: effects are picked automatically to suit the style. Choose some to take control.'}</span></div>
          </div>}
          {(cfg.audioMode === 'library' || cfg.audioMode === 'auto') && <div className="mt-4 border-t border-white/[0.06] pt-3">
            <div className="flex items-center gap-2 flex-wrap"><button className={btn} onClick={() => void loadTracks()} disabled={running}>Browse soundtracks</button>{cfg.soundtrackId && <span className="text-xs text-violet-200">Chosen: {tracks.find((t) => t.id === cfg.soundtrackId)?.label ?? cfg.soundtrackId} <button className="underline ml-1 text-zinc-400" onClick={() => void save({ soundtrackId: null as never })}>clear</button></span>}</div>
            {showTracks && <div className="mt-3 grid gap-2 max-h-72 overflow-auto pr-1">
              {recs.length > 0 && <div className="text-[11px] uppercase tracking-wider text-zinc-500">Recommended for this video</div>}
              {(recs.length ? recs.map((r) => ({ t: r.entry, why: r.reasons.join(', ') })) : tracks.map((t) => ({ t, why: '' }))).map(({ t, why }) => (
                <div key={t.id} className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${cfg.soundtrackId === t.id ? 'border-violet-400/60 bg-violet-500/10' : 'border-white/10'}`}>
                  <button aria-label={`Preview ${t.label}`} className="p-1.5 rounded-full bg-white/10 hover:bg-white/20" onClick={() => preview(t.id, t.label)}><Play className="w-3.5 h-3.5 text-white" /></button>
                  <div className="min-w-0 flex-1"><div className="text-sm text-zinc-100 truncate">{t.favourite ? '★ ' : ''}{t.label}</div><div className="text-[11px] text-zinc-500 truncate">{t.genreLabel} · {t.tempo ? `${Math.round(t.tempo)} BPM` : 'tempo unknown'} · {t.energyLevel} energy · {fmtDur(t.seconds)}{why ? ` · ${why}` : ''}</div></div>
                  <button className={btn} onClick={() => void save({ soundtrackId: t.id, audioMode: 'library' })}>Use</button>
                </div>))}
              {tracks.length === 0 && <p className="text-xs text-zinc-500">The sound library is empty. A soundtrack will be generated for you, or create some in Studio → Sound Library.</p>}
            </div>}
          </div>}
        </section>

        {/* CREATE */}
        <div className="flex items-center gap-3 flex-wrap">
          <button className={primary} disabled={!canCreate} onClick={() => void create_()}>{running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}{running ? 'Making your video…' : p.render.outputFile ? 'Create again' : 'CREATE'}</button>
          <div className="flex rounded-lg border border-white/10 overflow-hidden text-xs" role="radiogroup" aria-label="Render quality">{([['preview', 'Preview (fast, half size)'], ['final', 'Final (full size)']] as const).map(([q, l]) => <button key={q} role="radio" aria-checked={(cfg.quality ?? 'final') === q} disabled={running} onClick={() => void save({ quality: q })} className={`px-3 py-2 ${(cfg.quality ?? 'final') === q ? 'bg-violet-500/25 text-white' : 'text-zinc-400 hover:text-white'}`}>{l}</button>)}</div>
          {running && <button className={btn} onClick={() => void cancel()}>Cancel</button>}
          {!canCreate && !running && <span className="text-xs text-zinc-500">{needsMedia && media.length === 0 ? 'Add at least one photo or video, or switch to Idea-to-Video.' : !cfg.prompt.trim() ? 'Describe the video you want.' : ''}</span>}
        </div>

        {/* PROGRESS */}
        {p.render.stages.length > 0 && <section className={card} aria-label="Progress" aria-live="polite">
          <SectionTitle hint="Each step shows what the computer is really doing. Percentages come from the actual work, not a timer.">Progress</SectionTitle>
          <ol>{p.render.stages.map((s) => <StageRow key={s.id} s={s} />)}</ol>
          {p.render.error && <div className="mt-2"><ErrorBox msg={p.render.error} /></div>}
        </section>}

        {/* RESULT */}
        {p.render.outputUrl && !running && <section className={card} aria-label="Result">
          <SectionTitle>Your video</SectionTitle>
          <div className="grid md:grid-cols-[auto,1fr] gap-5">
            <div className={`mx-auto ${p.timeline && p.timeline.w > p.timeline.h ? 'w-full max-w-xl' : 'w-60'}`}><video key={p.render.outputFile} src={p.render.outputUrl} controls playsInline className="w-full rounded-xl bg-black" /></div>
            <div className="min-w-0 flex flex-col gap-3">
              <div className="flex flex-wrap gap-2 items-center"><a className={`${primary} !py-2 no-underline`} href={`${p.render.outputUrl}&download=1`}><Download className="w-4 h-4" />Export MP4</a><span className="text-xs text-zinc-500">{p.render.outputSeconds?.toFixed(1)} s · {p.timeline?.w}×{p.timeline?.h}</span></div>
              {p.timeline?.notes.map((n, i) => <div key={i} className="text-xs text-amber-200/90 flex gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{n}</div>)}
              {p.render.qc && <QcPanel qc={p.render.qc} />}
              {p.render.applied && <details open className="text-xs"><summary className="cursor-pointer text-zinc-300 mb-1">What was done</summary><ul className="list-disc ml-5 text-zinc-400 space-y-0.5">{p.render.applied.map((a, i) => <li key={i}>{a}</li>)}</ul></details>}
              {p.render.skipped && p.render.skipped.length > 0 && <details className="text-xs"><summary className="cursor-pointer text-amber-200/90 mb-1">What could not be done</summary><ul className="list-disc ml-5 text-zinc-400 space-y-0.5">{p.render.skipped.map((a, i) => <li key={i}>{a}</li>)}</ul></details>}
              {cfg.quality === 'preview' && p.timeline && <div className="flex items-center gap-2 flex-wrap rounded-lg border border-amber-400/30 bg-amber-400/[0.06] px-3 py-2 text-xs text-amber-100">This is a half-resolution preview. <button className={btn} onClick={async () => { await save({ quality: 'final' }); await api(`/api/auto/render?project=${p.id}`, { method: 'POST' }).catch((e) => setErr(e.message)); await load(p.id); }}>Render final</button></div>}
              {p.timeline && p.timeline.shots.some((s) => s.scene) && <SceneEditor key={p.render.outputFile} scenes={p.timeline.shots.filter((s) => s.scene).map((s) => s.scene!)} disabled={running} onApply={async (edits) => { const merged = { ...(cfg.sceneEdits ?? {}) }; for (const [k, v] of Object.entries(edits)) merged[k] = { ...(merged[k] ?? {}), ...v }; await save({ sceneEdits: merged }); await api(`/api/auto/render?project=${p.id}`, { method: 'POST' }).catch((e) => setErr(e.message)); await load(p.id); }} />}
              {p.timeline && <details className="text-xs"><summary className="cursor-pointer text-zinc-300 mb-1">Why each shot was chosen</summary><ol className="ml-5 list-decimal text-zinc-400 space-y-1">{p.timeline.shots.map((s) => <li key={s.id}><span className="text-zinc-200">{p.assets.find((a) => a.id === s.assetId)?.name ?? (s.scene ? `${s.scene.kind} scene${s.scene.title ? `: ${s.scene.title}` : ''}` : 'media')}</span> · {s.len.toFixed(1)} s{s.motion ? ` · ${s.motion.replace('_', ' ')}` : ''}{s.transitionOut ? ` → ${s.transitionOut.type}` : ''}<div className="text-zinc-500">{s.why}</div></li>)}</ol></details>}
            </div>
          </div>
          {/* REFINE */}
          <div className="mt-5 border-t border-white/[0.06] pt-4">
            <SectionTitle hint="Ask for a change in plain English. Only the affected parts are rebuilt (a music change does not re-render the pictures).">Refine</SectionTitle>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void doRefine(refineText); }}><input aria-label="Change request" className={input} value={refineText} maxLength={400} onChange={(e) => setRefineText(e.target.value)} placeholder="e.g. Make the transitions smoother" /><button type="submit" className={primary} disabled={!refineText.trim()}><Send className="w-4 h-4" />Apply</button></form>
            <div className="flex flex-wrap gap-1.5 mt-2">{REFINE_CHIPS.map((c) => <button key={c} className="text-[11px] px-2.5 py-1 rounded-full border border-white/10 text-zinc-400 hover:text-white hover:border-white/25" onClick={() => void doRefine(c)}>{c}</button>)}</div>
            {refineMsg && <div className="mt-3 text-xs space-y-1">{refineMsg.changes.map((c, i) => <div key={i} className="text-emerald-300 flex gap-1.5"><Check className="w-3.5 h-3.5 shrink-0 mt-0.5" />{c}</div>)}{refineMsg.notes.map((c, i) => <div key={i} className="text-amber-200">{c}</div>)}</div>}
            {p.history.length > 0 && <div className="mt-3 text-[11px] text-zinc-500">Changes so far: {p.history.map((h) => `“${h.text}”`).join(' → ')}</div>}
          </div>
        </section>}
      </>)}
    </div>
  );
};
