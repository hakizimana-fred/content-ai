'use client';

import React from 'react';
import { X, Command } from 'lucide-react';

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const shortcuts = [
    { key: 'Space', desc: 'Play / Pause' },
    { key: 'I', desc: 'Set start at the playhead' },
    { key: 'O', desc: 'Set end at the playhead' },
    { key: 'P', desc: 'Play the selection (stops at the end)' },
    { key: 'Esc', desc: 'Stop preview and return to where you were' },
    { key: '[  /  ]', desc: 'Jump to selection start / end' },
    { key: 'X', desc: 'Clear selection' },
    { key: 'R', desc: 'Select the whole video' },
    { key: 'Ctrl + Enter', desc: 'Cut video' },
    { key: 'Enter', desc: 'Add selection to the Clips queue' },
    { key: '← / →', desc: 'Back / forward 1 second' },
    { key: 'Shift + ← / →', desc: 'Back / forward 1 frame' },
    { key: 'J / L', desc: 'Back / forward 5 seconds' },
    { key: 'M', desc: 'Mute / Unmute' },
    { key: '↑ / ↓ in a time field', desc: '±1s (Shift 10s · Alt 0.1s · Ctrl 1 frame)' },
    { key: '← / → on a handle', desc: 'Nudge 0.1s (Shift 1s)' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl p-6 text-zinc-100 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between pb-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Command className="w-5 h-5 text-indigo-400" />
            <h3 className="font-semibold text-base">Editor Shortcuts</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4 divide-y divide-zinc-800/60">
          {shortcuts.map((s, idx) => (
            <div key={idx} className="py-2.5 flex items-center justify-between text-xs sm:text-sm">
              <span className="text-zinc-400">{s.desc}</span>
              <kbd className="px-2 py-1 bg-zinc-800 border border-zinc-700/60 rounded font-mono text-zinc-200 text-xs shadow-inner">
                {s.key}
              </kbd>
            </div>
          ))}
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
};
