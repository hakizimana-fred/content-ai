import { DEFAULT_PLAN, type EditingPlan } from './plan.ts';

/**
 * Deterministic instruction parser. Handles the cues a user states explicitly (platform, length, style, mood,
 * caption look, relative tweaks like "quieter music"). It never guesses: anything it does not recognise is left
 * for the LLM. Every field it sets is recorded in `explicit`, and those always win over model output.
 */
export interface RuleResult {
  plan: EditingPlan;
  /** dotted paths set by an explicit cue, e.g. "format", "audio.mood" */
  explicit: string[];
  notes: string[];
}

type Plan = EditingPlan;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const has = (t: string, re: RegExp) => re.test(t);

const STYLE_MOOD: Record<Plan['style'], Plan['audio']['mood']> = {
  cinematic_storytelling: 'cinematic', editorial_news: 'news_editorial', podcast_energy: 'minimal',
  documentary: 'documentary', premium_advertising: 'advertising', african_contemporary: 'african_fusion',
};
export const defaultMoodForStyle = (s: Plan['style']) => STYLE_MOOD[s];

const MOODS: [RegExp, Plan['audio']['mood']][] = [
  [/suspens|tense|thriller|dark/, 'suspense'], [/african|afro/, 'african_fusion'], [/corporate|business/, 'corporate'],
  [/luxur|elegant|sophisticated/, 'luxury'], [/documentar/, 'documentary'], [/inspir|motivat|uplift/, 'inspirational'],
  [/electronic|synth/, 'electronic'], [/minimal|ambient/, 'minimal'], [/tech/, 'technology'], [/comed|funny|playful/, 'comedy'],
  [/emotional|sad|touching/, 'emotional'], [/advert|commercial|premium/, 'advertising'], [/news|editorial/, 'news_editorial'],
  [/cinematic|epic|dramatic/, 'cinematic'],
];

export function applyRules(instruction: string, base: Plan = DEFAULT_PLAN): RuleResult {
  const t = instruction.toLowerCase();
  const plan = clone(base);
  const explicit = new Set<string>();
  const notes: string[] = [];
  const set = (path: string, note?: string) => { explicit.add(path); if (note) notes.push(note); };

  // ---- format / platform
  if (has(t, /tiktok|reels?|shorts?\b|vertical|9\s*[:x/]\s*16|story\b|stories/)) { plan.format = 'vertical_9_16'; set('format', 'vertical 9:16 (short-form platform)'); }
  else if (has(t, /4\s*[:x/]\s*5|portrait/)) { plan.format = 'portrait_4_5'; set('format'); }
  else if (has(t, /square|1\s*[:x/]\s*1/)) { plan.format = 'square_1_1'; set('format'); }
  else if (has(t, /youtube|landscape|16\s*[:x/]\s*9|widescreen/)) { plan.format = 'landscape_16_9'; set('format'); }

  // ---- duration
  const min = t.match(/(\d+(?:\.\d+)?)[\s-]*(?:minutes?|mins?)\b/);
  const sec = t.match(/(\d+(?:\.\d+)?)[\s-]*(?:seconds?|secs?|s)\b/);
  const dur = min ? Number(min[1]) * 60 : sec ? Number(sec[1]) : null;
  if (dur !== null && dur >= 5 && dur <= 180) { plan.duration_target = Math.round(dur); set('duration_target', `${Math.round(dur)}s target`); }

  // ---- style
  // "premium" is only an adjective when a genre word is present ("premium documentary" is a documentary).
  if (has(t, /advert|commercial/) || (has(t, /premium/) && !has(t, /documentar|cinematic|news|editorial|podcast|african/))) { plan.style = 'premium_advertising'; set('style'); }
  else if (has(t, /documentar/)) { plan.style = 'documentary'; set('style'); }
  else if (has(t, /african/)) { plan.style = 'african_contemporary'; set('style'); }
  else if (has(t, /news|editorial|headline/)) { plan.style = 'editorial_news'; set('style'); }
  else if (has(t, /podcast|interview|conversation energy/)) { plan.style = 'podcast_energy'; set('style'); }
  else if (has(t, /cinematic|storytelling/)) { plan.style = 'cinematic_storytelling'; set('style'); }

  // ---- captions
  const capCtx = /caption|subtitle|text/;
  if (has(t, capCtx)) {
    if (has(t, /bold|dynamic|punchy/)) { plan.captions.preset = 'bold_dynamic'; set('captions.preset'); }
    else if (has(t, /cinematic caption|cinematic subtitle/)) { plan.captions.preset = 'cinematic'; set('captions.preset'); }
    else if (has(t, /minimal|subtle caption|subtle subtitle|small(?:er)? (?:caption|subtitle)/)) { plan.captions.preset = 'minimal'; set('captions.preset'); }
    else if (has(t, /editorial/)) { plan.captions.preset = 'editorial'; set('captions.preset'); }
    else if (has(t, /clean|simple/)) { plan.captions.preset = 'clean'; set('captions.preset'); }
    const pos = t.match(/(top|center|centre|middle|bottom)\W+(?:\w+\W+)?(?:captions?|subtitles?)|(?:captions?|subtitles?)\W+(?:\w+\W+){0,3}?(?:at |in |on )?(?:the )?(top|center|centre|middle|bottom)/);
    const p = pos && (pos[1] || pos[2]);
    if (p) { plan.captions.position = p === 'top' ? 'top' : p === 'bottom' ? 'bottom' : 'center'; set('captions.position'); }
    if (has(t, /(larger|bigger|increase|enlarge)\b.*(caption|subtitle)|(caption|subtitle).*(larger|bigger)/)) { plan.captions.scale = Math.min(2, +(plan.captions.scale * 1.25).toFixed(2)); set('captions.scale', 'captions larger'); }
    if (has(t, /(smaller|reduce|decrease)\b.*(caption|subtitle)|(caption|subtitle).*smaller/)) { plan.captions.scale = Math.max(0.6, +(plan.captions.scale * 0.8).toFixed(2)); set('captions.scale', 'captions smaller'); }
  }
  if (has(t, /no (?:keyword )?highlight|without highlight/)) { plan.captions.highlight_keywords = false; set('captions.highlight_keywords'); }
  else if (has(t, /highlight|emphasi[sz]e|key words?|keywords?|important (?:statements?|words?|phrases?)/)) { plan.captions.highlight_keywords = true; set('captions.highlight_keywords'); }

  // ---- audio
  const noMusic = has(t, /no (?:background )?music|without (?:any )?(?:background )?music|remove (?:the )?(?:background )?music|silent|music off|no soundtrack/);
  if (noMusic) { plan.audio.music = false; plan.audio.mood = 'none'; set('audio.music', 'music disabled'); set('audio.mood'); }
  else {
    // Mood comes only from words directly before a music word ("suspenseful music"), so "cinematic with sound effects" does not switch music on.
    const ctx = t.match(/((?:[\w'-]+[\s,]+){0,4})(?:music|soundtrack|score|background track|instrumental|beat|background(?!\s+(?:blur|image|video|color|colour|footage)))\b/);
    if (ctx) {
      const m = MOODS.find(([re]) => re.test(ctx[1]));
      if (m) { plan.audio.mood = m[1]; plan.audio.music = true; set('audio.mood', `music mood: ${m[1]}`); set('audio.music'); }
    }
    // "add some music" with no mood: turn music on; the mood then comes from the style or the identity.
    if (!plan.audio.music && /\b(?:add|include|use|put|with|want|need|give)\b[^.]*\b(?:music|soundtrack|score)\b/.test(t) && !/\b(?:reduce|lower|quieter|louder|more|less)\b[^.]*\b(?:music|soundtrack)\b/.test(t)) { plan.audio.music = true; set('audio.music', 'music enabled'); }
    const MUSIC = '(?:background\\s+)?(?:music|soundtrack|score|track)';
    const quieter = new RegExp(`(?:reduce|lower|decrease|turn down|tone down)\\s+(?:the\\s+)?${MUSIC}|(?:quieter|softer|more subtle|less intrusive|subtler)\\s+(?:background\\s+)?(?:music|soundtrack|score)|${MUSIC}\\s+(?:a (?:bit|little)\\s+)?(?:quieter|softer|lower|more subtle|subtler)|make\\s+(?:the\\s+)?${MUSIC}\\s+(?:more\\s+)?(?:subtle|quiet|soft)`);
    const louder = new RegExp(`(?:increase|raise|boost|turn up)\\s+(?:the\\s+)?${MUSIC}|(?:louder|stronger)\\s+(?:background\\s+)?(?:music|soundtrack|score)|${MUSIC}\\s+(?:a (?:bit|little)\\s+)?(?:louder|stronger)|make\\s+(?:the\\s+)?${MUSIC}\\s+(?:more\\s+)?(?:prominent|loud)`);
    if (quieter.test(t)) {
      plan.audio.music_volume = Math.max(0.03, +(plan.audio.music_volume * 0.6).toFixed(3)); set('audio.music_volume', 'music quieter');
    } else if (louder.test(t)) {
      plan.audio.music_volume = Math.min(0.5, +(plan.audio.music_volume * 1.5).toFixed(3)); plan.audio.music = true; plan.audio.ducking = true; set('audio.music_volume', 'music louder (ducking forced on)'); set('audio.ducking');
    }
  }
  if (has(t, /no (?:sound effects?|sfx)|without (?:sound effects?|sfx)/)) { plan.audio.sound_effects = false; set('audio.sound_effects'); }
  else if (has(t, /sound effects?|sfx|whoosh|impact|riser/)) { plan.audio.sound_effects = true; set('audio.sound_effects'); }
  if (has(t, /intens(?:e|ity)|powerful|high energy/)) { plan.audio.intensity = 'high'; set('audio.intensity'); }
  else if (has(t, /gentle|soft|calm|low intensity/)) { plan.audio.intensity = 'low'; set('audio.intensity'); }

  // ---- pacing
  if (has(t, /remove (?:the )?(?:\w+ )?(?:silence|pauses?|dead air)|cut (?:the )?(?:silence|pauses?)|unnecessary pauses?|tighten/)) { plan.pacing.remove_silence = true; set('pacing.remove_silence', 'silence removal on'); }
  if (has(t, /faster|energetic|punchy|increase (?:the )?pac|speed up|more energy/)) { plan.pacing.speed = Math.min(1.25, +(plan.pacing.speed + 0.1).toFixed(2)); set('pacing.speed', 'faster pacing'); }
  else if (has(t, /slower|deliberate|calmer pac|slow down/)) { plan.pacing.speed = Math.max(0.9, +(plan.pacing.speed - 0.1).toFixed(2)); set('pacing.speed', 'slower pacing'); }

  // ---- framing
  if (has(t, /speaker.?track|follow (?:the )?speaker|focus on (?:the )?(?:\w+ )?speaker|track (?:the )?speaker/)) { plan.framing = 'speaker_tracking'; set('framing'); }
  else if (has(t, /blur/)) { plan.framing = 'blur_pad'; set('framing'); }
  else if (has(t, /center crop|centre crop/)) { plan.framing = 'center'; set('framing'); }
  else if (has(t, /wide shot|keep (?:it )?wide/)) { plan.framing = 'wide'; set('framing'); }

  // ---- ending
  if (has(t, /call to action|cta|ask (?:viewers )?to follow/)) { plan.ending.style = 'call_to_action'; set('ending.style'); }
  else if (has(t, /logo (?:sting|ending|outro)|brand(?:ed)? (?:ending|outro)/)) { plan.ending.style = 'logo_sting'; set('ending.style'); }
  else if (has(t, /fade ?out|clean ending|simple ending/)) { plan.ending.style = 'clean_fade'; set('ending.style'); }
  else if (has(t, /(?:dramatic|memorable|strong|powerful)\s+(?:ending|finish|close|resolution)|finish with|end with/)) { plan.ending.style = 'dramatic_resolution'; set('ending.style'); }

  // ---- consistency: music without ducking is unsafe for dialogue
  if (plan.audio.music && !plan.audio.ducking) { plan.audio.ducking = true; notes.push('ducking enabled so music cannot overpower speech'); }
  if (plan.audio.music && plan.audio.mood === 'none') plan.audio.mood = STYLE_MOOD[plan.style];

  return { plan, explicit: [...explicit], notes };
}
