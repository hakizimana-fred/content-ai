/**
 * TEST FIXTURE, not a product feature and not real data. A tiny local HTTP server that answers in the format the
 * http-json adapter expects, so you can watch the real monitor, state machine, notifications and UI react to a
 * creator "going live" without needing a real TikTok account. Nothing here talks to TikTok.
 *
 *   node scripts/radar-fixture-provider.ts            # listens on 127.0.0.1:4010
 *   curl 'localhost:4010/control?user=demo&mode=live&viewers=120'     # mode: live | offline | 503 | 429 | 404
 *
 * Point Live Radar at it (.env.local):
 *   RADAR_HTTP_URL=http://127.0.0.1:4010/?user={username}  RADAR_HTTP_LIVE_PATH=data.isLive  RADAR_HTTP_SOURCE=third-party-service
 *   RADAR_HTTP_VIEWERS_PATH=data.viewers  RADAR_HTTP_SESSION_PATH=data.room  RADAR_ACKNOWLEDGE_PLATFORM_TERMS=yes  RADAR_HTTP_NAME=Local fixture
 */
import http from 'node:http';
const modes = new Map<string, { mode: string; viewers: number; room: string }>();
http.createServer((req, res) => {
  const u = new URL(req.url!, 'http://x'); const user = u.searchParams.get('user') ?? '';
  if (u.pathname === '/control') { const m = u.searchParams.get('mode') ?? 'offline'; modes.set(user, { mode: m, viewers: Number(u.searchParams.get('viewers') ?? 0), room: u.searchParams.get('room') ?? `room_${Date.now().toString(36)}` }); res.end(`${user} → ${m}\n`); console.log(`${user} → ${m}`); return; }
  const s = modes.get(user) ?? { mode: 'offline', viewers: 0, room: '' };
  if (['404', '429', '503'].includes(s.mode)) { res.writeHead(Number(s.mode), s.mode === '429' ? { 'retry-after': '5' } : {}); return res.end('{}'); }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ data: { isLive: s.mode === 'live', viewers: s.mode === 'live' ? s.viewers : 0, room: s.mode === 'live' ? s.room : null } }));
}).listen(4010, '127.0.0.1', () => console.log('fixture provider on http://127.0.0.1:4010'));
