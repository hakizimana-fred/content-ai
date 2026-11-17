'use client';
// Brand identity controls inside the identity editor: logo upload (PNG/SVG/WebP/JPEG), extracted palette, tagline, logo placement and a real preview.
import React, { useState } from 'react';
import { ImageUp, Loader2, Trash2 } from 'lucide-react';
import { ColorField, Select, Slider, Toggle } from '@/components/editor/ui';
import type { IdentityInput, LogoStyle } from '@/lib/studio/identity';

type Draft = IdentityInput & { id?: string; logo?: { ext: string; source?: string; aspect?: number; hasAlpha?: boolean; extracted?: { hex: string; share: number }[] } };
const STYLE0: LogoStyle = { opening: true, closing: true, watermark: true, scale: 1, reveal: 'sweep', extrude: false };
const inp = 'w-full rounded-lg bg-zinc-950/60 border border-white/10 px-3 py-2 text-sm text-white';
const ROLES = ['primary', 'secondary', 'accent'] as const;

export const BrandPanel: React.FC<{ draft: Draft; set: (fn: (d: Draft) => void) => void; reload: () => Promise<unknown>; onErr: (m: string | null) => void }> = ({ draft, set, reload, onErr }) => {
  const [busy, setBusy] = useState(false); const [v, setV] = useState(0); const [prev, setPrev] = useState<{ role: string; image: string; plate?: boolean } | null>(null); const [pbusy, setPbusy] = useState<string | null>(null);
  const [derived, setDerived] = useState<string[]>([]);
  const st = { ...STYLE0, ...(draft.logoStyle ?? {}) }; const setStyle = (p: Partial<LogoStyle>) => set((d) => { d.logoStyle = { ...STYLE0, ...(d.logoStyle ?? {}), ...p }; });
  const colors = draft.colors as typeof draft.colors & { secondary?: string };
  if (!draft.id) return <p className="text-[11px] text-zinc-500 sm:col-span-3">Save the identity first, then edit it to add a logo, palette and placement.</p>;

  const upload = async (file: File | undefined) => {
    if (!file || !draft.id) return; setBusy(true); onErr(null);
    try {
      const r = await fetch(`/api/studio/identities/logo?id=${draft.id}`, { method: 'POST', body: file }); const d = await r.json(); if (!r.ok || !d.success) throw new Error(d.error || 'Upload failed');
      set((c) => { c.logo = d.identity.logo; if (d.analysis?.roles) { c.colors.primary = d.analysis.roles.primary; c.colors.secondary = d.analysis.roles.secondary; c.colors.accent = d.analysis.roles.accent; } });
      setDerived(d.analysis?.derived ?? []); setV((x) => x + 1); setPrev(null); await reload();
    } catch (e) { onErr((e as Error).message); } finally { setBusy(false); }
  };
  const remove = async () => { try { const r = await fetch(`/api/studio/identities/logo?id=${draft.id}`, { method: 'DELETE' }); const d = await r.json(); if (!d.success) throw new Error(d.error); set((c) => { delete c.logo; }); setPrev(null); await reload(); } catch (e) { onErr((e as Error).message); } };
  const preview = async (role: 'opening' | 'closing') => {
    setPbusy(role); onErr(null);
    try { const r = await fetch('/api/auto/brand/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identityId: draft.id, role, style: st, colors }) }); const d = await r.json(); if (!d.success) throw new Error(d.error || 'Preview failed'); setPrev({ role, image: d.image, plate: d.logo?.plate }); }
    catch (e) { onErr((e as Error).message); } finally { setPbusy(null); }
  };
  const roleOf = (hex: string) => ROLES.filter((r) => (colors as Record<string, string | undefined>)[r]?.toLowerCase() === hex.toLowerCase());

  return (
    <div className="sm:col-span-3 rounded-xl border border-white/10 bg-white/[0.02] p-4 flex flex-col gap-4" data-testid="brand-panel">
      <div className="text-sm font-semibold text-white">Brand identity</div>
      <div className="grid md:grid-cols-[1fr_minmax(0,1fr)] gap-5">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="w-28 h-20 rounded-lg grid place-items-center overflow-hidden border border-white/10" style={{ backgroundImage: 'repeating-conic-gradient(#2b2b33 0 25%, #1b1b22 0 50%)', backgroundSize: '12px 12px' }}>
              {draft.logo ? /* eslint-disable-next-line @next/next/no-img-element */ <img data-testid="logo-preview" src={`/api/studio/identities/logo?id=${draft.id}&v=${v}`} alt="Brand logo" className="max-w-full max-h-full object-contain" /> : <span className="text-[11px] text-zinc-500 px-2 text-center">No logo yet</span>}
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-500 hover:bg-violet-400 text-white cursor-pointer">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageUp className="w-3.5 h-3.5" />}{draft.logo ? 'Replace logo' : 'Upload logo'}
                <input data-testid="logo-input" type="file" accept="image/png,image/svg+xml,image/webp,image/jpeg" className="hidden" disabled={busy} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} /></label>
              {draft.logo && <button type="button" onClick={() => void remove()} className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-rose-300"><Trash2 className="w-3 h-3" />Remove</button>}
            </div>
          </div>
          <p className="text-[11px] text-zinc-500">PNG, SVG, WebP or JPEG (raster up to 2 MB, SVG up to 1 MB). {draft.logo ? `${draft.logo.source === 'svg' ? 'SVG converted to a transparent PNG; ' : ''}${draft.logo.hasAlpha ? 'transparency preserved.' : 'no transparency; a flat background is detected and a contrast plate is used if needed.'}` : 'The logo is never recoloured or stretched.'}</p>
          {draft.logo?.extracted && draft.logo.extracted.length > 0 && <div><div className="text-xs text-zinc-300 mb-1">Colours found in the logo (click to assign)</div>
            <div className="flex flex-wrap gap-2">{draft.logo.extracted.map((c) => <div key={c.hex} className="flex flex-col items-center gap-1">
              <div className="w-9 h-9 rounded-lg border border-white/20" title={`${c.hex} · ${Math.round(c.share * 100)}% of the logo`} style={{ background: c.hex }} />
              <div className="flex gap-0.5">{ROLES.map((r) => <button key={r} type="button" aria-label={`Use ${c.hex} as ${r}`} onClick={() => set((d) => { (d.colors as Record<string, string>)[r] = c.hex; })} className={`text-[9px] px-1 rounded ${roleOf(c.hex).includes(r) ? 'bg-violet-500 text-white' : 'bg-white/10 text-zinc-400 hover:bg-white/20'}`}>{r[0].toUpperCase()}</button>)}</div></div>)}</div>
            {derived.length > 0 && <p className="text-[11px] text-amber-300/80 mt-1">The logo has few colours, so {derived.join(' and ')} {derived.length > 1 ? 'were' : 'was'} derived from the primary. Edit freely.</p>}</div>}
          <div className="grid grid-cols-3 gap-2"><ColorField label="Primary" value={colors.primary} onChange={(x) => set((d) => { d.colors.primary = x; })} /><ColorField label="Secondary" value={colors.secondary ?? colors.primary} onChange={(x) => set((d) => { (d.colors as Record<string, string>).secondary = x; })} /><ColorField label="Accent" value={colors.accent} onChange={(x) => set((d) => { d.colors.accent = x; })} /></div>
          <div><label className="text-xs text-zinc-300 block mb-1">Tagline (optional, shown at the end of the video)</label><input value={draft.tagline ?? ''} maxLength={80} onChange={(e) => set((d) => { d.tagline = e.target.value || undefined; })} className={inp} placeholder="e.g. Crafted for those who notice" /></div>
        </div>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2"><Toggle checked={st.opening} onChange={(x) => setStyle({ opening: x })} label="Logo opens the video" /><Toggle checked={st.closing} onChange={(x) => setStyle({ closing: x })} label="Branded ending" /><Toggle checked={st.watermark} onChange={(x) => setStyle({ watermark: x })} label="Subtle corner mark" /><Toggle checked={st.extrude} onChange={(x) => setStyle({ extrude: x })} label="3D logo ending" /></div>
          {st.extrude && <p className="text-[11px] text-amber-300/80">This builds a stylised 3D extrusion of the logo&apos;s shape in a brand colour. It changes how the logo looks, so it is off unless you choose it. Works best with a simple, solid logo.</p>}
          <div className="grid grid-cols-2 gap-3"><Slider label="Logo size" value={st.scale} min={0.5} max={1.6} step={0.05} onChange={(x) => setStyle({ scale: x })} format={(x) => `${Math.round(x * 100)}%`} /><Select label="Reveal" value={st.reveal} onChange={(x) => setStyle({ reveal: x as LogoStyle['reveal'] })}><option value="sweep">Light sweep</option><option value="rise">Rise</option><option value="fade">Fade</option></Select></div>
          <div className="flex gap-2"><button type="button" disabled={!draft.logo || !!pbusy} onClick={() => void preview('opening')} className="px-3 py-1.5 rounded-lg text-xs border border-white/10 text-zinc-200 hover:bg-white/5 disabled:opacity-40">{pbusy === 'opening' ? 'Rendering…' : 'Preview opening'}</button><button type="button" disabled={!draft.logo || !!pbusy} onClick={() => void preview('closing')} className="px-3 py-1.5 rounded-lg text-xs border border-white/10 text-zinc-200 hover:bg-white/5 disabled:opacity-40">{pbusy === 'closing' ? 'Rendering…' : 'Preview ending'}</button></div>
          {prev ? <div className="flex gap-3 items-start">{/* eslint-disable-next-line @next/next/no-img-element */}<img data-testid="brand-preview" src={prev.image} alt={`${prev.role} preview`} className="w-36 rounded-lg border border-white/10" /><p className="text-[11px] text-zinc-400">A real frame from the video renderer using your unsaved settings.{prev.plate ? ' The logo is close in tone to the background, so a neutral plate sits behind it; the logo itself is untouched.' : ''}</p></div> : <p className="text-[11px] text-zinc-500">Preview renders a real frame with the video renderer, using the settings above (before saving).</p>}
        </div>
      </div>
    </div>
  );
};
