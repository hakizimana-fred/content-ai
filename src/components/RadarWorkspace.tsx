'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Radar, Plus, Search, X, Pause, Play, ShieldCheck, ShieldAlert, ShieldX, Trash2, Loader2, Info, Bell, BellOff, History, Users, AlertTriangle, Eye } from 'lucide-react';
import type { Creator, CreatorPermission, PermissionScope, LiveSession, RadarNotification } from '@/types/radar';
import { permissionStatus, can } from '@/lib/radar/permissions';
import { Toggle } from './editor/ui';

const LANGS = ['English', 'Luganda', 'Swahili', 'Mixed', 'Unknown'];
const CATS = ['General', 'Podcast', 'Business', 'Politics', 'Entertainment', 'Education', 'News', 'Music'];

const fetchJson = async (url: string, init?: RequestInit) => {
  const r = await fetch(url, { ...init, headers: { 'content-type': 'application/json' } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
};

const Avatar: React.FC<{ c: Creator; size?: number }> = ({ c, size = 64 }) => {
  const hue = [...c.username].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 360;
  return c.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={c.avatarUrl} alt="" width={size} height={size} className="rounded-full object-cover ring-2 ring-white/10" style={{ width: size, height: size }} />
  ) : (
    <div className="rounded-full flex items-center justify-center font-semibold text-white ring-2 ring-white/10 shrink-0" style={{ width: size, height: size, fontSize: size / 2.6, background: `linear-gradient(135deg, hsl(${hue} 60% 45%), hsl(${(hue + 50) % 360} 60% 30%))` }} aria-hidden>
      {c.displayName.slice(0, 1).toUpperCase()}
    </div>
  );
};

const PermBadge: React.FC<{ c: Creator }> = ({ c }) => {
  const st = permissionStatus(c.permission);
  const rec = can(c, 'recording').allowed;
  const map = {
    none: ['No permission', 'text-zinc-400 bg-white/5 border-white/10', ShieldX],
    active: [rec ? 'Recording authorized' : 'Permission (no recording)', 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25', ShieldCheck],
    expiring: ['Expiring soon', 'text-amber-300 bg-amber-500/10 border-amber-500/25', ShieldAlert],
    expired: ['Permission expired', 'text-rose-300 bg-rose-500/10 border-rose-500/25', ShieldX],
    revoked: ['Revoked', 'text-rose-300 bg-rose-500/10 border-rose-500/25', ShieldX],
  } as const;
  const [label, cls, Icon] = map[st];
  return <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${cls}`}><Icon className="w-3 h-3" />{label}</span>;
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block"><span className="block text-xs text-zinc-300 mb-1">{label}</span>{children}</label>
);
const inputCls = 'w-full rounded-xl bg-zinc-950/60 border border-white/[0.07] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-400';

const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`;
};

const fmtDur = (ms: number) => { const t = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
const useNow = (active: boolean) => { const [n, setN] = useState(() => Date.now()); useEffect(() => { if (!active) return; const t = setInterval(() => setN(Date.now()), 1000); return () => clearInterval(t); }, [active]); return n; };
const sessionStart = (s: LiveSession) => Date.parse(s.startedAt ?? s.firstDetectedAt);

type Shown = 'LIVE' | 'OFFLINE' | 'UNKNOWN' | 'ERROR' | 'PAUSED' | 'CHECKING';
const shownState = (c: Creator, checking: boolean): Shown => (c.monitoring === 'paused' ? 'PAUSED' : checking ? 'CHECKING' : (c.live.state.toUpperCase() as Shown));
const CHIP: Record<Shown, string> = {
  LIVE: 'text-rose-100 bg-rose-500/20 border-rose-500/50', OFFLINE: 'text-zinc-300 bg-white/5 border-white/10', UNKNOWN: 'text-zinc-400 bg-white/5 border-white/10',
  ERROR: 'text-amber-200 bg-amber-500/10 border-amber-500/30', PAUSED: 'text-zinc-400 bg-white/5 border-white/10', CHECKING: 'text-indigo-200 bg-indigo-500/10 border-indigo-400/30',
};
const StatusChip: React.FC<{ c: Creator; checking: boolean }> = ({ c, checking }) => {
  const st = shownState(c, checking);
  return (
    <span title={st === 'ERROR' ? c.live.error?.message : undefined} className={`inline-flex items-center gap-1.5 text-[11px] font-bold tracking-wider px-2 py-0.5 rounded-full border ${CHIP[st]}`}>
      {st === 'LIVE' && <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75 animate-ping" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-rose-400" /></span>}
      {st === 'CHECKING' && <Loader2 className="w-3 h-3 animate-spin" />}
      {st === 'ERROR' && <AlertTriangle className="w-3 h-3" />}
      {st}
    </span>
  );
};

/* ───────────── Add creator ───────────── */
const AddCreator: React.FC<{ onClose: () => void; onAdded: (c: Creator) => void }> = ({ onClose, onAdded }) => {
  const [f, setF] = useState({ username: '', displayName: '', language: 'English', category: 'General', group: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { const j = await fetchJson('/api/radar/creators', { method: 'POST', body: JSON.stringify(f) }); onAdded(j.creator); }
    catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Add creator" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form onSubmit={submit} className="glass rounded-3xl w-full max-w-md p-6 flex flex-col gap-4">
        <div className="flex items-start justify-between"><div><h2 className="text-lg font-semibold text-white">Add creator</h2><p className="text-xs text-zinc-400 mt-0.5">TikTok · monitoring starts automatically.</p></div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-white/10 text-zinc-400"><X className="w-4 h-4" /></button></div>
        <Field label="TikTok username"><input autoFocus className={inputCls} placeholder="@creator_name" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></Field>
        <Field label="Display name (optional)"><input className={inputCls} value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Language"><select className={inputCls} value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}>{LANGS.map((l) => <option key={l}>{l}</option>)}</select></Field>
          <Field label="Category"><select className={inputCls} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map((l) => <option key={l}>{l}</option>)}</select></Field>
        </div>
        <Field label="Group (optional)"><input className={inputCls} placeholder="e.g. Uganda podcasts" value={f.group} onChange={(e) => setF({ ...f, group: e.target.value })} /></Field>
        {err && <p role="alert" className="text-xs text-rose-300">{err}</p>}
        <button disabled={busy || !f.username.trim()} className="flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-sm font-bold tracking-wide disabled:opacity-50 disabled:cursor-not-allowed">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} ADD CREATOR
        </button>
      </form>
    </div>
  );
};

/* ───────────── Creator detail ───────────── */
const SCOPE_LABEL: Record<keyof PermissionScope, string> = { recording: 'Recording', editing: 'Editing', redistribution: 'Redistribution', monetization: 'Monetization' };

const Detail: React.FC<{ c: Creator; sessions: LiveSession[]; checking: boolean; onClose: () => void; onChange: (c: Creator) => void; onRemoved: (id: string) => void }> = ({ c, sessions, checking, onClose, onChange, onRemoved }) => {
  const now = useNow(c.live.state === 'live');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ displayName: c.displayName, language: c.language, category: c.category, group: c.group ?? '', avatarUrl: c.avatarUrl ?? '', notes: c.notes ?? '' });
  const [grant, setGrant] = useState({ grantedBy: '', evidence: '', thirdPartyNotes: '', expiresAt: '', platforms: ['tiktok', 'youtube'], scope: { recording: true, editing: false, redistribution: false, monetization: false } as PermissionScope });
  const [granting, setGranting] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const st = permissionStatus(c.permission);

  const run = async (fn: () => Promise<{ creator?: Creator }>) => {
    setBusy(true); setErr(null);
    try { const j = await fn(); if (j.creator) onChange(j.creator); return true; } catch (x) { setErr((x as Error).message); return false; } finally { setBusy(false); }
  };
  const patch = (body: object) => run(() => fetchJson(`/api/radar/creators/${c.id}`, { method: 'PATCH', body: JSON.stringify(body) }));
  const dirty = form.displayName !== c.displayName || form.language !== c.language || form.category !== c.category || form.group !== (c.group ?? '') || form.avatarUrl !== (c.avatarUrl ?? '') || form.notes !== (c.notes ?? '');
  const p: CreatorPermission | undefined = c.permission;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`@${c.username}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="glass w-full max-w-lg h-full overflow-y-auto p-5 sm:p-6 flex flex-col gap-6 rounded-l-3xl">
        <div className="flex items-start gap-4">
          <Avatar c={c} size={72} />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-white truncate">{c.displayName}</h2>
            <div className="text-sm text-zinc-400">@{c.username} · TikTok</div>
            <div className="mt-2 flex flex-wrap gap-1.5"><PermBadge c={c} />
              <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${c.monitoring === 'active' ? 'text-indigo-200 border-indigo-400/30 bg-indigo-500/10' : 'text-zinc-400 border-white/10 bg-white/5'}`}>{c.monitoring === 'active' ? 'Monitoring' : 'Paused'}</span></div>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-white/10 text-zinc-400"><X className="w-4 h-4" /></button>
        </div>
        {err && <p role="alert" className="text-xs text-rose-300 -mt-3">{err}</p>}

        <section className="flex flex-col gap-3">
          <h3 className="text-[11px] font-semibold tracking-[0.14em] text-zinc-400 uppercase">Monitoring</h3>
          <div className="flex items-center justify-between rounded-xl bg-white/[0.03] border border-white/[0.07] px-3.5 py-2.5">
            <span className="text-sm text-zinc-200">Watch for LIVE sessions</span>
            <button disabled={busy} onClick={() => patch({ monitoring: c.monitoring === 'active' ? 'paused' : 'active' })} className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-white/[0.07] hover:bg-white/[0.12] text-white">
              {c.monitoring === 'active' ? <><Pause className="w-3.5 h-3.5" /> Pause</> : <><Play className="w-3.5 h-3.5" /> Resume</>}</button>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-white/[0.03] border border-white/[0.07] px-3.5 py-2.5">
            <span className="text-sm text-zinc-200 flex items-center gap-2">{c.notify ? <Bell className="w-4 h-4 text-indigo-300" /> : <BellOff className="w-4 h-4 text-zinc-500" />} Notify me about this creator</span>
            <Toggle checked={c.notify} onChange={(v) => patch({ notify: v })} label="Notifications" />
          </div>
          <div className="rounded-xl bg-white/[0.03] border border-white/[0.07] p-3.5 flex flex-col gap-1.5 text-xs">
            <div className="flex items-center justify-between"><StatusChip c={c} checking={checking} />
              <span className="text-zinc-500">{c.live.checkedAt ? `Last checked ${ago(c.live.checkedAt)}` : 'Not checked yet'}{c.live.provider ? ` · ${c.live.provider}` : ''}</span></div>
            {c.live.state === 'live' && (() => { const open = sessions.find((x) => !x.endedAt); return (
              <div className="text-zinc-200">On air for <b className="tabular-nums">{fmtDur(now - (open ? sessionStart(open) : now))}</b>{c.live.viewerCount != null && <> · {c.live.viewerCount.toLocaleString()} viewers</>}</div>); })()}
            {c.live.state === 'error' && <div className="text-amber-200">{c.live.error?.message} <span className="text-zinc-500">(not treated as offline; retrying with back-off)</span></div>}
            {c.live.state === 'unknown' && c.monitoring === 'active' && <div className="text-zinc-400">Waiting for the first successful check.</div>}
            {c.monitoring === 'paused' && <div className="text-zinc-400">Monitoring is paused: no checks are made.</div>}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-[11px] font-semibold tracking-[0.14em] text-zinc-400 uppercase">Permission &amp; rights</h3>
          {p && st !== 'none' && (
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.07] p-3.5 text-sm flex flex-col gap-2">
              <div className="flex flex-wrap gap-1.5">{(Object.keys(SCOPE_LABEL) as (keyof PermissionScope)[]).map((k) => (
                <span key={k} className={`text-[11px] px-2 py-0.5 rounded-full border ${p.scope[k] ? 'text-emerald-200 border-emerald-500/30 bg-emerald-500/10' : 'text-zinc-500 border-white/10 line-through'}`}>{SCOPE_LABEL[k]}</span>))}</div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-zinc-500">Granted by</dt><dd className="text-zinc-200">{p.grantedBy}</dd>
                <dt className="text-zinc-500">Evidence</dt><dd className="text-zinc-200 break-words">{p.evidence}</dd>
                <dt className="text-zinc-500">Platforms</dt><dd className="text-zinc-200">{p.platforms.join(', ') || 'Any'}</dd>
                <dt className="text-zinc-500">Granted</dt><dd className="text-zinc-200">{p.grantedAt.slice(0, 10)}</dd>
                <dt className="text-zinc-500">Expires</dt><dd className="text-zinc-200">{p.expiresAt ? p.expiresAt.slice(0, 10) : 'No expiry'}</dd>
                {p.revokedAt && <><dt className="text-zinc-500">Revoked</dt><dd className="text-rose-300">{p.revokedAt.slice(0, 10)}</dd></>}
                {p.thirdPartyNotes && <><dt className="text-zinc-500">Not covered</dt><dd className="text-amber-200">{p.thirdPartyNotes}</dd></>}
              </dl>
              {st !== 'revoked' && <button disabled={busy} onClick={() => run(() => fetchJson(`/api/radar/creators/${c.id}/permission`, { method: 'DELETE', body: JSON.stringify({}) }))} className="self-start text-xs font-medium text-rose-300 hover:text-rose-200 mt-1">Revoke permission</button>}
            </div>
          )}
          {!granting ? (
            <button onClick={() => setGranting(true)} className="self-start text-sm font-medium px-3.5 py-2 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] border border-white/10 text-white">{p && st !== 'none' ? 'Record new permission' : 'Record permission'}</button>
          ) : (
            <div className="rounded-xl border border-white/10 p-3.5 flex flex-col gap-3">
              <p className="text-xs text-zinc-400">Only record permission the creator has actually given you. Public visibility is not permission.</p>
              <Field label="Granted by"><input className={inputCls} value={grant.grantedBy} onChange={(e) => setGrant({ ...grant, grantedBy: e.target.value })} placeholder="Creator or authorised representative" /></Field>
              <Field label="How was consent given?"><input className={inputCls} value={grant.evidence} onChange={(e) => setGrant({ ...grant, evidence: e.target.value })} placeholder="e.g. signed agreement, email dated…" /></Field>
              <div><span className="block text-xs text-zinc-300 mb-1.5">Covers</span><div className="grid grid-cols-2 gap-2">{(Object.keys(SCOPE_LABEL) as (keyof PermissionScope)[]).map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm text-zinc-200"><input type="checkbox" checked={grant.scope[k]} onChange={(e) => setGrant({ ...grant, scope: { ...grant.scope, [k]: e.target.checked } })} />{SCOPE_LABEL[k]}</label>))}</div></div>
              <div><span className="block text-xs text-zinc-300 mb-1.5">Platforms</span><div className="flex gap-4">{['tiktok', 'youtube', 'instagram', 'facebook'].map((pl) => (
                <label key={pl} className="flex items-center gap-1.5 text-xs text-zinc-200 capitalize"><input type="checkbox" checked={grant.platforms.includes(pl)} onChange={(e) => setGrant({ ...grant, platforms: e.target.checked ? [...grant.platforms, pl] : grant.platforms.filter((x) => x !== pl) })} />{pl}</label>))}</div></div>
              <Field label="Expires (optional)"><input type="date" className={inputCls} value={grant.expiresAt} onChange={(e) => setGrant({ ...grant, expiresAt: e.target.value })} /></Field>
              <Field label="Not covered: guests, music, third-party material (optional)"><input className={inputCls} value={grant.thirdPartyNotes} onChange={(e) => setGrant({ ...grant, thirdPartyNotes: e.target.value })} /></Field>
              <div className="flex gap-2">
                <button disabled={busy} onClick={async () => { if (await run(() => fetchJson(`/api/radar/creators/${c.id}/permission`, { method: 'PUT', body: JSON.stringify({ ...grant, expiresAt: grant.expiresAt ? new Date(grant.expiresAt + 'T23:59:59').toISOString() : undefined }) }))) setGranting(false); }} className="px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-semibold">Save permission</button>
                <button onClick={() => setGranting(false)} className="px-3 py-2 text-sm text-zinc-400 hover:text-white">Cancel</button></div>
            </div>
          )}
          <ul className="text-xs text-zinc-400 grid grid-cols-2 gap-x-4 gap-y-1">
            {(['recording', 'editing', 'redistribution', 'monetization'] as const).map((a) => { const d = can(c, a); return <li key={a} className="flex items-center gap-1.5">{d.allowed ? <ShieldCheck className="w-3 h-3 text-emerald-400" /> : <ShieldX className="w-3 h-3 text-zinc-600" />}<span className={d.allowed ? 'text-zinc-200' : ''} title={d.reason}>{SCOPE_LABEL[a]} {d.allowed ? 'allowed' : 'blocked'}</span></li>; })}
          </ul>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-[11px] font-semibold tracking-[0.14em] text-zinc-400 uppercase">Profile</h3>
          <Field label="Display name"><input className={inputCls} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Language"><select className={inputCls} value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>{[...new Set([...LANGS, form.language])].map((l) => <option key={l}>{l}</option>)}</select></Field>
            <Field label="Category"><select className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{[...new Set([...CATS, form.category])].map((l) => <option key={l}>{l}</option>)}</select></Field>
          </div>
          <Field label="Group"><input className={inputCls} value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value })} /></Field>
          <Field label="Profile picture URL (optional)"><input className={inputCls} value={form.avatarUrl} onChange={(e) => setForm({ ...form, avatarUrl: e.target.value })} placeholder="https://…" /></Field>
          <Field label="Notes"><textarea rows={2} className={inputCls} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          {dirty && <button disabled={busy} onClick={() => patch(form)} className="self-start px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-semibold">Save changes</button>}
        </section>

        <section>
          <h3 className="text-[11px] font-semibold tracking-[0.14em] text-zinc-400 uppercase mb-2 flex items-center gap-1.5"><Radar className="w-3.5 h-3.5" /> Broadcast history</h3>
          {sessions.length === 0 ? <p className="text-xs text-zinc-500">No broadcasts detected yet.</p> : (
            <ul className="flex flex-col gap-2">{sessions.slice(0, 10).map((x) => (
              <li key={x.id} className="rounded-xl bg-white/[0.03] border border-white/[0.07] px-3 py-2 text-xs flex flex-col gap-0.5">
                <div className="flex items-center justify-between gap-2"><span className="text-zinc-200">{new Date(x.startedAt ?? x.firstDetectedAt).toLocaleString()}</span>
                  <span className={x.endedAt ? 'text-zinc-400' : 'text-rose-300 font-semibold'}>{x.endedAt ? fmtDur(Date.parse(x.endedAt) - sessionStart(x)) : 'LIVE now'}</span></div>
                <div className="text-zinc-500">{x.endedAt ? (x.endConfirmed ? 'Ended (confirmed)' : 'Contact lost, end unconfirmed') : `Detected ${ago(x.firstDetectedAt)}`}{x.peakViewers ? ` · peak ${x.peakViewers.toLocaleString()}` : ''} · {x.provider} · recording {x.recordingAuthorized ? 'permitted' : 'not permitted'}</div>
              </li>))}</ul>)}
        </section>

        <section>
          <h3 className="text-[11px] font-semibold tracking-[0.14em] text-zinc-400 uppercase mb-2 flex items-center gap-1.5"><History className="w-3.5 h-3.5" /> Audit history</h3>
          <ol className="flex flex-col gap-2">{c.audit.slice(0, 15).map((a, i) => (
            <li key={i} className="text-xs flex gap-3"><span className="text-zinc-500 w-16 shrink-0">{ago(a.at)}</span><span className="text-zinc-200">{a.action}{a.detail && <span className="text-zinc-500"> · {a.detail}</span>}</span></li>))}</ol>
        </section>

        <div className="mt-auto pt-4 border-t border-white/[0.06]">
          {!confirmRemove ? (
            <button onClick={() => setConfirmRemove(true)} className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-rose-300"><Trash2 className="w-3.5 h-3.5" /> Remove creator</button>
          ) : (
            <div className="flex items-center gap-3 text-xs"><span className="text-zinc-300">Remove @{c.username} and their permission record?</span>
              <button onClick={async () => { if (await run(() => fetchJson(`/api/radar/creators/${c.id}`, { method: 'DELETE' }))) onRemoved(c.id); }} className="px-3 py-1.5 rounded-lg bg-rose-500/20 text-rose-200 font-medium">Remove</button>
              <button onClick={() => setConfirmRemove(false)} className="text-zinc-400">Cancel</button></div>
          )}
        </div>
      </div>
    </div>
  );
};

const Metric: React.FC<{ label: string; value: string | number; note?: string; dim?: boolean }> = ({ label, value, note, dim }) => (
  <div className="glass rounded-2xl px-4 py-3.5 min-w-0">
    <div className="text-[11px] tracking-wide text-zinc-400 uppercase truncate">{label}</div>
    <div className={`text-2xl font-semibold tabular-nums mt-1 ${dim ? 'text-zinc-600' : 'text-white'}`}>{value}</div>
    {note && <div className="text-[11px] text-zinc-500 mt-0.5 truncate">{note}</div>}
  </div>
);

/* ───────────── Workspace ───────────── */
type PermFilter = 'all' | 'authorized' | 'unavailable';

interface MonitorStatus { running: boolean; lastTickAt?: string; checksTotal: number; failuresTotal: number; cooldownUntil?: string; lastError?: string; provider: { id: string; name: string; dataSource: string; platformTermsRisk: string } | null; problem: string | null; intervalMs: number }
type StatusFilter = 'all' | 'live' | 'offline' | 'error' | 'unknown' | 'paused';

const Bell_: React.FC<{ items: RadarNotification[]; onRead: () => void }> = ({ items, onRead }) => {
  const [open, setOpen] = useState(false);
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(() => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission));
  const unread = items.filter((n) => !n.read).length;
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open} className="relative p-2.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-zinc-200">
        <Bell className="w-4 h-4" />{unread > 0 && <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">{unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-[min(22rem,calc(100vw-2rem))] glass rounded-2xl p-3 z-40 shadow-2xl">
          <div className="flex items-center justify-between px-1 pb-2"><span className="text-sm font-semibold text-white">Notifications</span>
            {unread > 0 && <button onClick={onRead} className="text-xs text-indigo-300 hover:text-indigo-200">Mark all read</button>}</div>
          {perm === 'default' && <button onClick={async () => setPerm(await Notification.requestPermission())} className="w-full text-left text-xs rounded-lg bg-indigo-500/10 border border-indigo-400/25 text-indigo-200 px-3 py-2 mb-2">Turn on browser notifications for LIVE alerts</button>}
          {perm === 'denied' && <p className="text-[11px] text-zinc-500 px-1 pb-2">Browser notifications are blocked in this browser&apos;s site settings.</p>}
          <ul className="max-h-80 overflow-y-auto flex flex-col gap-1.5">
            {items.length === 0 && <li className="text-xs text-zinc-500 px-1 py-3">Nothing yet. LIVE alerts will appear here.</li>}
            {items.slice(0, 30).map((n) => (
              <li key={n.id} className={`rounded-xl px-3 py-2 text-xs border ${n.read ? 'border-white/[0.05] bg-white/[0.02]' : 'border-indigo-400/25 bg-indigo-500/[0.07]'}`}>
                <div className={`font-bold tracking-wide ${n.kind === 'live-detected' ? 'text-rose-300' : n.kind === 'provider-error' ? 'text-amber-300' : 'text-zinc-200'}`}>{n.title}</div>
                <div className="text-zinc-300 mt-0.5 leading-snug">{n.body}</div><div className="text-zinc-500 mt-1">{ago(n.at)}</div>
              </li>))}
          </ul>
        </div>
      )}
    </div>
  );
};

export const RadarWorkspace: React.FC = () => {
  const [creators, setCreators] = useState<Creator[] | null>(null);
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [notes, setNotes] = useState<RadarNotification[]>([]);
  const [status, setStatus] = useState<MonitorStatus | null>(null);
  const [checking, setChecking] = useState<Set<string>>(() => new Set());
  const [connected, setConnected] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [lang, setLang] = useState('all'); const [cat, setCat] = useState('all'); const [group, setGroup] = useState('all');
  const [perm, setPerm] = useState<PermFilter>('all');
  const [stat, setStat] = useState<StatusFilter>('all');

  // Initial load + resync. Called on first load and every time the event stream (re)connects, so nothing is missed.
  const sync = useCallback(async () => {
    try {
      const [c, s, n, m] = await Promise.all([fetchJson('/api/radar/creators'), fetchJson('/api/radar/sessions?limit=300'), fetchJson('/api/radar/notifications'), fetchJson('/api/radar/status')]);
      setCreators(c.creators); setSessions(s.sessions); setNotes(n.notifications); setStatus(m.monitor); setLoadErr(null);
    } catch (e) { setLoadErr((e as Error).message); }
  }, []);

  // Live updates pushed from the backend (SSE). No polling of creator status from the browser.
  useEffect(() => {
    const es = new EventSource('/api/radar/events');
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);          // EventSource reconnects by itself
    es.onmessage = (m) => {
      const e = JSON.parse(m.data);
      if (e.type === 'hello') void sync();
      else if (e.type === 'creator-updated') setCreators((l) => { const cur = l ?? []; return cur.some((x) => x.id === e.creator.id) ? cur.map((x) => (x.id === e.creator.id ? e.creator : x)) : [e.creator, ...cur]; });
      else if (e.type === 'creator-removed') setCreators((l) => (l ?? []).filter((x) => x.id !== e.id));
      else if (e.type === 'session') setSessions((l) => [e.session, ...l.filter((x) => x.id !== e.session.id)].sort((a, b) => b.firstDetectedAt.localeCompare(a.firstDetectedAt)));
      else if (e.type === 'notification') {
        setNotes((l) => [e.notification, ...l]);
        if (e.notification.kind === 'live-detected' && typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(e.notification.title, { body: e.notification.body, tag: e.notification.id });
      } else if (e.type === 'notifications-read') setNotes((l) => l.map((n) => (e.ids === 'all' || e.ids.includes(n.id) ? { ...n, read: true } : n)));
      else if (e.type === 'checking') setChecking((s) => { const n = new Set(s); if (e.on) n.add(e.creatorId); else n.delete(e.creatorId); return n; });
      else if (e.type === 'provider-status') fetchJson('/api/radar/status').then((j) => setStatus(j.monitor), () => undefined);
    };
    return () => es.close();
  }, [sync]);

  // Light refresh of monitor health only (counters / last check), not of creator status.
  useEffect(() => { const t = setInterval(() => fetchJson('/api/radar/status').then((j) => setStatus(j.monitor), () => undefined), 15000); return () => clearInterval(t); }, []);

  const list = useMemo(() => creators ?? [], [creators]);
  const liveNow = useMemo(() => list.filter((c) => c.live.state === 'live' && c.monitoring === 'active'), [list]);
  const clock = useNow(liveNow.length > 0);
  const openSessionOf = useCallback((id: string) => sessions.find((x) => x.creatorId === id && !x.endedAt), [sessions]);
  const lastSessionOf = useCallback((id: string) => sessions.find((x) => x.creatorId === id && x.endedAt), [sessions]);
  const langs = useMemo(() => [...new Set(list.map((c) => c.language))], [list]);
  const cats = useMemo(() => [...new Set(list.map((c) => c.category))], [list]);
  const groups = useMemo(() => [...new Set(list.map((c) => c.group).filter(Boolean) as string[])], [list]);

  const shown = useMemo(() => list.filter((c) => {
    if (q && !`${c.username} ${c.displayName}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (lang !== 'all' && c.language !== lang) return false;
    if (cat !== 'all' && c.category !== cat) return false;
    if (group !== 'all' && c.group !== group) return false;
    if (stat !== 'all' && shownState(c, false).toLowerCase() !== stat) return false;
    const rec = can(c, 'recording').allowed;
    if (perm === 'authorized' && !rec) return false;
    if (perm === 'unavailable' && rec) return false;
    return true;
  }), [list, q, lang, cat, group, perm, stat]);

  const activity = useMemo(() => {
    const fromAudit = list.flatMap((c) => c.audit.map((a) => ({ at: a.at, text: `${a.action}${a.detail ? ` · ${a.detail}` : ''}`, user: c.username })));
    return fromAudit.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10);
  }, [list]);
  const open = list.find((c) => c.id === openId) ?? null;
  const authorized = list.filter((c) => can(c, 'recording').allowed).length;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const detectedToday = sessions.filter((x) => Date.parse(x.firstDetectedAt) >= today.getTime()).length;
  const monitored = list.filter((c) => c.monitoring === 'active').length;

  const togglePause = async (c: Creator) => { try { await fetchJson(`/api/radar/creators/${c.id}`, { method: 'PATCH', body: JSON.stringify({ monitoring: c.monitoring === 'active' ? 'paused' : 'active' }) }); } catch (e) { setLoadErr((e as Error).message); } };
  const sel = 'rounded-full bg-zinc-950/60 border border-white/10 px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-indigo-400 cursor-pointer';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium"><span className="text-indigo-300 flex items-center gap-1.5"><Radar className="w-3.5 h-3.5" /> Creator monitoring</span>
            <span className={`flex items-center gap-1 ${connected ? 'text-emerald-300' : 'text-zinc-500'}`} title={connected ? 'Receiving live updates from the server' : 'Reconnecting…'}><span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-zinc-600'}`} />{connected ? 'Real-time' : 'Reconnecting'}</span></div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight">Live Radar</h1>
        </div>
        <div className="flex items-center gap-2"><Bell_ items={notes} onRead={() => void fetchJson('/api/radar/notifications', { method: 'POST', body: JSON.stringify({ ids: 'all' }) })} />
          <button onClick={() => setAdding(true)} className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-400 hover:to-violet-400 text-white text-sm font-bold tracking-wide shadow-lg shadow-indigo-600/30"><Plus className="w-4 h-4" /> ADD CREATOR</button></div>
      </div>
      {flash && <p role="status" className="text-sm text-emerald-300 -mt-3">{flash}</p>}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Metric label="Creators monitored" value={monitored} note={`${list.length} total`} />
        <Metric label="Currently live" value={status?.problem ? '—' : liveNow.length} note={status?.problem ? 'No provider' : 'From the latest checks'} dim={!!status?.problem} />
        <Metric label="Detected today" value={status?.problem && sessions.length === 0 ? '—' : detectedToday} note="LIVE sessions" dim={!!status?.problem && sessions.length === 0} />
        <Metric label="Recording authorized" value={authorized} note="With valid permission" />
        <Metric label="Processing" value="—" note="Recorder: Phase 3" dim />
        <Metric label="Archived" value="—" note="Recorder: Phase 3" dim />
      </div>

      {status?.problem && (
        <div role="alert" className="rounded-2xl border border-amber-400/30 bg-amber-400/[0.07] p-4 flex gap-3 text-sm">
          <AlertTriangle className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1"><b className="text-amber-100">Automatic detection is not running</b>
            <p className="text-amber-100/90 leading-relaxed">{status.problem}</p>
            <p className="text-xs text-zinc-400">Creators are saved and will be checked as soon as a provider is configured. Set these in <code className="text-zinc-200">.env.local</code> and restart the server. See <code className="text-zinc-200">docs/LIVE_RADAR_SETUP.md</code>. Until then, every creator shows UNKNOWN: nothing is guessed.</p></div>
        </div>
      )}

      <section aria-label="Currently live" className="glass rounded-3xl p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2 mb-4"><span className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-rose-300 bg-rose-500/15 border border-rose-500/30 rounded-full px-2 py-0.5"><span className="w-1.5 h-1.5 rounded-full bg-rose-400" />LIVE</span><h2 className="text-sm font-semibold text-white">Currently live</h2>
          {status && !status.problem && <span className="ml-auto text-[11px] text-zinc-500">{status.provider?.name} · checks every {Math.round(status.intervalMs / 1000)}s{status.lastTickAt ? ` · monitor active` : ''}{status.cooldownUntil ? ' · cooling down (rate limit)' : ''}</span>}</div>
        {liveNow.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {liveNow.map((c) => { const so = openSessionOf(c.id); return (
              <button key={c.id} onClick={() => setOpenId(c.id)} className="text-left rounded-2xl p-4 bg-gradient-to-br from-rose-500/[0.12] to-white/[0.03] border border-rose-500/40 hover:border-rose-400/70 flex flex-col gap-3 transition-colors">
                <div className="flex items-center gap-3 min-w-0"><div className="rounded-full ring-2 ring-rose-500 p-0.5"><Avatar c={c} size={52} /></div>
                  <div className="min-w-0"><div className="font-semibold text-white truncate">{c.displayName}</div><div className="text-xs text-zinc-400 truncate">@{c.username}</div></div>
                  <span className="ml-auto"><StatusChip c={c} checking={false} /></span></div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <span className="text-zinc-500">On air</span><span className="text-white font-semibold tabular-nums">{fmtDur(clock - (so ? sessionStart(so) : clock))}</span>
                  <span className="text-zinc-500">Viewers</span><span className="text-zinc-200">{c.live.viewerCount != null ? c.live.viewerCount.toLocaleString() : 'not reported'}</span>
                  <span className="text-zinc-500">Last detected</span><span className="text-zinc-200">{c.live.lastSuccessAt ? ago(c.live.lastSuccessAt) : '—'}</span>
                  <span className="text-zinc-500">Language</span><span className="text-zinc-200">{c.language}</span>
                  <span className="text-zinc-500">Provider</span><span className="text-zinc-200 truncate">{c.live.provider ?? '—'}</span></div>
                <div className="flex items-center justify-between"><PermBadge c={c} /><span className="flex items-center gap-1 text-xs text-zinc-300"><Eye className="w-3.5 h-3.5" /> View details</span></div>
              </button>); })}
          </div>
        ) : (
          <p className="flex items-start gap-3 text-sm text-zinc-400"><Info className="w-4 h-4 shrink-0 mt-0.5 text-zinc-500" />
            {status?.problem ? 'No creator can be shown as live while detection is not configured.' : monitored === 0 ? 'Add a creator to start monitoring.' : `None of your ${monitored} monitored creator${monitored === 1 ? ' is' : 's are'} live right now. The server checks automatically; this page updates by itself.`}</p>
        )}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
        <section aria-label="Monitored creators" className="flex flex-col gap-4 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[180px]"><Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search creators" aria-label="Search creators" className="w-full rounded-full bg-zinc-950/60 border border-white/10 pl-9 pr-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-400" /></div>
            <select aria-label="Status" className={sel} value={stat} onChange={(e) => setStat(e.target.value as StatusFilter)}><option value="all">All status</option><option value="live">Currently live</option><option value="offline">Offline</option><option value="error">Error</option><option value="unknown">Unknown</option><option value="paused">Paused</option></select>
            <select aria-label="Recording permission" className={sel} value={perm} onChange={(e) => setPerm(e.target.value as PermFilter)}><option value="all">Any permission</option><option value="authorized">Recording authorized</option><option value="unavailable">Recording unavailable</option></select>
            <select aria-label="Language" className={sel} value={lang} onChange={(e) => setLang(e.target.value)}><option value="all">All languages</option>{langs.map((l) => <option key={l}>{l}</option>)}</select>
            <select aria-label="Category" className={sel} value={cat} onChange={(e) => setCat(e.target.value)}><option value="all">All categories</option>{cats.map((l) => <option key={l}>{l}</option>)}</select>
            {groups.length > 0 && <select aria-label="Group" className={sel} value={group} onChange={(e) => setGroup(e.target.value)}><option value="all">All groups</option>{groups.map((l) => <option key={l}>{l}</option>)}</select>}
          </div>

          {loadErr && <p role="alert" className="text-sm text-rose-300">{loadErr} <button onClick={() => void sync()} className="underline">Retry</button></p>}
          {creators === null && !loadErr && <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-3">{[0, 1, 2].map((i) => <div key={i} className="glass rounded-2xl h-36 animate-pulse" />)}</div>}
          {creators && list.length === 0 && (
            <div className="glass rounded-3xl p-10 text-center flex flex-col items-center gap-3"><Users className="w-8 h-8 text-zinc-500" />
              <h3 className="text-white font-semibold">No creators yet</h3><p className="text-sm text-zinc-400 max-w-sm">Add a TikTok username. Monitoring starts automatically and the server keeps watching even when this page is closed.</p>
              <button onClick={() => setAdding(true)} className="mt-1 px-4 py-2 rounded-xl bg-white text-zinc-950 text-sm font-semibold">Add your first creator</button></div>
          )}
          {creators && list.length > 0 && shown.length === 0 && <p className="text-sm text-zinc-400 py-6 text-center">No creators match these filters.</p>}

          <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-3">
            {shown.map((c) => { const last = lastSessionOf(c.id); return (
              <div key={c.id} className={`glass rounded-2xl p-4 flex flex-col gap-3 hover:border-white/25 transition-colors ${c.monitoring === 'paused' ? 'opacity-75' : ''} ${c.live.state === 'live' && c.monitoring === 'active' ? 'border-rose-500/40' : ''}`}>
                <button onClick={() => setOpenId(c.id)} className="text-left flex flex-col gap-3 min-w-0">
                  <div className="flex items-center gap-3 min-w-0"><Avatar c={c} size={56} />
                    <div className="min-w-0 flex-1"><div className="font-semibold text-white truncate">{c.displayName}</div><div className="text-xs text-zinc-400 truncate">@{c.username}</div></div>
                    <StatusChip c={c} checking={checking.has(c.id)} /></div>
                  <div className="flex flex-wrap gap-1.5"><PermBadge c={c} />
                    <span className="text-[11px] text-zinc-300 px-2 py-0.5 rounded-full bg-white/5 border border-white/10">{c.language}</span>
                    <span className="text-[11px] text-zinc-300 px-2 py-0.5 rounded-full bg-white/5 border border-white/10">{c.category}</span></div>
                  <div className="text-[11px] text-zinc-500 leading-snug">
                    {c.monitoring === 'paused' ? 'Monitoring paused' : c.live.state === 'error' ? <span className="text-amber-300/90">{c.live.error?.message}</span> : c.live.state === 'unknown' ? (status?.problem ? 'Waiting for a detection provider' : 'Waiting for the first check') : c.live.state === 'live' ? `Live since ${new Date(sessionStartOf(openSessionOf(c.id), c)).toLocaleTimeString()}` : last ? `Last live ${ago(last.endedAt!)} · ${fmtDur(Date.parse(last.endedAt!) - sessionStart(last))}` : 'Offline · no broadcasts seen yet'}
                    {c.live.checkedAt && c.monitoring === 'active' && <span> · checked {ago(c.live.checkedAt)}</span>}</div>
                </button>
                <div className="flex items-center justify-between"><span className="truncate text-[11px] text-zinc-500 max-w-[55%]">{c.group ?? ''}</span>
                  <button onClick={() => void togglePause(c)} className="flex items-center gap-1 text-[11px] font-medium text-zinc-300 hover:text-white px-2 py-1 rounded-lg hover:bg-white/10">{c.monitoring === 'active' ? <><Pause className="w-3 h-3" /> Pause</> : <><Play className="w-3 h-3" /> Resume</>}</button></div>
              </div>); })}
          </div>
        </section>

        <aside aria-label="Recent activity" className="glass rounded-3xl p-5">
          <h2 className="text-sm font-semibold text-white mb-3">Recent activity</h2>
          {activity.length === 0 ? <p className="text-xs text-zinc-500">Detections and permission changes will appear here.</p> : (
            <ol className="flex flex-col gap-3">{activity.map((a, i) => (
              <li key={i} className="flex gap-3 text-xs"><div className="mt-1 w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" /><div className="min-w-0"><div className="text-zinc-200"><b className="font-medium">@{a.user}</b> · {a.text}</div><div className="text-zinc-500">{ago(a.at)}</div></div></li>))}</ol>
          )}
        </aside>
      </div>

      {adding && <AddCreator onClose={() => setAdding(false)} onAdded={(c) => { setAdding(false); setFlash(`Monitoring started for @${c.username}. The server will check automatically.`); setTimeout(() => setFlash(null), 6000); }} />}
      {open && <Detail key={open.id + open.updatedAt} c={open} sessions={sessions.filter((x) => x.creatorId === open.id)} checking={checking.has(open.id)} onClose={() => setOpenId(null)} onChange={(c) => setCreators((l) => (l ?? []).map((x) => (x.id === c.id ? c : x)))} onRemoved={(id) => { setCreators((l) => (l ?? []).filter((x) => x.id !== id)); setOpenId(null); }} />}
    </div>
  );
};

const sessionStartOf = (s: LiveSession | undefined, c: Creator) => (s ? sessionStart(s) : Date.parse(c.live.since ?? new Date().toISOString()));
