'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronUp, ChevronDown, Crosshair, LocateFixed } from 'lucide-react';
import { formatTimecode, parseTimecodeStrict } from '@/lib/timecode';

interface TimeFieldProps {
  label: string;
  /** Source of truth lives in the parent: seconds, or null when empty. */
  value: number | null;
  duration: number;
  /** Called on every keystroke that parses to a valid time, and for steppers. null = field emptied. */
  onChange: (seconds: number | null) => void;
  /** Reports a syntax problem with the typed text (or null) so the parent can block cutting. */
  onSyntaxError: (message: string | null) => void;
  /** Problem with the value from selection-level validation (range, beyond duration, ...). */
  error?: string;
  /** Used as stepping base when the field is empty. */
  playhead: number;
  onUsePlayhead: () => void;
  onJump: () => void;
  shortcut: string;
  accent: 'emerald' | 'amber';
  /** Fires on Ctrl/Cmd+Enter inside the field. */
  onSubmit?: () => void;
}

const ACCENT = {
  emerald: { ring: 'focus-within:border-emerald-400/70 focus-within:ring-emerald-400/20', dot: 'bg-emerald-400', text: 'text-emerald-300' },
  amber: { ring: 'focus-within:border-amber-400/70 focus-within:ring-amber-400/20', dot: 'bg-amber-400', text: 'text-amber-300' },
};

/**
 * Timestamp input synchronised with the shared selection.
 * - Typing applies live as soon as the text is a valid time (timeline follows immediately).
 * - Invalid text is never replaced or corrected; it stays visible with an explanation.
 * - ArrowUp/Down step: 1s, Shift 10s, Alt 0.1s, Ctrl/Cmd 1 frame (~0.033s).
 */
export const TimeField: React.FC<TimeFieldProps> = ({
  label, value, duration, onChange, onSyntaxError, error, playhead, onUsePlayhead, onJump, shortcut, accent, onSubmit,
}) => {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value === null ? '' : formatTimecode(value));
  const [syntaxError, setSyntaxError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const typing = useRef(false);
  const c = ACCENT[accent];

  // External change (timeline drag, I/O keys, AI moment...) -> reflect it, unless the user is mid-edit.
  useEffect(() => {
    if (typing.current && document.activeElement === inputRef.current) return;
    setDraft(value === null ? '' : formatTimecode(value));
    setSyntaxError(null);
    onSyntaxError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleChange = (text: string) => {
    typing.current = true;
    setDraft(text);
    if (text.trim() === '') {
      setSyntaxError('Enter a time, e.g. 00:02:15.000');
      onSyntaxError('Enter a time, e.g. 00:02:15.000');
      onChange(null);
      return;
    }
    const r = parseTimecodeStrict(text);
    if (r.ok) {
      setSyntaxError(null);
      onSyntaxError(null);
      onChange(r.seconds);
    } else {
      setSyntaxError(r.error);
      onSyntaxError(r.error);
    }
  };

  const step = (dir: 1 | -1, e?: { shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => {
    const size = e?.shiftKey ? 10 : e?.altKey ? 0.1 : e?.ctrlKey || e?.metaKey ? 1 / 30 : 1;
    const base = value ?? playhead;
    // Stepping stays inside the video; typed values are validated instead of clamped.
    const next = Math.round(Math.min(duration, Math.max(0, base + dir * size)) * 1000) / 1000;
    typing.current = false;
    onChange(next);
    setDraft(formatTimecode(next));
    setSyntaxError(null);
    onSyntaxError(null);
  };

  const shown = syntaxError ?? error;
  const showError = !!shown && (touched || !!error);

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label htmlFor={id} className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.14em] text-zinc-400 uppercase">
          <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
          {label}
        </label>
        <button
          type="button"
          onClick={onUsePlayhead}
          className={`flex items-center gap-1 text-[11px] font-medium ${c.text} hover:text-white transition-colors`}
          title={`Use the current video position as ${label.toLowerCase()} [${shortcut}]`}
        >
          <Crosshair className="w-3 h-3" />
          Use playhead <kbd className="ml-0.5 px-1 rounded bg-white/5 font-mono text-[10px] text-zinc-400">{shortcut}</kbd>
        </button>
      </div>

      <div className="flex items-stretch gap-2">
        <div
          className={`flex-1 flex items-center rounded-xl bg-zinc-950/70 border transition-all focus-within:ring-4 ${c.ring} ${
            showError ? 'border-rose-500/70' : 'border-white/10'
          }`}
        >
          <input
            id={id}
            ref={inputRef}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            placeholder="00:00:00.000"
            aria-invalid={showError}
            aria-describedby={showError ? `${id}-err` : undefined}
            onChange={(e) => handleChange(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => {
              typing.current = false;
              setTouched(true);
              // Valid text -> normalise display (e.g. "2:15" -> "00:02:15.000"). Invalid text is left untouched.
              const r = parseTimecodeStrict(draft);
              if (r.ok) setDraft(formatTimecode(r.seconds));
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp') { e.preventDefault(); step(1, e); }
              else if (e.key === 'ArrowDown') { e.preventDefault(); step(-1, e); }
              else if (e.key === 'Enter') {
                e.preventDefault();
                setTouched(true);
                if ((e.ctrlKey || e.metaKey) && onSubmit) onSubmit();
                else e.currentTarget.blur();
              }
            }}
            className="flex-1 min-w-0 bg-transparent px-3.5 py-3 font-mono text-lg tracking-wide text-white placeholder:text-zinc-600 focus:outline-none"
          />
          <div className="flex flex-col border-l border-white/10 mr-1">
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => step(1, e)}
              className="px-1.5 py-0.5 text-zinc-500 hover:text-white transition-colors"
              title="+1 second (Shift 10s, Alt 0.1s, Ctrl 1 frame). Or press ↑"
              aria-label={`Increase ${label}`}
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => step(-1, e)}
              className="px-1.5 py-0.5 text-zinc-500 hover:text-white transition-colors"
              title="-1 second (Shift 10s, Alt 0.1s, Ctrl 1 frame). Or press ↓"
              aria-label={`Decrease ${label}`}
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={onJump}
          disabled={value === null}
          className="px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title={`Jump the video to this ${label.toLowerCase()}`}
          aria-label={`Jump to ${label}`}
        >
          <LocateFixed className="w-4 h-4" />
        </button>
      </div>

      <p id={`${id}-err`} role={showError ? 'alert' : undefined} className={`mt-1.5 text-xs min-h-4 ${showError ? 'text-rose-400' : 'text-transparent'}`}>
        {showError ? shown : '.'}
      </p>
    </div>
  );
};
