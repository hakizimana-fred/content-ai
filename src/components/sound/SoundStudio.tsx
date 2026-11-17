'use client';
// Soundtrack Library + composer. Styles are ingredients: the engine blends them into genuinely different variations (real synthesis, real WAV files).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Download, Heart, Layers, Loader2, RefreshCw, Search, Sparkles, Trash2, Wand2, X } from 'lucide-react';
import { Artwork, PlayButton, fmtTime, usePlayer, type PlayerTrack } from './player';
import { DurationPicker } from './DurationPicker';

export type SoundPick = { mood: string; intensity: string; seed: number; overrides: Record<string, unknown> };
interface Entry { id: string; kind: 'music' | 'sfx'; label: string; mood?: string; intensity?: string; seed: number; seconds: number; overrides?: Record<string, unknown>; createdAt: number; imported?: boolean; styles?: string[]; character?: string; group?: string; structure?: { sections: string[]; introPadSec?: number; outroPadSec?: number };
  arrangement?: { notes: string[]; contributions: Record<string, string>; bpm: number; leader: string }; tempo: number | null; energyLevel: 'low' | 'medium' | 'high'; genreLabel: string; descriptionText: string; favourite: boolean; license: { license: string; commercialOk: boolean | null; attribution: string; note: string } }
interface StyleInfo { id: string; label: string; blurb: string }
interface Meta { styles: StyleInfo[]; limits: { maxSeconds: number; maxVariations: number }; tier: string; library: Entry[] }

async function api<T = any>(url: string, init?: RequestInit): Promise<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(url, init); const d = await r.json(); if (!d.success) throw new Error(d.error || 'Request failed'); return d;
}
const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const trackOf = (e: Entry): PlayerTrack => ({ id: e.id, title: e.label, subtitle: `${e.genreLabel} · ${e.tempo ? Math.round(e.tempo) + ' BPM' : 'tempo n/a'}`, src: `/api/studio/sound/file?id=${e.id}`, durationHint: e.seconds });
const glass = 'rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl';
const chip = (on: boolean) => `px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${on ? 'bg-violet-500/30 border-violet-300/60 text-white' : 'border-white/10 text-zinc-300 hover:bg-white/5'}`;
const energyBar = (l: string) => (l === 'high' ? 3 : l === 'medium' ? 2 : 1);

const TrackCard: React.FC<{ e: Entry; selected: boolean; onSelect: () => void; onFav: () => void; onDelete: () => void; compact?: boolean }> = ({ e, selected, onSelect, onFav, onDelete, compact }) => {
  const p = usePlayer(); const mine = p.track?.id === e.id;
  return (
    <li data-testid={`track-${e.id}`} className={`${glass} p-3 flex gap-3 items-center ${selected ? 'ring-2 ring-violet-400/70' : ''} ${mine ? 'bg-violet-500/10' : ''}`}>
      <Artwork id={e.id} className={compact ? 'w-12 h-12 shrink-0' : 'w-16 h-16 shrink-0'} playing={mine && p.playing} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-white truncate">{e.label}</div>
        <div className="text-[11px] text-zinc-400 truncate">{e.genreLabel}{e.mood ? ` · ${e.mood.replace(/_/g, ' ')}` : ''}</div>
        <div className="text-[11px] text-zinc-500 flex flex-wrap items-center gap-x-2">
          <span>{fmtTime(e.seconds)}</span><span>{e.tempo ? `${Math.round(e.tempo)} BPM` : '– BPM'}</span>
          <span className="inline-flex items-center gap-0.5" title={`${e.energyLevel} energy`}>{[1, 2, 3].map((i) => <i key={i} className={`w-1 rounded-sm ${i <= energyBar(e.energyLevel) ? 'bg-violet-300' : 'bg-white/15'}`} style={{ height: 4 + i * 3 }} />)}</span>
          <span className={e.license.commercialOk ? 'text-emerald-300' : 'text-amber-300'}>{e.license.commercialOk ? 'commercial OK' : e.license.commercialOk === false ? 'non-commercial' : 'licence unconfirmed'}</span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button type="button" onClick={onFav} aria-pressed={e.favourite} aria-label={e.favourite ? 'Remove favourite' : 'Favourite'} className="p-1.5 rounded-full hover:bg-white/10"><Heart className={`w-4 h-4 ${e.favourite ? 'fill-rose-400 text-rose-400' : 'text-zinc-400'}`} /></button>
        <button type="button" onClick={onSelect} aria-pressed={selected} aria-label={selected ? `Deselect ${e.label}` : `Select ${e.label}`} className={`w-7 h-7 grid place-items-center rounded-md border ${selected ? 'bg-violet-500 border-violet-300' : 'border-white/20 hover:bg-white/10'}`}>{selected && <Check className="w-4 h-4 text-white" />}</button>
        <PlayButton track={trackOf(e)} size="sm" />
        <a href={`/api/studio/sound/file?id=${e.id}&download=1`} download aria-label={`Download ${e.label}`} title="Download this track" data-testid={`download-${e.id}`} className="p-1.5 rounded-full text-zinc-400 hover:text-white hover:bg-white/10"><Download className="w-3.5 h-3.5" /></a>
        <button type="button" onClick={onDelete} aria-label={`Delete ${e.label}`} className="p-1.5 rounded-full text-zinc-500 hover:text-rose-300 hover:bg-white/10"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
    </li>
  );
};

export const SoundStudio: React.FC<{ onUseSound?: (p: SoundPick) => void; hasVideo: boolean; videoSeconds?: number }> = ({ onUseSound, hasVideo, videoSeconds }) => {
  const [meta, setMeta] = useState<Meta | null>(null); const [err, setErr] = useState<string | null>(null); const [loading, setLoading] = useState(true);
  const [styles, setStyles] = useState<string[]>([]); const [variations, setVariations] = useState(3); const [seconds, setSeconds] = useState(30); const [introPad, setIntroPad] = useState(0); const [outroPad, setOutroPad] = useState(0); const [intensity, setIntensity] = useState('medium');
  const [busy, setBusy] = useState(false); const [group, setGroup] = useState<string[]>([]); const [notes, setNotes] = useState<string[]>([]);
  const [genre, setGenre] = useState(''); const [q, setQ] = useState(''); const [favOnly, setFavOnly] = useState(false); const [sel, setSel] = useState<string[]>([]); const [seedBump, setSeedBump] = useState(1);
  const load = useCallback(async () => { try { setMeta(await api<Meta>('/api/studio/sound')); setErr(null); } catch (e) { setErr((e as Error).message); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  const player = usePlayer();
  const music = useMemo(() => (meta?.library ?? []).filter((x) => x.kind === 'music'), [meta]);
  const byId = useMemo(() => new Map(music.map((m) => [m.id, m])), [music]);
  const compose = async () => {
    if (!styles.length) return setErr('Choose at least one style to compose from.'); setBusy(true); setErr(null);
    try { const d = await api('/api/studio/sound', post({ styles, variations: Math.min(variations, meta?.limits.maxVariations ?? 2), seconds: Math.min(seconds, meta?.limits.maxSeconds ?? 60), intensity, introPadSec: introPad || undefined, outroPadSec: outroPad || undefined, seed: 100 + seedBump * 17 })); setGroup((d.items as { id: string }[]).map((i) => i.id)); setNotes(d.interpreted ?? []); setSeedBump((n) => n + 1); await load(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const toggleSel = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(-4)));
  const fav = async (e: Entry) => { try { await api('/api/studio/sound/favourite', post({ id: e.id, on: !e.favourite })); await load(); } catch (x) { setErr((x as Error).message); } };
  const del = async (e: Entry) => { if (!window.confirm(`Delete "${e.label}"? This removes the audio file.`)) return; if (player.track?.id === e.id) player.close(); try { await api(`/api/studio/sound?id=${e.id}`, { method: 'DELETE' }); setSel((s) => s.filter((x) => x !== e.id)); setGroup((g) => g.filter((x) => x !== e.id)); await load(); } catch (x) { setErr((x as Error).message); } };

  const matches = (e: Entry) => (!genre || (e.styles ?? []).includes(genre) || e.genreLabel.toLowerCase().includes(genre.toLowerCase()) || e.mood === genre.toLowerCase()) && (!favOnly || e.favourite) && (!q || `${e.label} ${e.genreLabel} ${e.mood ?? ''} ${e.character ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const shown = music.filter(matches), recent = music.slice(0, 4), featured = music.filter((m) => m.favourite).slice(0, 4);
  const recommended = music.filter((m) => m.styles && m.styles.length > 1).slice(0, 4);
  const collections = useMemo(() => { const g = new Map<string, Entry[]>(); for (const m of music) if (m.group) g.set(m.group, [...(g.get(m.group) ?? []), m]); return [...g.values()].filter((l) => l.length > 1).slice(0, 6); }, [music]);
  const groupItems = group.map((id) => byId.get(id)).filter((x): x is Entry => !!x), picked = sel.map((id) => byId.get(id)).filter((x): x is Entry => !!x);
  const list = (items: Entry[]) => <ul className="grid gap-2 md:grid-cols-2">{items.map((e) => <TrackCard key={e.id} e={e} selected={sel.includes(e.id)} onSelect={() => toggleSel(e.id)} onFav={() => void fav(e)} onDelete={() => void del(e)} compact />)}</ul>;
  const section = (title: string, items: Entry[]) => items.length ? <section><h3 className="text-xs uppercase tracking-widest text-zinc-400 mb-2">{title}</h3>{list(items)}</section> : null;

  if (loading) return <div className="grid place-items-center py-24 text-zinc-400 text-sm" data-testid="sound-loading"><Loader2 className="w-6 h-6 animate-spin mb-2" />Loading your soundtrack library…</div>;
  if (!meta) return <div className="py-10"><div role="alert" className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-100 flex gap-2"><AlertTriangle className="w-4 h-4 mt-0.5" />{err ?? 'Could not load the library.'}<button className="ml-auto underline" onClick={() => { setLoading(true); void load(); }}>Retry</button></div></div>;

  return (
    <div className="flex flex-col gap-6" data-testid="sound-studio">
      {err && <div role="alert" className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-100 flex gap-2 items-start"><AlertTriangle className="w-4 h-4 shrink-0" /><span className="flex-1">{err}</span><button onClick={() => setErr(null)} aria-label="Dismiss"><X className="w-4 h-4" /></button></div>}

      <section className={`${glass} p-5 bg-gradient-to-br from-violet-500/10 via-transparent to-sky-500/5`}>
        <div className="flex items-center gap-2 mb-1"><Wand2 className="w-5 h-5 text-violet-300" /><h2 className="text-base font-semibold text-white">Compose from styles</h2></div>
        <p className="text-xs text-zinc-400 mb-3 max-w-2xl">Pick one or more styles. They are ingredients, not stacked tracks: the engine chooses a lead, balances layers, checks tempo compatibility and carves frequency overlap. Where two styles clash they become influences. {meta.limits.maxSeconds}s / {meta.limits.maxVariations} variations max on this {meta.tier}-resource machine.</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Styles">{meta.styles.map((s) => <button key={s.id} type="button" data-testid={`style-${s.id}`} aria-pressed={styles.includes(s.id)} title={s.blurb} onClick={() => setStyles((x) => (x.includes(s.id) ? x.filter((y) => y !== s.id) : [...x, s.id].slice(0, 4)))} className={chip(styles.includes(s.id))}>{s.label}</button>)}</div>
        <div className="mt-4"><DurationPicker value={{ seconds, introPadSec: introPad, outroPadSec: outroPad }} max={meta.limits.maxSeconds} videoSeconds={videoSeconds} disabled={busy} onChange={(v) => { setSeconds(v.seconds); setIntroPad(v.introPadSec); setOutroPad(v.outroPadSec); }} /></div>
        <div className="grid sm:grid-cols-2 gap-4 mt-4 text-xs text-zinc-300">
          <label>Variations: {Math.min(variations, meta.limits.maxVariations)}<input type="range" min={1} max={meta.limits.maxVariations} value={Math.min(variations, meta.limits.maxVariations)} onChange={(e) => setVariations(Number(e.target.value))} className="w-full accent-violet-400" aria-label="Variations" /></label>
          <label>Intensity<select value={intensity} onChange={(e) => setIntensity(e.target.value)} className="block w-full mt-1 rounded-lg bg-zinc-950/70 border border-white/10 px-2 py-1.5">{['low', 'medium', 'high'].map((i) => <option key={i}>{i}</option>)}</select></label>
        </div>
        <button type="button" data-testid="compose" onClick={() => void compose()} disabled={busy || !styles.length} className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-500 hover:bg-violet-400 disabled:bg-zinc-700 disabled:text-zinc-400 text-white text-sm font-semibold">
          {busy ? <><Loader2 className="w-4 h-4 animate-spin" />Composing {Math.min(variations, meta.limits.maxVariations)} variation(s)… this is real synthesis and takes a moment</> : <><Sparkles className="w-4 h-4" />{groupItems.length ? 'Regenerate variations' : 'Compose variations'}</>}
        </button>
        {!styles.length && <span className="ml-3 text-[11px] text-zinc-500">Select a style to begin.</span>}
      </section>

      {groupItems.length > 0 && (
        <section data-testid="variations">
          <div className="flex items-center gap-2 mb-2"><Layers className="w-4 h-4 text-violet-300" /><h3 className="text-sm font-semibold text-white">Variations</h3><button className="ml-auto text-xs text-zinc-400 hover:text-white inline-flex items-center gap-1" onClick={() => void compose()} disabled={busy}><RefreshCw className="w-3 h-3" />Regenerate</button></div>
          <div className="grid gap-3 lg:grid-cols-2">{groupItems.map((e) => (
            <div key={e.id} className={`${glass} p-3 flex flex-col gap-2`}>
              <ul><TrackCard e={e} selected={sel.includes(e.id)} onSelect={() => toggleSel(e.id)} onFav={() => void fav(e)} onDelete={() => void del(e)} /></ul>
              <div className="text-[11px] text-zinc-400 px-1"><b className="text-zinc-200">{e.character}</b> · lead: {e.arrangement?.leader} <ul className="mt-1 list-disc pl-4 space-y-0.5">{(e.arrangement?.notes ?? []).slice(0, 3).map((n, i) => <li key={i}>{n}</li>)}</ul>
                {e.structure?.sections?.length ? <details className="mt-1.5" data-testid="arrangement"><summary className="cursor-pointer text-zinc-300">Arrangement ({e.structure.sections.length} sections)</summary><ol className="mt-1 pl-4 list-decimal space-y-0.5">{e.structure.sections.map((x, i) => <li key={i}>{x}</li>)}</ol></details> : null}</div>
              <div className="flex gap-2 px-1">{hasVideo && onUseSound && e.overrides && e.mood && <button className="text-xs px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white" onClick={() => onUseSound({ mood: e.mood as string, intensity: e.intensity ?? 'medium', seed: e.seed, overrides: e.overrides as Record<string, unknown> })}>Use in video</button>}<a className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-zinc-200 hover:bg-white/5 inline-flex items-center gap-1" href={`/api/studio/sound/file?id=${e.id}&download=1`}><Download className="w-3 h-3" />Download</a></div>
            </div>))}</div>
          {notes.length > 0 && <p className="text-[11px] text-zinc-500 mt-2">{notes.join(' · ')}</p>}
        </section>)}

      {picked.length > 0 && (
        <section data-testid="compare" className={`${glass} p-4 overflow-x-auto`}>
          <div className="flex items-center mb-2"><h3 className="text-sm font-semibold text-white">Compare ({picked.length})</h3><button className="ml-auto text-xs text-zinc-400 hover:text-white" onClick={() => setSel([])}>Clear selection</button></div>
          <table className="text-xs text-zinc-300 w-full min-w-[480px]"><thead><tr className="text-zinc-500 text-left"><th className="pb-1 font-normal">Track</th><th className="font-normal">Character</th><th className="font-normal">Tempo</th><th className="font-normal">Energy</th><th className="font-normal">Length</th><th /></tr></thead>
            <tbody>{picked.map((e) => <tr key={e.id} className="border-t border-white/5"><td className="py-1.5 pr-2 text-white">{e.label}</td><td>{e.character ?? e.genreLabel}</td><td>{e.tempo ? Math.round(e.tempo) : '–'} BPM</td><td>{e.energyLevel}</td><td>{fmtTime(e.seconds)}</td><td className="text-right"><PlayButton track={trackOf(e)} size="sm" /></td></tr>)}</tbody></table>
        </section>)}

      <section>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="relative flex-1 min-w-[180px]"><Search className="w-4 h-4 absolute left-3 top-2.5 text-zinc-500" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tracks" aria-label="Search tracks" className="w-full pl-9 pr-3 py-2 rounded-xl bg-zinc-950/60 border border-white/10 text-sm text-white placeholder:text-zinc-500" /></div>
          <button className={chip(favOnly)} aria-pressed={favOnly} onClick={() => setFavOnly((v) => !v)}>Favourites</button>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2 mb-3" role="group" aria-label="Genre and mood"><button className={chip(!genre)} onClick={() => setGenre('')}>All</button>{meta.styles.map((s) => <button key={s.id} className={chip(genre === s.label)} aria-pressed={genre === s.label} onClick={() => setGenre(genre === s.label ? '' : s.label)}>{s.label}</button>)}</div>
        {music.length === 0 ? <div className={`${glass} p-8 text-center text-sm text-zinc-400`} data-testid="sound-empty"><Sparkles className="w-6 h-6 mx-auto mb-2 text-violet-300" />Your library is empty. Choose styles above and compose your first variations.</div> : (
          <div className="flex flex-col gap-5">
            {!genre && !q && !favOnly && <>{section('Featured (your favourites)', featured)}{section('Recently added', recent)}{section('Recommended: blended styles', recommended)}
              {collections.map((c, i) => <React.Fragment key={i}>{section(`Collection: ${c[0].styles?.join(' + ') ?? 'Set'}`, c)}</React.Fragment>)}</>}
            <section><h3 className="text-xs uppercase tracking-widest text-zinc-400 mb-2">{genre || q || favOnly ? 'Results' : 'All tracks'} ({shown.length})</h3>{shown.length ? list(shown) : <p className="text-sm text-zinc-500">Nothing matches these filters.</p>}</section>
          </div>)}
      </section>
    </div>
  );
};
