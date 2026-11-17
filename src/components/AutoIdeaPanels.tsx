'use client';

import { techniqueOf } from '@/lib/auto/visual';
import React, { useCallback, useEffect, useState } from 'react';
import { Lightbulb, Images, Film, Shapes, Trash2, Upload, Sparkles, ShieldCheck, AlertTriangle, Check, X as XIcon, Type } from 'lucide-react';
import { SectionTitle, Select } from '@/components/editor/ui';
import type { AutoProject, CopyItem, Mode, QcReport, SceneEdit, SceneSpec } from '@/lib/auto/types';
import type { CreativeAsset } from '@/lib/auto/creative-assets';

const card = 'rounded-2xl bg-white/[0.03] border border-white/[0.07] p-4';
const btn = 'px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 text-zinc-200 hover:bg-white/5 disabled:opacity-40 transition-colors';
const input = 'w-full rounded-lg bg-zinc-950/60 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-zinc-600';

export const MODES: { id: Mode; label: string; hint: string; icon: React.ReactNode }[] = [
  { id: 'idea', label: 'Idea-to-Video', hint: 'Describe it. No uploads needed.', icon: <Lightbulb className="w-4 h-4" /> },
  { id: 'image', label: 'Image-to-Video', hint: 'Animate your photographs.', icon: <Images className="w-4 h-4" /> },
  { id: 'video', label: 'Video-to-Video', hint: 'Edit your footage.', icon: <Film className="w-4 h-4" /> },
  { id: 'mixed', label: 'Mixed media', hint: 'Your media plus generated scenes.', icon: <Shapes className="w-4 h-4" /> },
];

export const ModePicker: React.FC<{ mode: Mode; disabled: boolean; onChange: (m: Mode) => void }> = ({ mode, disabled, onChange }) => (
  <section className={card} aria-label="Creation mode">
    <SectionTitle hint="What are you starting from?">Creation mode</SectionTitle>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2" role="radiogroup" aria-label="Creation mode">
      {MODES.map((m) => <button key={m.id} role="radio" aria-checked={mode === m.id} disabled={disabled} onClick={() => onChange(m.id)}
        className={`text-left rounded-xl border px-3 py-2.5 transition-colors ${mode === m.id ? 'bg-violet-500/20 border-violet-400/60 text-white' : 'border-white/10 text-zinc-400 hover:text-white hover:border-white/25'}`}>
        <div className="flex items-center gap-1.5 text-sm font-semibold">{m.icon}{m.label}</div><div className="text-[11px] mt-0.5 opacity-80">{m.hint}</div></button>)}
    </div>
  </section>
);

const badge = (a: CreativeAsset) => a.license.commercialOk === true ? ['commercial OK', 'bg-emerald-400/15 text-emerald-200'] : a.license.commercialOk === false ? ['not for commercial use', 'bg-rose-400/15 text-rose-200'] : ['licence unconfirmed', 'bg-amber-400/15 text-amber-200'];

export const CreativeLibrary: React.FC<{ selected: string[]; disabled: boolean; onSelect: (ids: string[]) => void }> = ({ selected, disabled, onSelect }) => {
  const [assets, setAssets] = useState<CreativeAsset[]>([]); const [err, setErr] = useState<string | null>(null); const [show, setShow] = useState(false); const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ name: '', kind: 'background', license: '', commercialOk: 'unknown', source: '', attribution: '', tags: '', confirm: false }); const [file, setFile] = useState<File | null>(null);
  const load = useCallback(() => fetch('/api/auto/creative-assets').then((r) => r.json()).then((d) => d.success && setAssets(d.assets)).catch(() => {}), []);
  useEffect(() => { void load(); }, [load]);
  const mine = assets.filter((a) => !a.builtin && !a.managedIn), builtin = assets.filter((a) => a.builtin);
  const toggle = (id: string) => onSelect(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id].slice(0, 8));
  const add = async () => {
    if (!file) return setErr('Choose an image, video or font file.'); setBusy(true); setErr(null);
    const fd = new FormData(); fd.append('file', file); Object.entries(f).forEach(([k, v]) => fd.append(k, String(v)));
    try { const d = await (await fetch('/api/auto/creative-assets', { method: 'POST', body: fd })).json(); if (!d.success) throw new Error(d.error); setShow(false); setFile(null); setF({ ...f, name: '', license: '', confirm: false }); await load(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const del = async (a: CreativeAsset) => { if (!confirm(`Delete "${a.name}"?`)) return; await fetch(`/api/auto/creative-assets?id=${a.id}`, { method: 'DELETE' }); onSelect(selected.filter((x) => x !== a.id)); await load(); };
  return (
    <section className={card} aria-label="Creative asset library">
      <div className="flex items-center justify-between gap-2 mb-2"><SectionTitle hint="Your own licensed backgrounds, footage, photos and overlays. Ticked items are featured as scenes. Works offline.">Creative asset library</SectionTitle>
        <button className={btn} disabled={disabled} onClick={() => setShow((v) => !v)}><span className="flex items-center gap-1"><Upload className="w-3.5 h-3.5" />{show ? 'Close' : 'Add asset'}</span></button></div>
      {err && <div role="alert" className="text-xs text-rose-300 mb-2">{err}</div>}
      {show && <div className="rounded-xl border border-white/10 p-3 mb-3 grid sm:grid-cols-2 gap-3">
        <input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,.jpg,.jpeg,.png,.webp,.mp4,.mov,.webm,.ttf,.otf,.glb,model/gltf-binary" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="sm:col-span-2 text-xs text-zinc-400 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-xs file:text-zinc-200" />
        <input className={input} placeholder="Name" value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Select label="Type" value={f.kind} onChange={(v) => setF({ ...f, kind: v })}><option value="background">Background</option><option value="footage">Stock footage</option><option value="photo">Photograph</option><option value="overlay">Video overlay</option><option value="texture">Texture (image)</option><option value="illustration">Illustration (image)</option><option value="font">Font (.ttf / .otf)</option><option value="model">3D model (.glb)</option></Select>
        <input className={`${input} sm:col-span-2`} placeholder="Licence (required), e.g. Purchased from <source>, standard licence" value={f.license} maxLength={200} onChange={(e) => setF({ ...f, license: e.target.value })} />
        <Select label="Commercial use allowed?" value={f.commercialOk} onChange={(v) => setF({ ...f, commercialOk: v })}><option value="unknown">I do not know</option><option value="yes">Yes</option><option value="no">No</option></Select>
        <input className={input} placeholder="Source / reference" value={f.source} maxLength={200} onChange={(e) => setF({ ...f, source: e.target.value })} />
        <input className={input} placeholder="Tags (comma separated)" value={f.tags} maxLength={120} onChange={(e) => setF({ ...f, tags: e.target.value })} />
        <input className={input} placeholder="Attribution required (if any)" value={f.attribution} maxLength={200} onChange={(e) => setF({ ...f, attribution: e.target.value })} />
        <label className="sm:col-span-2 flex gap-2 text-xs text-zinc-300"><input type="checkbox" checked={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.checked })} />I have the right to use this file as recorded above.</label>
        <div className="sm:col-span-2"><button className={btn} disabled={busy || !file || !f.license.trim() || !f.confirm} onClick={() => void add()}>{busy ? 'Saving…' : 'Add to library'}</button></div></div>}
      {mine.length === 0 ? <p className="text-xs text-zinc-500">No assets of your own yet. Generated scenes use procedural backgrounds that need no files.</p> : (
        <ul className="grid sm:grid-cols-2 gap-2">{mine.map((a) => { const [t, c] = badge(a); return (
          <li key={a.id} className={`flex gap-3 items-center rounded-lg border px-3 py-2 ${selected.includes(a.id) ? 'border-violet-400/60 bg-violet-500/10' : 'border-white/10'}`}>
            <input type="checkbox" aria-label={`Use ${a.name}`} disabled={disabled} checked={selected.includes(a.id)} onChange={() => toggle(a.id)} />
            {a.kind === 'font' || a.kind === 'model' ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={`/api/auto/creative-assets/preview?id=${a.id}`} alt={`${a.name} preview`} className="h-10 w-24 rounded object-cover bg-zinc-900" /> : a.ext && /jpg|png|webp/.test(a.ext) ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={`/api/auto/creative-assets/file?id=${a.id}`} alt="" className="w-10 h-10 rounded object-cover" /> : <Film className="w-5 h-5 text-zinc-500" />}
            <div className="min-w-0 flex-1"><div className="text-sm text-zinc-100 truncate">{a.name}</div><div className="text-[11px] text-zinc-500 truncate">{a.kind}{a.duration ? ` · ${a.duration.toFixed(0)} s` : ''} · <span className={`px-1 rounded ${c}`}>{t}</span></div><div className="text-[10px] text-zinc-600 truncate" title={a.license.license}>{a.license.license}</div></div>
            <button aria-label={`Delete ${a.name}`} className={btn} onClick={() => void del(a)}><Trash2 className="w-3.5 h-3.5" /></button></li>); })}</ul>)}
      <details className="mt-3 text-xs text-zinc-500"><summary className="cursor-pointer">Built-in procedural assets ({builtin.length}): original output of this software, commercial use OK</summary>
        <div className="mt-2 flex flex-wrap gap-1.5">{builtin.map((a) => <span key={a.id} title={a.description} className="px-2 py-0.5 rounded-full border border-white/10 text-zinc-400">{a.kind}: {a.name}</span>)}</div></details>
    </section>
  );
};

/** Editable text for each generated scene. Text is only ever what you type here or wrote in the instruction. */
export const SceneEditor: React.FC<{ scenes: SceneSpec[]; disabled: boolean; onApply: (edits: Record<string, SceneEdit>) => void }> = ({ scenes, disabled, onApply }) => {
  const [e, setE] = useState<Record<string, SceneEdit>>({});
  const val = (s: SceneSpec, k: keyof SceneEdit) => (e[s.id]?.[k] as string | undefined) ?? (s[k as keyof SceneSpec] as string | undefined) ?? '';
  const set = (s: SceneSpec, k: keyof SceneEdit, v: string) => setE({ ...e, [s.id]: { ...(e[s.id] ?? {}), [k]: v } });
  const editable = scenes.filter((s) => ['intro', 'text', 'quote', 'product', 'infographic', 'outro'].includes(s.kind));
  if (!editable.length) return null;
  return (
    <details className="text-xs" open><summary className="cursor-pointer text-zinc-300 mb-2">Scene text (edit, then re-render)</summary>
      <div className="grid gap-2">{editable.map((s) => (
        <div key={s.id} className="rounded-lg border border-white/10 p-2.5"><div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{s.kind} · {s.id}</div>
          <div className="grid sm:grid-cols-2 gap-2">
            {s.kind !== 'quote' && <input aria-label={`${s.id} title`} className={input} placeholder="Title" value={val(s, 'title')} maxLength={160} onChange={(ev) => set(s, 'title', ev.target.value)} />}
            {s.kind === 'quote' && <input aria-label={`${s.id} quote`} className={input} placeholder="Quote" value={val(s, 'quote')} maxLength={160} onChange={(ev) => set(s, 'quote', ev.target.value)} />}
            {s.kind === 'quote' && <input aria-label={`${s.id} attribution`} className={input} placeholder="Attribution" value={val(s, 'attribution')} maxLength={160} onChange={(ev) => set(s, 'attribution', ev.target.value)} />}
            {s.kind === 'intro' && <input aria-label={`${s.id} subtitle`} className={input} placeholder="Subtitle" value={val(s, 'subtitle')} maxLength={160} onChange={(ev) => set(s, 'subtitle', ev.target.value)} />}
            {s.kind === 'outro' && <input aria-label={`${s.id} call to action`} className={input} placeholder="Call to action" value={val(s, 'cta')} maxLength={160} onChange={(ev) => set(s, 'cta', ev.target.value)} />}
          </div></div>))}</div>
      <button className={`${btn} mt-2`} disabled={disabled || !Object.keys(e).length} onClick={() => { onApply(e); setE({}); }}>Apply text and re-render</button>
    </details>
  );
};


const SRC: Record<string, [string, string]> = { user: ['your words', 'bg-emerald-400/15 text-emerald-200'], suggested: ['suggested', 'bg-violet-400/20 text-violet-200'], label: ['label', 'bg-zinc-400/15 text-zinc-300'] };
const FIELD: Record<string, string> = { title: 'Title', subtitle: 'Subtitle', cta: 'Call to action', quote: 'Quote', attribution: 'Attribution', bullets: 'Feature', steps: 'Step', stats: 'Chart' };

/** The Creative Director's plan: what it understood, the scenes, and every line of text with its origin. Suggested copy needs approval. */
export const CreativePlanPanel: React.FC<{ project: AutoProject; disabled: boolean; onChanged: () => Promise<void> | void }> = ({ project, disabled, onChanged }) => {
  const plan = project.creative; const current = !!plan && plan.originalPrompt === project.config.prompt;
  const [busy, setBusy] = useState(false); const [useModel, setUseModel] = useState(true); const [err, setErr] = useState<string | null>(null);
  const pending = current ? plan!.copy.filter((c) => c.source === 'suggested' && c.status === 'needs_review') : [];
  const ap = project.config.copyApproval; const approved = current && ap && ap.planId === plan!.id ? ap : null;
  const [picked, setPicked] = useState<Record<string, boolean>>({}); const [edits, setEdits] = useState<Record<string, string>>({});
  const isPicked = (id: string) => picked[id] ?? (approved ? approved.approved.includes(id) : true); const editOf = (c: CopyItem) => edits[c.id] ?? approved?.edits?.[c.id] ?? c.text;
  const make = async () => { setBusy(true); setErr(null); try { const d = await (await fetch(`/api/auto/plan?id=${project.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ useModel }) })).json(); if (!d.success) throw new Error(d.error); setPicked({}); setEdits({}); await onChanged(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  const approve = async () => { setBusy(true); setErr(null); try { const body = { planId: plan!.id, approved: pending.filter((c) => isPicked(c.id)).map((c) => c.id), edits: Object.fromEntries(pending.filter((c) => isPicked(c.id) && editOf(c) !== c.text).map((c) => [c.id, editOf(c)])) }; const d = await (await fetch(`/api/auto/plan?id=${project.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json(); if (!d.success) throw new Error(d.error); await onChanged(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  const items = (sid: string) => (plan?.copy ?? []).filter((c) => c.sceneId === sid && c.status !== 'rejected');
  return (
    <section className={card} aria-label="Creative plan">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2"><SectionTitle hint="The Creative Director plans the concept, scenes and text. Lines it suggests are shown here for your approval; nothing is rendered from them until you approve.">Creative plan</SectionTitle>
        <div className="flex items-center gap-3 flex-wrap"><label className="flex items-center gap-1.5 text-xs text-zinc-300"><input type="checkbox" checked={useModel} disabled={busy || disabled} onChange={(e) => setUseModel(e.target.checked)} />Use local AI model (about 30–45 s on this CPU)</label>
          <button className={btn} disabled={busy || disabled || !project.config.prompt.trim()} onClick={() => void make()}><span className="flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" />{busy ? 'Planning…' : plan ? 'Plan again' : 'Create plan'}</span></button></div></div>
      {err && <div role="alert" className="text-xs text-rose-300 mb-2">{err}</div>}
      {!plan && <p className="text-xs text-zinc-500">No plan yet. You can render straight away (only your own words are shown), or create a plan to see and approve creative lines first.</p>}
      {plan && !current && <p className="text-xs text-amber-200/90">Your instruction changed since this plan was made. Create the plan again.</p>}
      {plan && current && <div className="grid gap-3 text-xs">
        <div className="rounded-lg border border-white/10 p-3 grid sm:grid-cols-2 gap-x-6 gap-y-1">
          <div><span className="text-zinc-500">Planned by </span><span className="text-zinc-200">{plan.source === 'model' ? `local model ${plan.model} (${((plan.ms ?? 0) / 1000).toFixed(1)} s)` : 'keyword Director'}</span>{plan.fallbackReason && <span className="text-amber-200/90"> · {plan.fallbackReason}</span>}</div>
          <div><span className="text-zinc-500">Direction </span><span className="text-zinc-200">{plan.look.name}</span></div>
          <div className="sm:col-span-2"><span className="text-zinc-500">Concept </span><span className="text-zinc-200">{plan.concept}</span></div>
          <div><span className="text-zinc-500">Audience </span><span className="text-zinc-300">{plan.audience}</span></div><div><span className="text-zinc-500">Objective </span><span className="text-zinc-300">{plan.objective}</span></div>
          <div><span className="text-zinc-500">Mood </span><span className="text-zinc-300">{plan.mood.join(', ')}</span></div><div><span className="text-zinc-500">Soundtrack </span><span className="text-zinc-300">{plan.soundtrack.mood ?? 'chosen from your wording'}{plan.soundtrack.notes ? ` · ${plan.soundtrack.notes}` : ''}</span></div>
          <div className="sm:col-span-2"><span className="text-zinc-500">Original instruction (kept) </span><span className="text-zinc-400 italic">{plan.originalPrompt}</span></div>
        </div>
        <ol className="grid gap-1.5">{plan.scenes.map((sc, i) => (
          <li key={sc.id} className="rounded-lg border border-white/10 px-3 py-2"><div className="flex items-center gap-2 text-zinc-300"><span className="text-zinc-500 w-5">{i + 1}</span><span className="font-medium">{sc.kind}</span><span className={`px-1.5 rounded text-[10px] ${techniqueOf(sc) === 'real3d' ? 'bg-fuchsia-500/20 text-fuchsia-200' : techniqueOf(sc) === 'depth25d' ? 'bg-sky-500/20 text-sky-200' : 'bg-white/10 text-zinc-300'}`} title={techniqueOf(sc) === 'real3d' ? 'Real 3D: meshes, a perspective camera and lighting' : techniqueOf(sc) === 'depth25d' ? '2.5D: flat layers moved at different rates to suggest depth. Not 3D.' : 'Flat 2D'}>{techniqueOf(sc) === 'real3d' ? '3D' : techniqueOf(sc) === 'depth25d' ? '2.5D' : '2D'}</span><span className="text-[10px] text-zinc-500">{sc.composition ?? 'default'} · {sc.bg} · {sc.weight.toFixed(1)}×</span></div>
            <ul className="mt-1 ml-7 space-y-0.5">{items(sc.id).map((c) => { const [t, cl] = SRC[c.source]; return <li key={c.id} className="flex items-center gap-2"><span className={`px-1.5 rounded text-[10px] ${cl}`}>{t}</span><span className="text-zinc-500">{FIELD[c.field] ?? c.field}:</span><span className="text-zinc-200 break-words">{c.text}</span></li>; })}{items(sc.id).length === 0 && <li className="text-zinc-600">no text (animated visuals only)</li>}</ul></li>))}</ol>
        {plan.notes.filter((n) => /removed/.test(n)).length > 0 && <details className="text-zinc-400"><summary className="cursor-pointer text-amber-200/90">{plan.notes.filter((n) => /removed/.test(n)).length} unsupported claim(s) were removed</summary><ul className="list-disc ml-5 mt-1 space-y-0.5">{plan.notes.filter((n) => /removed/.test(n)).map((n, i) => <li key={i}>{n}</li>)}</ul></details>}
        {pending.length > 0 && <div className="rounded-lg border border-violet-400/40 bg-violet-500/[0.06] p-3" role="group" aria-label="Suggested copy for approval">
          <div className="text-sm text-zinc-100 mb-1">Approve the suggested lines</div><p className="text-zinc-400 mb-2">These lines were written by the Creative Director, not by you. They contain no prices, places, ingredients, statistics or feature claims. Edit them, untick any you do not want, then approve.</p>
          <div className="grid gap-2">{pending.map((c: CopyItem) => (<label key={c.id} className="flex items-center gap-2"><input type="checkbox" checked={isPicked(c.id)} disabled={busy || disabled} onChange={(e) => setPicked({ ...picked, [c.id]: e.target.checked })} aria-label={`Use suggested ${FIELD[c.field] ?? c.field}`} />
            <span className="text-zinc-500 w-24 shrink-0">{c.sceneId} · {FIELD[c.field] ?? c.field}</span><input className={input} maxLength={80} disabled={busy || disabled || !isPicked(c.id)} value={editOf(c)} onChange={(e) => setEdits({ ...edits, [c.id]: e.target.value })} aria-label={`Text for ${c.sceneId} ${c.field}`} /></label>))}</div>
          <div className="flex items-center gap-3 mt-3"><button className={btn} disabled={busy || disabled} onClick={() => void approve()}><span className="flex items-center gap-1"><Check className="w-3.5 h-3.5" />Approve selected</span></button>
            {approved ? <span className="text-emerald-300">Approved: {approved.approved.length} of {pending.length} used. Anything unticked is left out.</span> : <span className="text-amber-200/90">Not approved yet. Rendering is blocked until you approve or skip these lines.</span>}</div>
        </div>}
        {pending.length === 0 && <p className="text-emerald-300/90 flex items-center gap-1.5"><Check className="w-3.5 h-3.5" />Every line of text comes from your instruction. Nothing needs approval.</p>}
      </div>}
    </section>
  );
};

const ST: Record<string, [React.ReactNode, string]> = { pass: [<Check key="p" className="w-3.5 h-3.5" />, 'text-emerald-300'], warn: [<AlertTriangle key="w" className="w-3.5 h-3.5" />, 'text-amber-300'], fail: [<XIcon key="f" className="w-3.5 h-3.5" />, 'text-rose-300'], skipped: [<span key="s" className="w-3.5 text-center">–</span>, 'text-zinc-500'] };
/** Automated quality-control report for the finished MP4. */
export const QcPanel: React.FC<{ qc: QcReport }> = ({ qc }) => (
  <details open={qc.verdict !== 'pass'} className="text-xs" aria-label="Quality report">
    <summary className="cursor-pointer text-zinc-300 mb-1 flex items-center gap-1.5 inline-flex"><ShieldCheck className="w-3.5 h-3.5" />Quality report: <span className={qc.verdict === 'pass' ? 'text-emerald-300' : qc.verdict === 'warn' ? 'text-amber-300' : 'text-rose-300'}>{qc.verdict}</span> ({qc.checks.filter((c) => c.status === 'pass').length} of {qc.checks.filter((c) => c.status !== 'skipped').length} checks passed)</summary>
    <ul className="grid gap-0.5 mt-1">{qc.checks.map((c) => <li key={c.id} className="flex gap-2 items-start"><span className={`mt-0.5 ${ST[c.status][1]}`}>{ST[c.status][0]}</span><span className="text-zinc-300 w-52 shrink-0">{c.label}</span><span className="text-zinc-500 break-words">{c.detail}</span></li>)}</ul>
    {qc.stats.fontsUsed ? <div className="mt-1 text-zinc-600">fonts used: {String(qc.stats.fontsUsed)}</div> : null}
  </details>
);

export const TypographyPicker: React.FC<{ value?: string; disabled: boolean; onChange: (id: string | undefined) => void }> = ({ value, disabled, onChange }) => {
  const [fonts, setFonts] = useState<CreativeAsset[]>([]);
  useEffect(() => { fetch('/api/auto/creative-assets').then((r) => r.json()).then((d) => d.success && setFonts((d.assets as CreativeAsset[]).filter((a) => a.kind === 'font'))).catch(() => {}); }, []);
  const mine = fonts.filter((f) => !f.builtin); const sel = fonts.find((f) => f.id === value);
  return (
    <div><label className="text-xs text-zinc-300 block mb-1" htmlFor="as-font"><Type className="w-3 h-3 inline mr-1" />Font for generated text</label>
      <select id="as-font" className={input} disabled={disabled} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}><option value="">Automatic (from the creative direction)</option>{mine.length > 0 && <optgroup label="Your fonts">{mine.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</optgroup>}<optgroup label="Bundled">{fonts.filter((f) => f.builtin).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</optgroup></select>
      {sel && /* eslint-disable-next-line @next/next/no-img-element */ <img src={`/api/auto/creative-assets/preview?id=${sel.id}`} alt={`${sel.name} specimen`} className="mt-1.5 rounded border border-white/10 w-full max-w-xs" />}
      {sel && <div className="text-[10px] text-zinc-500 mt-1">{sel.license.license} · {sel.license.commercialOk === true ? 'commercial OK' : sel.license.commercialOk === false ? 'not for commercial use' : 'licence unconfirmed'}. Missing characters fall back to the bundled fonts.</div>}
    </div>
  );
};
