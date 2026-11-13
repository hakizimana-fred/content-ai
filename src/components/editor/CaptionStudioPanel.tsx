'use client';

import React, { useMemo, useState } from 'react';
import { Save, RotateCcw, Trash2, Loader2, AlertTriangle, Captions } from 'lucide-react';
import {
  BUILTIN_PRESETS, DEFAULT_CAPTION_STYLE, FONT_FAMILIES, FONT_WEIGHTS, CaptionPreset, CaptionStyle,
  applyCase, captionOverlaps, cssFontFamily, loadUserPresets, saveUserPresets,
} from '@/lib/editor/captions';
import { PlatformSpec } from '@/lib/editor/platforms';
import { ColorField, Segmented, SectionTitle, Select, Slider, Toggle } from './ui';

interface Props {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  style: CaptionStyle;
  onStyleChange: (s: CaptionStyle) => void;
  platform: PlatformSpec;
  hasTranscript: boolean;
  isTranscribing: boolean;
  onGenerateTranscript: () => void;
}

/** Mini preview of a preset on a dark tile (uses the real style: font, colours, outline). */
const PresetTile: React.FC<{ preset: CaptionPreset; active: boolean; onPick: () => void; onDelete?: () => void }> = ({ preset, active, onPick, onDelete }) => {
  const s = preset.style;
  const ol = s.outlineWidth > 0 ? `0 0 0 ${s.outlineColor}, 1px 1px 0 ${s.outlineColor}, -1px -1px 0 ${s.outlineColor}, 1px -1px 0 ${s.outlineColor}, -1px 1px 0 ${s.outlineColor}` : 'none';
  return (
    <div className="relative shrink-0">
      <button
        onClick={onPick}
        aria-pressed={active}
        className={`w-[92px] rounded-xl overflow-hidden border-2 transition-all ${active ? 'border-indigo-400 shadow-[0_0_0_3px_rgba(129,140,248,0.25)]' : 'border-transparent hover:border-white/25'}`}
      >
        <div className="h-[86px] bg-gradient-to-b from-zinc-700 to-zinc-900 flex items-center justify-center px-1">
          <span
            className="text-center leading-tight"
            style={{
              fontFamily: cssFontFamily(s.fontFamily), fontWeight: s.fontWeight, fontSize: 15, textShadow: ol,
              background: s.bgOpacity > 0 ? `${s.bgColor}${Math.round(s.bgOpacity * 255).toString(16).padStart(2, '0')}` : undefined,
              padding: s.bgOpacity > 0 ? '1px 4px' : undefined, borderRadius: 4,
            }}
          >
            <span style={{ color: s.textColor }}>{applyCase('The quick', s.caseMode)} </span>
            <span style={{ color: s.highlightColor }}>{applyCase('brown', s.caseMode)}</span>
          </span>
        </div>
        <div className="py-1 text-[11px] text-zinc-300 bg-zinc-950/70 truncate px-1">{preset.name}</div>
      </button>
      {onDelete && (
        <button onClick={onDelete} className="absolute top-1 right-1 p-1 rounded-full bg-black/70 text-zinc-300 hover:text-rose-300" aria-label={`Delete preset ${preset.name}`} title="Delete this preset">
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </div>
  );
};

export const CaptionStudioPanel: React.FC<Props> = ({ enabled, onEnabledChange, style, onStyleChange, platform, hasTranscript, isTranscribing, onGenerateTranscript }) => {
  const [userPresets, setUserPresets] = useState<CaptionPreset[]>(() => loadUserPresets());
  const [activeId, setActiveId] = useState<string>('classic');
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState('');

  const all = useMemo(() => [...BUILTIN_PRESETS, ...userPresets], [userPresets]);
  const active = all.find((p) => p.id === activeId);
  const set = (patch: Partial<CaptionStyle>) => onStyleChange({ ...style, ...patch });
  const overlaps = useMemo(() => captionOverlaps(style, platform), [style, platform]);
  const modified = active ? JSON.stringify(active.style) !== JSON.stringify(style) : true;

  const saveCurrent = () => {
    const name = newName.trim();
    if (!name) return;
    const preset: CaptionPreset = { id: `user_${Date.now()}`, name, style: { ...style }, builtIn: false };
    const next = [...userPresets, preset];
    setUserPresets(next);
    saveUserPresets(next);
    setActiveId(preset.id);
    setSaving(false);
    setNewName('');
  };
  const removePreset = (id: string) => {
    const next = userPresets.filter((p) => p.id !== id);
    setUserPresets(next);
    saveUserPresets(next);
    if (activeId === id) setActiveId('classic');
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-white tracking-tight">Captions</h2>
          <p className="text-xs text-zinc-400 mt-0.5">Changes appear in the preview instantly.</p>
        </div>
        <Toggle checked={enabled} onChange={onEnabledChange} label="Show captions" />
      </div>

      {!hasTranscript && (
        <div className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] p-3.5 text-xs flex items-start gap-3">
          <Captions className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="text-amber-100 font-medium">No transcript yet</div>
            <div className="text-zinc-400 mt-0.5">The preview uses sample text. Generate a transcript (runs locally) to caption your actual speech.</div>
            <button onClick={onGenerateTranscript} disabled={isTranscribing} className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400/20 hover:bg-amber-400/30 text-amber-100 font-medium disabled:opacity-60">
              {isTranscribing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Transcribing… this can take a few minutes</> : 'Generate transcript'}
            </button>
          </div>
        </div>
      )}

      <div className={enabled ? 'flex flex-col gap-5' : 'flex flex-col gap-5 opacity-40 pointer-events-none'} aria-disabled={!enabled}>
        <section>
          <div className="flex items-center justify-between mb-2">
            <SectionTitle>Presets</SectionTitle>
            <div className="flex items-center gap-1 text-xs">
              <button onClick={() => { const p = all.find((x) => x.id === activeId) ?? BUILTIN_PRESETS[0]; onStyleChange({ ...p.style }); }} disabled={!modified} className="flex items-center gap-1 px-2 py-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 disabled:opacity-30" title="Undo your changes to this preset">
                <RotateCcw className="w-3 h-3" /> Restore
              </button>
              <button onClick={() => { setActiveId('classic'); onStyleChange({ ...DEFAULT_CAPTION_STYLE }); }} className="px-2 py-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5" title="Back to the default style">
                Defaults
              </button>
            </div>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
            {all.map((p) => (
              <PresetTile key={p.id} preset={p} active={p.id === activeId} onPick={() => { setActiveId(p.id); onStyleChange({ ...p.style }); }} onDelete={p.builtIn ? undefined : () => removePreset(p.id)} />
            ))}
          </div>
          {saving ? (
            <div className="flex gap-2 mt-1">
              <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveCurrent()} placeholder="Preset name" maxLength={24} className="flex-1 rounded-xl bg-zinc-950/60 border border-white/10 px-3 py-2 text-sm focus:outline-none focus:border-indigo-400" />
              <button onClick={saveCurrent} disabled={!newName.trim()} className="px-3 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-medium disabled:opacity-40">Save</button>
              <button onClick={() => setSaving(false)} className="px-3 rounded-xl bg-white/5 text-zinc-300 text-sm">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setSaving(true)} className="flex items-center gap-1.5 text-xs text-indigo-300 hover:text-white mt-1"><Save className="w-3.5 h-3.5" /> Save current style as preset</button>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <SectionTitle>Font</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <Select label="Family" value={style.fontFamily} onChange={(v) => set({ fontFamily: v })}>
              {FONT_FAMILIES.map((f) => <option key={f} value={f}>{f}</option>)}
            </Select>
            <Select label="Weight" value={style.fontWeight} onChange={(v) => set({ fontWeight: Number(v) })}>
              {FONT_WEIGHTS.map((w) => <option key={w} value={w}>{w}</option>)}
            </Select>
          </div>
          <Slider label="Size" value={style.fontSize} min={28} max={120} onChange={(v) => set({ fontSize: v })} format={(v) => `${v}px`} />
          <Segmented label="Letter case" value={style.caseMode} onChange={(v) => set({ caseMode: v })} options={[
            { value: 'upper', label: 'AA', title: 'Uppercase' }, { value: 'sentence', label: 'Aa', title: 'Sentence case' }, { value: 'lower', label: 'aa', title: 'Lowercase' }, { value: 'original', label: 'As spoken' },
          ]} />
        </section>

        <section className="flex flex-col gap-3">
          <SectionTitle hint={`Presets stay inside ${platform.short}'s safe area.`}>Position</SectionTitle>
          <Segmented label="Caption position" value={style.position} onChange={(v) => set({ position: v })} options={[
            { value: 'top', label: 'Top' }, { value: 'center', label: 'Centre' }, { value: 'bottom', label: 'Bottom' }, { value: 'custom', label: 'Custom' },
          ]} />
          {style.position === 'custom' && <Slider label="Vertical position" value={style.customY} min={5} max={95} onChange={(v) => set({ customY: v })} format={(v) => `${v}% from top`} />}
          {overlaps.length > 0 && (
            <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-300" />
              <span>On {platform.short} this may be covered by: {overlaps.join(', ')}. Move it into the green band (turn on Safe areas to see it).</span>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <SectionTitle>Appearance</SectionTitle>
          <div className="grid grid-cols-2 gap-2">
            <ColorField label="Text" value={style.textColor} onChange={(v) => set({ textColor: v })} />
            <ColorField label="Highlight" value={style.highlightColor} onChange={(v) => set({ highlightColor: v })} />
            <ColorField label="Background" value={style.bgColor} onChange={(v) => set({ bgColor: v })} />
            <ColorField label="Outline" value={style.outlineColor} onChange={(v) => set({ outlineColor: v })} />
          </div>
          <Slider label="Background opacity" value={Math.round(style.bgOpacity * 100)} min={0} max={100} onChange={(v) => set({ bgOpacity: v / 100 })} format={(v) => `${v}%`} />
          <Slider label="Outline thickness" value={style.outlineWidth} min={0} max={16} onChange={(v) => set({ outlineWidth: v })} format={(v) => (v === 0 ? 'Off' : `${v}px`)} />
          <Slider label="Shadow" value={Math.round(style.shadow * 100)} min={0} max={100} onChange={(v) => set({ shadow: v / 100 })} format={(v) => (v === 0 ? 'Off' : `${v}%`)} />
        </section>

        <section className="flex flex-col gap-3">
          <SectionTitle>Animation</SectionTitle>
          <Select label="Style" value={style.animation} onChange={(v) => set({ animation: v as CaptionStyle['animation'] })}>
            <option value="word">Word-by-word highlight</option>
            <option value="karaoke">Karaoke sweep</option>
            <option value="line">Line-by-line</option>
            <option value="static">Static subtitles</option>
          </Select>
          <Select label="Entrance" value={style.entrance} onChange={(v) => set({ entrance: v as CaptionStyle['entrance'] })}>
            <option value="none">None</option>
            <option value="fade">Fade in</option>
            <option value="pop">Pop</option>
            <option value="slide">Slide up</option>
          </Select>
          <Slider label="Words per line" value={style.wordsPerLine} min={1} max={8} onChange={(v) => set({ wordsPerLine: v })} />
        </section>
      </div>
    </div>
  );
};
