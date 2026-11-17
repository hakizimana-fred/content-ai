export async function register() {
  // Node runtime only (the monitor uses the filesystem). Runs once per server start, so monitoring is owned by the
  // backend and resumes automatically after a restart, with or without a browser open.
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.RADAR_DISABLE_MONITOR !== '1') {
    const { startMonitor } = await import('./lib/radar/monitor');
    startMonitor();
  }
}
