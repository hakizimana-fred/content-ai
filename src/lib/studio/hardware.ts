import os from 'node:os';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

export type HardwareTier = 'low' | 'standard' | 'high';

export interface HardwareProfile {
  cpu: { model: string; cores: number; avx2: boolean; avx512: boolean };
  ramMB: { total: number; available: number };
  gpu: { name: string | null; vendor: 'nvidia' | 'amd' | 'intel' | 'none'; vramMB: number | null; cuda: boolean };
  diskFreeMB: number | null;
  tier: HardwareTier;
  /** Max RAM (MB) all loaded models together may use. */
  modelRamBudgetMB: number;
  /** Threads to give CPU inference (leave one core for the app/ffmpeg). */
  inferenceThreads: number;
  allowGpuInference: boolean;
  reasons: string[];
}

function run(cmd: string, args: string[]): string | null {
  try {
    return execFileSync(cmd, args, { encoding: 'utf-8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

function readAvailableMB(): number {
  try {
    const m = fs.readFileSync('/proc/meminfo', 'utf-8').match(/MemAvailable:\s+(\d+) kB/);
    if (m) return Math.round(Number(m[1]) / 1024);
  } catch { /* non-linux */ }
  return Math.round(os.freemem() / 1048576);
}

/** Word-boundary match: a bare /ati/ also matches "Corporation". */
export function gpuVendor(line: string): HardwareProfile['gpu']['vendor'] {
  if (/\bnvidia\b/i.test(line)) return 'nvidia';
  if (/\bintel\b/i.test(line)) return 'intel';
  if (/\b(amd|ati|radeon)\b/i.test(line)) return 'amd';
  return 'none';
}

function detectGpu(): HardwareProfile['gpu'] {
  const nv = run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']);
  if (nv) {
    const [name, mem] = nv.trim().split('\n')[0].split(',').map((s) => s.trim());
    return { name, vendor: 'nvidia', vramMB: Number(mem) || null, cuda: true };
  }
  const pci = run('lspci', []);
  const line = pci?.split('\n').find((l) => /vga|3d|display/i.test(l));
  if (line) {
    const name = line.replace(/^.*?:\s*/, '').replace(/^.*?:\s*/, '').trim();
    return { name, vendor: gpuVendor(line), vramMB: null, cuda: false };
  }
  return { name: null, vendor: 'none', vramMB: null, cuda: false };
}

export function classify(p: Pick<HardwareProfile, 'cpu' | 'ramMB' | 'gpu'>): { tier: HardwareTier; reasons: string[] } {
  const reasons: string[] = [];
  const vram = p.gpu.vramMB ?? 0;
  if (p.gpu.cuda && vram >= 8000 && p.ramMB.total >= 24000 && p.cpu.cores >= 6) {
    reasons.push(`CUDA GPU with ${vram} MB VRAM and ${p.ramMB.total} MB RAM`);
    return { tier: 'high', reasons };
  }
  if (p.cpu.cores >= 8 && p.ramMB.total >= 16000 && p.cpu.avx2) {
    reasons.push(`${p.cpu.cores} threads, ${p.ramMB.total} MB RAM, AVX2`);
    return { tier: 'standard', reasons };
  }
  if (p.cpu.cores < 8) reasons.push(`only ${p.cpu.cores} CPU threads`);
  if (p.ramMB.total < 16000) reasons.push(`only ${p.ramMB.total} MB RAM`);
  if (!p.gpu.cuda) reasons.push('no CUDA GPU');
  if (!p.cpu.avx2) reasons.push('no AVX2');
  return { tier: 'low', reasons };
}

export function buildProfile(raw: Pick<HardwareProfile, 'cpu' | 'ramMB' | 'gpu' | 'diskFreeMB'>): HardwareProfile {
  const { tier, reasons } = classify(raw);
  // Budget: never more than 35% of total RAM, and never eat into what is free right now (keep 3 GB for the OS/app/ffmpeg).
  const budget = Math.max(0, Math.min(Math.floor(raw.ramMB.total * 0.35), raw.ramMB.available - 3072));
  return {
    ...raw,
    tier,
    reasons,
    modelRamBudgetMB: budget,
    inferenceThreads: Math.max(1, raw.cpu.cores - 1),
    allowGpuInference: tier === 'high',
  };
}

let cached: { at: number; profile: HardwareProfile } | null = null;

export function detectHardware(maxAgeMs = 10_000): HardwareProfile {
  if (cached && Date.now() - cached.at < maxAgeMs) return cached.profile;
  const cpus = os.cpus();
  let flags = '';
  try { flags = fs.readFileSync('/proc/cpuinfo', 'utf-8').match(/^flags\s*:(.*)$/m)?.[1] ?? ''; } catch { /* ignore */ }
  let diskFreeMB: number | null = null;
  try {
    const s = fs.statfsSync(process.cwd());
    diskFreeMB = Math.round((s.bavail * s.bsize) / 1048576);
  } catch { /* ignore */ }
  const profile = buildProfile({
    cpu: { model: cpus[0]?.model?.trim() ?? 'unknown', cores: cpus.length, avx2: /\bavx2\b/.test(flags), avx512: /\bavx512f\b/.test(flags) },
    ramMB: { total: Math.round(os.totalmem() / 1048576), available: readAvailableMB() },
    gpu: detectGpu(),
    diskFreeMB,
  });
  cached = { at: Date.now(), profile };
  return profile;
}
