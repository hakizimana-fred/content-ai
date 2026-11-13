'use client';

import React, { useId } from 'react';

export const SectionTitle: React.FC<{ children: React.ReactNode; hint?: string }> = ({ children, hint }) => (
  <div className="mb-2">
    <div className="text-[11px] font-semibold tracking-[0.14em] text-zinc-400 uppercase">{children}</div>
    {hint && <div className="text-xs text-zinc-500 mt-0.5">{hint}</div>}
  </div>
);

export const Segmented = <T extends string | number>({
  value, onChange, options, label,
}: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode; title?: string }[]; label: string }) => (
  <div role="radiogroup" aria-label={label} className="flex items-center rounded-xl bg-zinc-950/60 border border-white/[0.07] p-0.5 gap-0.5">
    {options.map((o) => (
      <button
        key={String(o.value)}
        role="radio"
        aria-checked={value === o.value}
        title={o.title}
        onClick={() => onChange(o.value)}
        className={`flex-1 px-2 py-1.5 rounded-[10px] text-xs font-medium transition-all whitespace-nowrap ${
          value === o.value ? 'bg-white text-zinc-950 shadow' : 'text-zinc-400 hover:text-white hover:bg-white/5'
        }`}
      >
        {o.label}
      </button>
    ))}
  </div>
);

export const Slider: React.FC<{
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string;
}> = ({ label, value, min, max, step = 1, onChange, format }) => {
  const id = useId();
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <label htmlFor={id} className="text-zinc-300">{label}</label>
        <span className="font-mono text-zinc-400 tabular-nums">{format ? format(value) : value}</span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} className="w-full h-1.5 accent-indigo-400 cursor-pointer" />
    </div>
  );
};

export const ColorField: React.FC<{ label: string; value: string; onChange: (v: string) => void }> = ({ label, value, onChange }) => {
  const id = useId();
  return (
    <label htmlFor={id} className="flex items-center justify-between gap-2 rounded-xl bg-zinc-950/60 border border-white/[0.07] pl-3 pr-1.5 py-1.5 cursor-pointer hover:border-white/20 transition-colors">
      <span className="text-xs text-zinc-300">{label}</span>
      <span className="flex items-center gap-1.5">
        <span className="font-mono text-[10px] text-zinc-500 uppercase">{value}</span>
        <input id={id} type="color" value={value} onChange={(e) => onChange(e.target.value)} className="w-7 h-7 rounded-lg bg-transparent border-0 p-0 cursor-pointer" />
      </span>
    </label>
  );
};

export const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string }> = ({ checked, onChange, label }) => (
  <button
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={() => onChange(!checked)}
    className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${checked ? 'bg-indigo-500' : 'bg-zinc-700'}`}
  >
    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
  </button>
);

export const Select: React.FC<{ label: string; value: string | number; onChange: (v: string) => void; children: React.ReactNode }> = ({ label, value, onChange, children }) => {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-xs text-zinc-300 mb-1">{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-xl bg-zinc-950/60 border border-white/[0.07] px-2.5 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-400 cursor-pointer">
        {children}
      </select>
    </div>
  );
};
