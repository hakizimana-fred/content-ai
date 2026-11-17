"""
Procedural scene renderer for Idea-to-Video. Renders ONE scene (animated background + animated typography + simple charts)
frame by frame with numpy / OpenCV / Pillow and pipes raw frames to ffmpeg. No GPU, no model, no browser.
Reads a JSON job on stdin:
  {out,w,h,fps,seconds,beat,beatT0,seed,
   bg:{type,colors[],accent,speed,asset?,assetKind?,dim}, text:{color,font,fontFile?,upper,anim},
   fx:{grain,leak,blur,vignette,bars}, motif:'rings'|'diagonals'|'dots'|'blocks'|'orbits'|'none',
   scene:{kind,composition,title,subtitle,lines[],quote,attribution,cta,bullets[],stats[{label,value,suffix,max}],steps[],
          asset?,assetKind?}}
Writes <out>.json next to the clip: text boxes (for the safe-area check), fonts used, peak memory.
Backgrounds are computed at 1/4 resolution and upscaled (they are smooth by nature), which is what keeps this fast on a CPU.
"""
import json, math, subprocess, sys, os
import cv2
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render3d as r3
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
BUNDLED = os.path.normpath(os.path.join(HERE, "..", "..", "..", "assets", "fonts"))   # fonts shipped with the project: output never depends on system fonts
def _b(n): return os.path.join(BUNDLED, n)
FONTS = {
    "modern": [_b("LiberationSans-Bold.ttf"), _b("DejaVuSans-Bold.ttf")],
    "elegant": [_b("LiberationSerif-Bold.ttf"), _b("DejaVuSerif-Bold.ttf")],
    "tech": [_b("LiberationMono-Bold.ttf"), _b("DejaVuSans-Bold.ttf")],
    "bold": [_b("LiberationSansNarrow-Bold.ttf"), _b("LiberationSans-Bold.ttf")],
}
USER_FONT = None       # absolute path of a user-uploaded font; tried first, then the bundled chain
FONT_USED = set()

def font(kind, size):
    for p in ([USER_FONT] if USER_FONT and kind != "elegant_quote" else []) + FONTS.get(kind, FONTS["modern"]) + FONTS["modern"] + ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]:
        if p and os.path.exists(p):
            try:
                f = ImageFont.truetype(p, max(8, int(size))); FONT_USED.add(os.path.basename(p)); return f
            except Exception:
                continue
    return ImageFont.load_default()

def lum_arr(c): return 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]

def hexrgb(h):
    h = h.lstrip("#")
    if len(h) == 3: h = "".join(c * 2 for c in h)
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], np.float32)

def ease(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)

def ease_out(t):
    t = min(max(t, 0.0), 1.0)
    return 1 - (1 - t) ** 3

def back_out(t):
    t = min(max(t, 0.0), 1.0); c = 1.4
    return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2

def lum(c): return float(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2])

class Scene:
    def __init__(self, job):
        global USER_FONT
        self.j = job; self.W = job["w"]; self.H = job["h"]; self.fps = job["fps"]
        self.N = max(1, int(round(job["seconds"] * self.fps)))
        self.s = min(self.W, self.H) / 1080.0; self.portrait = self.H > self.W
        self.lw, self.lh = max(8, self.W // 4), max(8, self.H // 4)
        bg = job["bg"]; self.cols = [hexrgb(c) for c in bg.get("colors", ["#05060f", "#10153a", "#3b2a8c"])]
        while len(self.cols) < 3: self.cols.append(self.cols[-1])
        self.accent = hexrgb(bg.get("accent", "#7c5cff")); self.speed = bg.get("speed", 1.0); self.btype = bg.get("type", "aurora")
        self.tcol = hexrgb(job["text"].get("color", "#ffffff")); self.light = lum(self.cols[0]) > 150
        USER_FONT = job["text"].get("fontFile") or None
        self.fx = job.get("fx") or {}; self.motif = job.get("motif", "none"); self.beat = job.get("beat") or 0; self.beatT0 = job.get("beatT0", 0.0)
        self.sc = job["scene"]; self.comp = self.sc.get("composition") or "default"
        rs = np.random.RandomState(job.get("seed", 1)); self.rs = rs
        yy, xx = np.mgrid[0:self.lh, 0:self.lw].astype(np.float32)
        self.X = xx / self.lw; self.Y = yy / self.lh; self.asp = self.W / self.H
        d = np.sqrt(((self.X - 0.5) * 1.0) ** 2 + (self.Y - 0.5) ** 2)
        vg = float(self.fx.get("vignette", 0.55)); self.vig = (1.0 - vg * np.clip(d * 1.5, 0, 1) ** 2)[..., None]
        # soft darkening band behind text so bright backgrounds (bokeh, beams) never wash text out
        textual = self.sc_kind_has_text(job["scene"])
        band = np.exp(-((self.Y - 0.5) ** 2) / 0.07)[..., None] * (0.0 if self.light else 0.42 if textual else 0.0)
        self.scrim = (1.0 - band).astype(np.float32)
        self.noise = (rs.rand(self.lh, self.lw, 1).astype(np.float32) - 0.5) * 2.5
        self.parts = [(rs.rand(), rs.rand(), 0.4 + rs.rand() * 1.6, 0.03 + rs.rand() * 0.08) for _ in range(46)]
        self.bokeh = [(rs.rand(), rs.rand(), 0.02 + rs.rand() * 0.07, 0.01 + rs.rand() * 0.04, rs.rand() * 6.28) for _ in range(16)]
        kinds = ["ring", "tri", "hex", "cross", "ring", "dots", "tri", "hex"]
        self.geo = [dict(k=kinds[i % len(kinds)], x=rs.rand(), y=rs.rand(), r=0.03 + rs.rand() * 0.11, z=0.25 + rs.rand() * 0.75, a=rs.rand() * 6.28, w=(rs.rand() - 0.5) * 0.6) for i in range(22)]
        g = float(self.fx.get("grain", 0)); self.grain = None
        if g > 0:
            amp = int(4 + 22 * g); n = rs.randint(-amp, amp + 1, (self.H + 32, self.W + 32, 1)).astype(np.int16)
            self.grain = (np.repeat(np.maximum(n, 0), 3, axis=2).astype(np.uint8), np.repeat(np.maximum(-n, 0), 3, axis=2).astype(np.uint8))
        self.bar = 0
        if self.fx.get("bars") and self.W / self.H > 1.2: self.bar = int(max(0, (self.H - self.W / 2.39) / 2))
        self.cap = None; self.asset_img = None
        a = self.sc.get("asset") or bg.get("asset"); ak = self.sc.get("assetKind") or bg.get("assetKind")
        self.asset_path, self.asset_kind = a, ak
        if a and (self.btype == "asset" or self.sc["kind"] in ("showcase", "photo25d", "product3d")):
            if ak == "video": self.cap = cv2.VideoCapture(a)
            else: self.asset_img = cv2.imread(a)
        self.units = []; self.boxes = []; self.ex = {}
        self.whole = all(abs(float(x['value']) - round(float(x['value']))) < 1e-6 for x in self.sc.get('stats', []))
        self.build3d()
        self.build_logo()
        self.build_text()

    @staticmethod
    def sc_kind_has_text(sc):
        return sc.get("kind") in ("intro", "text", "quote", "product", "infographic", "outro", "diagram", "product3d", "scenery25", "photo25d", "journey3d", "title3d")

    # ----------------------------------------------------------------- camera
    def cam(self, t):
        S = self.s; return (math.sin(t * 0.45 + 1.1) * 14 * S + math.sin(t * 0.2) * 6 * S, math.cos(t * 0.37) * 9 * S)

    # ------------------------------------------------------------- background
    def grad(self):
        return self.cols[0] * (1 - self.Y[..., None]) + self.cols[1] * self.Y[..., None]

    def bg_frame(self, t):
        T = t * self.speed; beat = self.beat; pulse = 0.0
        if beat > 0:
            ph = ((t - self.beatT0) % beat) / beat; pulse = math.exp(-ph * 7.0) * 0.5
        c0, c1, c2 = self.cols; X, Y = self.X, self.Y; A = self.asp; bt = self.btype
        if bt == "gradient":
            ang = 0.6 + 0.35 * math.sin(T * 0.4)
            k = np.clip(((X - 0.5) * math.cos(ang) + (Y - 0.5) * math.sin(ang)) + 0.5, 0, 1)[..., None]
            img = c0 * (1 - k) + c1 * k
            gx, gy = 0.5 + 0.35 * math.cos(T * 0.5), 0.5 + 0.3 * math.sin(T * 0.7)
            img = img + c2 * np.exp(-(((X - gx) * 1.4) ** 2 + (Y - gy) ** 2) / 0.07)[..., None] * 0.7
        elif bt == "aurora":
            img = np.tile(c0, (self.lh, self.lw, 1)).astype(np.float32)
            for i, c in enumerate((c1, c2, self.accent, c1)):
                cx = 0.5 + 0.45 * math.sin(T * (0.35 + 0.13 * i) + i * 1.7); cy = 0.5 + 0.4 * math.cos(T * (0.27 + 0.11 * i) + i * 2.3)
                img = img + c * np.exp(-(((X - cx) * A) ** 2 + (Y - cy) ** 2) / (0.06 + 0.02 * i))[..., None] * (0.55 if i < 3 else 0.35)
        elif bt == "mesh":
            pts = [(0.5 + 0.38 * math.sin(T * 0.3 + i * 1.9), 0.5 + 0.38 * math.cos(T * 0.27 + i * 2.4)) for i in range(4)]; cc = (c1, c2, self.accent * 0.7, c1 * 0.8 + c2 * 0.2)
            num = np.zeros((self.lh, self.lw, 3), np.float32); den = np.zeros((self.lh, self.lw, 1), np.float32)
            for (px, py), c in zip(pts, cc):
                w = 1.0 / ((((X - px) * A) ** 2 + (Y - py) ** 2) + 0.03) ** 1.4; num += c * w[..., None]; den += w[..., None]
            img = (num / den) * 0.8 + c0 * 0.25
        elif bt == "bokeh":
            img = self.grad() + c2 * np.exp(-(((X - 0.5) * A) ** 2 / 0.22 + (Y - 0.55) ** 2 / 0.3))[..., None] * 1.1    # soft pool of light so the scene is never an empty dark frame
            lay = np.zeros((self.lh, self.lw, 3), np.float32)
            for (bx, by, br, bs, bp) in self.bokeh:
                y = (by - T * bs) % 1.2 - 0.1; x = bx + 0.04 * math.sin(T * 0.5 + bp)
                col = (self.accent if int(bp * 10) % 2 == 0 else c2 * 1.4 + 40) / 255.0 * (0.7 + 0.3 * math.sin(T + bp))
                cv2.circle(lay, (int(x * self.lw), int(y * self.lh)), max(3, int(br * 1.4 * self.lw)), tuple(float(v) for v in col), -1, cv2.LINE_AA)
            lay = cv2.GaussianBlur(lay, (0, 0), 1.6); img = img + lay * 255.0 * 1.0
        elif bt == "contours":
            f = np.sin(X * 7 + 1.5 * np.sin(Y * 5 + T * 0.6)) + np.sin(Y * 9 - T * 0.4 + X * 3) + 0.6 * np.sin((X + Y) * 11 + T * 0.3)
            l = np.abs(((f * 1.7) % 1.0) - 0.5); line = np.clip(1 - l * 9, 0, 1)
            img = self.grad() + self.accent * line[..., None] * 0.5 + c2 * np.exp(-((X - 0.5) ** 2 + (Y - 0.45) ** 2) / 0.12)[..., None] * 0.5
        elif bt == "beams":
            ang = 0.55 + 0.18 * math.sin(T * 0.25); u = ((X - 0.5) * A) * math.cos(ang) + (Y - 0.5) * math.sin(ang)
            img = self.grad()
            for i in range(3):
                cu = 0.55 * math.sin(T * (0.18 + 0.07 * i) + i * 2.1); wdt = 0.0035 + 0.003 * i
                img = img + (self.accent if i != 1 else c2 * 1.5) * np.exp(-((u - cu) ** 2) / wdt)[..., None] * (0.38 - 0.06 * i)
            img = img + c2 * np.exp(-((X - 0.5) ** 2 / 0.2 + (Y - 0.9) ** 2 / 0.05))[..., None] * 0.5
        elif bt == "grid":
            img = self.grad() + c2 * np.exp(-((X - 0.5) ** 2 / 0.1 + (Y - 0.38) ** 2 / 0.02))[..., None] * 0.8
        elif bt == "particles":
            img = self.grad(); lay = np.zeros((self.lh, self.lw, 3), np.float32)
            for (px, py, sz, sp) in self.parts:
                y = (py - T * sp) % 1.0; x = px + 0.03 * math.sin(T * 0.8 + py * 9)
                cv2.circle(lay, (int(x * self.lw), int(y * self.lh)), max(1, int(sz * self.s * 2.2)), tuple(float(v) for v in self.accent / 255.0 * (0.6 + 0.4 * math.sin(T * 2 + px * 7))), -1, cv2.LINE_AA)
            img = img + lay * 190.0 + c2 * np.exp(-((X - 0.5) ** 2 + (Y - 0.6) ** 2) / 0.12)[..., None] * 0.5
        elif bt == "waves":
            img = self.grad()
            for i, c in enumerate((c1, c2, self.accent)):
                yb = 0.55 + 0.12 * i + 0.04 * np.sin(X * (5 + 2 * i) + T * (0.9 + 0.3 * i) + i)
                m = np.clip((Y - yb) * 40.0, 0, 1)[..., None]; img = img * (1 - 0.45 * m) + c * 0.45 * m
        elif bt == "sky":
            hz = 0.62; k = np.clip((self.Y - 0.0) / hz, 0, 1)[..., None]; warm = self.accent * 0.9 + 70
            img = c0 * (1 - k) + (c1 * 0.6 + warm * 0.55) * k + c2 * 0.25
            sx, sy = 0.5 + 0.2 * math.sin(T * 0.05), hz - 0.12; img = img + warm * np.exp(-(((X - sx) * A) ** 2 / 0.05 + (Y - sy) ** 2 / 0.012))[..., None] * 1.2
            img = np.where((self.Y > hz)[..., None], img * 0.35, img)
        elif bt == "geo":
            img = self.grad() + c2 * np.exp(-((X - 0.5) ** 2 / 0.25 + (Y - 0.5) ** 2 / 0.2))[..., None] * 0.6
        elif bt == "asset":
            return self.finish_asset(t, pulse)
        else:
            img = np.tile(c0, (self.lh, self.lw, 1)).astype(np.float32) + c1 * (1 - Y[..., None]) * 0.8 + c2 * np.exp(-(((X - 0.5) * A) ** 2 / 0.3 + (Y - 0.55) ** 2 / 0.25))[..., None] * 0.9
        # ---- low-resolution effects (cheap): parallax drift of the far layer, rack-focus blur, light leak, beat pulse
        cx, cy = self.cam(t)
        if abs(cx) + abs(cy) > 0.01 and bt != "grid":
            M = np.float32([[1, 0, cx * 0.12 / 4], [0, 1, cy * 0.12 / 4]]); img = cv2.warpAffine(img, M, (self.lw, self.lh), borderMode=cv2.BORDER_REFLECT)
        fb = float(self.fx.get("blur", 0))
        if fb > 0:
            sg = fb * 4.0 * max(0.0, 1 - t / 0.8)
            if sg > 0.3: img = cv2.GaussianBlur(img, (0, 0), sg)
        lk = float(self.fx.get("leak", 0))
        if lk > 0:
            amp = lk * max(0.0, math.sin(t * 0.9 + 0.4)) ** 2; lx = ((t * 0.35) % 1.8) - 0.4
            blob = np.exp(-(((X - lx) * A) ** 2 / 0.05 + (Y - 0.25 - 0.1 * math.sin(t)) ** 2 / 0.35))[..., None]
            img = img + np.array([255, 150, 70], np.float32) * blob * amp * 0.65
        if not self.light:           # adaptive exposure: a dark palette may be moody but never an empty black frame
            m = float(img.mean())
            if m < 34.0: img = img * min(5.0, 34.0 / max(m, 3.0)) + (10.0 if m < 10 else 0.0)
        img = img * self.vig * self.scrim * (1.0 + 0.10 * pulse)
        up = cv2.resize(np.clip(img + self.noise, 0, 255).astype(np.uint8), (self.W, self.H), interpolation=cv2.INTER_LINEAR)
        if bt == "grid": up = self.draw_grid(up, T)
        if bt == "geo": up = self.draw_geo(up, t)
        return up

    def add_layer(self, fr, layer):
        return cv2.subtract(fr, layer) if self.light else cv2.add(fr, layer)

    def shade(self, k):        # accent colour at strength k, inverted for light themes (so it darkens instead of brightening)
        c = self.accent * k if not self.light else (255 - self.accent) * k
        return tuple(int(max(0, min(255, v))) for v in c)

    def draw_grid(self, up, T):
        W, H = self.W, self.H; hz = int(H * 0.38); layer = np.zeros_like(up); col = self.accent
        for i in range(14):
            p = ((i + (T * 0.5) % 1.0) / 14.0) ** 2.2; y = int(hz + p * (H - hz)); cv2.line(layer, (0, y), (W, y), tuple(int(v) for v in col * (0.18 + 0.7 * p)), max(1, int(2 * self.s)), cv2.LINE_AA)
        for i in range(-12, 13): cv2.line(layer, (W // 2 + i * int(12 * self.s), hz), (int(W / 2 + i * W * 0.22), H), tuple(int(v) for v in col * 0.5), max(1, int(2 * self.s)), cv2.LINE_AA)
        return self.add_layer(up, layer)

    def draw_geo(self, up, t):
        """Animated geometric illustration with depth: each shape has a depth z; nearer shapes move/rotate more and are brighter (parallax)."""
        W, H, S = self.W, self.H, self.s; layer = np.zeros_like(up); cx, cy = self.cam(t); m = min(W, H)
        for g in self.geo:
            z = g["z"]; x = (g["x"] * W + cx * 3.2 * z + t * 12 * S * z * (1 if g["w"] > 0 else -1)) % (W + 160) - 80; y = (g["y"] * H + cy * 3.2 * z - t * 9 * S * z) % (H + 160) - 80
            r = g["r"] * m * (0.55 + 0.7 * z); a = g["a"] + g["w"] * t; col = tuple(int(v) for v in (self.accent if z > 0.55 else self.cols[2] * 1.6) * (0.22 + 0.5 * z)); th = max(1, int(2.4 * S * z))
            c = (int(x), int(y))
            if g["k"] == "ring": cv2.circle(layer, c, int(r), col, th, cv2.LINE_AA)
            elif g["k"] in ("tri", "hex"):
                n = 3 if g["k"] == "tri" else 6; pts = np.array([[x + r * math.cos(a + i * 2 * math.pi / n), y + r * math.sin(a + i * 2 * math.pi / n)] for i in range(n)], np.int32)
                cv2.polylines(layer, [pts], True, col, th, cv2.LINE_AA)
            elif g["k"] == "cross":
                for q in (0, math.pi / 2): cv2.line(layer, (int(x + r * math.cos(a + q)), int(y + r * math.sin(a + q))), (int(x - r * math.cos(a + q)), int(y - r * math.sin(a + q))), col, th, cv2.LINE_AA)
            else:
                for i in range(3):
                    for j in range(3): cv2.circle(layer, (int(x + (i - 1) * r * 0.5), int(y + (j - 1) * r * 0.5)), max(1, int(3 * S * z)), col, -1, cv2.LINE_AA)
        return self.add_layer(up, layer)

    def draw_motif(self, fr, t):
        """The scene-to-scene identity element: the same shape family appears in every scene of a video, in the accent colour."""
        mo = self.motif
        if mo == "none": return fr
        W, H, S = self.W, self.H, self.s; m = min(W, H); box = int(m * 0.46); p = ease_out((t - 0.1) / 0.8)
        corner = (W - box, 0) if mo in ("rings", "dots") else (0, H - box) if mo in ("diagonals", "orbits") else (W - box, H - box)
        x0, y0 = corner; roi = fr[y0:y0 + box, x0:x0 + box]; layer = np.zeros_like(roi); th = max(1, int(3 * S)); col = self.shade(0.55)
        ph = ((t - self.beatT0) % self.beat) / self.beat if self.beat else 0; pulse = math.exp(-ph * 6) if self.beat else 0
        if mo == "rings":
            c = (box - int(0.04 * m), int(0.04 * m))
            for i, r in enumerate((0.10, 0.16, 0.22)): cv2.ellipse(layer, c, (int(r * m * p), int(r * m * p)), t * (22 + 14 * i) * (1 if i % 2 else -1), 0, 240, col, th, cv2.LINE_AA)
        elif mo == "diagonals":
            for i in range(4):
                L = int(box * (0.9 - 0.12 * i) * p); y = box - int((0.1 + 0.07 * i) * box); cv2.line(layer, (0, y), (int(L * 0.9), y - int(L * 0.55)), col, th, cv2.LINE_AA)
        elif mo == "dots":
            n = 6; gap = int(box / 11)
            for i in range(n):
                for j in range(n):
                    d = abs(i - j) * 0.12; r = max(1, int((3.5 + 3 * pulse * (1 - d)) * S * min(1, p * 1.5)))
                    cv2.circle(layer, (box - int(0.06 * box) - i * gap, int(0.06 * box) + j * gap), r, col, -1, cv2.LINE_AA)
        elif mo == "blocks":
            for i in range(3):
                sz = int((0.11 + 0.06 * i) * m); off = int(math.sin(t * 0.7 + i) * 8 * S); cx_, cy_ = box - int(0.12 * box) - i * int(0.07 * m) + off, box - int(0.12 * box) - i * int(0.07 * m)
                cv2.rectangle(layer, (cx_ - sz // 2, cy_ - sz // 2), (cx_ + sz // 2, cy_ + sz // 2), col, th, cv2.LINE_AA)
        elif mo == "orbits":
            c = (int(0.18 * box), int(0.82 * box)); rx, ry = int(0.15 * m * p), int(0.07 * m * p)
            cv2.ellipse(layer, c, (max(1, rx), max(1, ry)), -25, 0, 360, col, th, cv2.LINE_AA)
            a = t * 1.8; ex, ey = rx * math.cos(a), ry * math.sin(a); ca, sa = math.cos(math.radians(-25)), math.sin(math.radians(-25))
            cv2.circle(layer, (int(c[0] + ex * ca - ey * sa), int(c[1] + ex * sa + ey * ca)), max(2, int(8 * S * (1 + 0.5 * pulse))), self.shade(1.0), -1, cv2.LINE_AA)
        fr[y0:y0 + box, x0:x0 + box] = self.add_layer(roi, layer)
        return fr

    def finish_asset(self, t, pulse):
        img = None
        if self.cap is not None:
            ok, fr = self.cap.read()
            if not ok: self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0); ok, fr = self.cap.read()
            img = fr if ok else None
        elif self.asset_img is not None: img = self.asset_img
        if img is None: return np.zeros((self.H, self.W, 3), np.uint8)
        ih, iw = img.shape[:2]; prog = ease(t / max(0.1, self.j["seconds"])); mv = self.sc.get("motion") or ("push", "pan_left", "pan_right", "zoom_out")[self.j.get("seed", 1) % 4]
        z = {"push": 1.04 + 0.10 * prog, "zoom_out": 1.14 - 0.10 * prog}.get(mv, 1.12)
        ww = min(iw, ih * self.W / self.H) / z; wh = ww * self.H / self.W; cx, cy = iw / 2, ih / 2
        slack = max(0.0, iw - ww)
        if mv == "pan_left": cx = iw / 2 + slack * (0.5 - prog) * 0.9
        if mv == "pan_right": cx = iw / 2 - slack * (0.5 - prog) * 0.9
        cx = min(max(cx, ww / 2), iw - ww / 2)
        M = np.float32([[self.W / ww, 0, -(cx - ww / 2) * self.W / ww], [0, self.H / wh, -(cy - wh / 2) * self.H / wh]])
        out = cv2.warpAffine(img, M, (self.W, self.H), flags=cv2.INTER_LINEAR).astype(np.float32)[..., ::-1]
        dim = self.j["bg"].get("dim", 0.45); out = out * (1 - dim) + self.cols[0] * dim
        v = cv2.resize(self.vig[..., 0], (self.W, self.H))[..., None]
        return np.clip(out * v * (1.0 + 0.08 * pulse), 0, 255).astype(np.uint8)

    # ------------------------------------------------------------------- text
    def sprite(self, text, size, fkind, color, shadow=True):
        f = font(fkind, size * self.s); pad = int(18 * self.s); asc, desc = f.getmetrics()
        w, h = int(f.getlength(text)) + 2 * pad, asc + desc + 2 * pad
        lay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        if shadow:
            sh = Image.new("RGBA", (w, h), (0, 0, 0, 0)); ImageDraw.Draw(sh).text((pad, pad + asc + 5 * self.s), text, font=f, fill=(0, 0, 0, 170 if not self.light else 60), anchor="ls")
            lay = Image.alpha_composite(lay, sh.filter(ImageFilter.GaussianBlur(7 * self.s)))
        ImageDraw.Draw(lay).text((pad, pad + asc), text, font=f, fill=tuple(int(v) for v in color) + (255,), anchor="ls")
        a = np.asarray(lay, np.float32)
        return a[..., :3], a[..., 3] / 255.0, f.getlength(text)

    def wrap(self, text, size, fkind, maxw):
        f = font(fkind, size * self.s); words = text.split(); lines = []; cur = ""
        for w in words:
            t = (cur + " " + w).strip()
            if f.getlength(t) <= maxw or not cur: cur = t
            else: lines.append(cur); cur = w
        if cur: lines.append(cur)
        return lines

    def unit(self, text, size, x, y, col, kind, t0, dur=0.55, t1=None, fkind=None, i=0):
        fkind = fkind or self.j["text"].get("font", "modern"); rgb, a, wl = self.sprite(text, size, fkind, col); pad = int(18 * self.s)
        self.units.append(dict(rgb=rgb, a=a, x=x - pad, y=y - pad, t0=t0, dur=dur, t1=t1, kind=kind, i=i, text=text))
        self.boxes.append(dict(x=float(x), y=float(y), w=float(wl), h=float(a.shape[0] - 2 * pad), text=text, slam=(kind == "slam")))
        return wl

    def add_text(self, text, size, cy, color=None, t0=0.15, anim=None, fkind=None, upper=None, stagger=0.09, dur=0.55, align="center", x0=None, kind=None):
        T = self.j["text"]; anim = anim or T.get("anim", "fade_up"); fkind = fkind or T.get("font", "modern"); col = self.tcol if color is None else color
        if (T.get("upper") if upper is None else upper): text = text.upper()
        maxw = self.W * 0.84 - (0 if x0 is None else x0)
        lines = self.wrap(text, size, fkind, maxw); lh = size * self.s * 1.22; y = cy * self.H - (len(lines) * lh) / 2; idx = 0; f = font(fkind, size * self.s)
        for ln in lines:
            total = f.getlength(ln); x = (self.W - total) / 2 if align == "center" else (x0 or 0); asc = f.getmetrics()[0]; base = y + 0
            if anim == "letters":
                for ch in ln:
                    if ch != " ": self.unit(ch, size, x, base, col, "fade_up", t0 + idx * 0.035, 0.35, fkind=fkind)
                    x += f.getlength(ch); idx += 1
            elif anim in ("words", "scale", "slide", "split", "wave"):
                sp = f.getlength(" ")
                for wd in ln.split(" "):
                    k = kind or ("split_l" if anim == "split" and idx % 2 == 0 else "split_r" if anim == "split" else anim)
                    if anim == "wave":
                        for ci, ch in enumerate(wd): self.unit(ch, size, x, base, col, "wave", t0 + (idx + ci * 0.15) * stagger * 0.6, 0.4, fkind=fkind, i=ci + idx * 3); x += f.getlength(ch)
                        x += sp; idx += 1; continue
                    wl = self.unit(wd, size, x, base, col, k, t0 + idx * stagger, dur, fkind=fkind); x += wl + sp; idx += 1
            else:
                self.unit(ln, size, x, base, col, kind or "fade_up", t0 + idx * stagger * 2, dur, fkind=fkind); idx += 1
            y += lh
        return len(lines) * lh

    def slam(self, text, size, cy, t0, step, upper=None, color=None, keep_last=True):
        """Kinetic typography: one big word at a time, each hitting on the beat; the last word stays."""
        T = self.j["text"]; fkind = T.get("font", "modern"); col = self.tcol if color is None else color; words = (text.upper() if (T.get("upper") if upper is None else upper) else text).split()
        f = font(fkind, size * self.s)
        for i, w in enumerate(words):
            while f.getlength(w) > self.W * 0.86 and size > 30: size *= 0.9; f = font(fkind, size * self.s)
        for i, w in enumerate(words):
            wl = f.getlength(w); last = i == len(words) - 1
            self.unit(w, size, (self.W - wl) / 2, cy * self.H - size * self.s * 0.6, self.accent if i % 2 == 1 and len(words) > 2 else col, "slam", t0 + i * step, 0.28, None if (last and keep_last) else t0 + (i + 1) * step, fkind=fkind, i=i)

    def stack(self, text, size, cy, t0, align="left"):
        """Stacked kinetic type: every word on its own line, sliding in from the left, final word in the accent colour."""
        T = self.j["text"]; fkind = T.get("font", "modern"); words = (text.upper() if T.get("upper") else text).split()[:5]; f = font(fkind, size * self.s); lh = size * self.s * 1.05
        for i, w in enumerate(words):
            while f.getlength(w) > self.W * 0.8 and size > 30: size *= 0.92; f = font(fkind, size * self.s)
        lh = size * self.s * 1.05; y0 = cy * self.H - len(words) * lh / 2; x0 = self.W * 0.09
        for i, w in enumerate(words):
            self.unit(w, size, x0 if align == "left" else (self.W - f.getlength(w)) / 2, y0 + i * lh, self.accent if i == len(words) - 1 and len(words) > 1 else self.tcol, "slide", t0 + i * 0.18, 0.5, fkind=fkind)
        return len(words) * lh

    def card_sprite(self, text, w, h, size):
        pad = int(18 * self.s); img = Image.new("RGBA", (int(w) + 2 * pad, int(h) + 2 * pad), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
        bg = tuple(int(v) for v in (self.cols[1] * 0.6 + 255 * 0.0)) + (200,) if not self.light else (255, 255, 255, 220)
        d.rounded_rectangle((pad, pad, pad + w, pad + h), radius=int(h * 0.28), fill=bg, outline=tuple(int(v) for v in self.accent) + (170,), width=max(2, int(3 * self.s)))
        f = font(self.j["text"].get("font", "modern"), size * self.s); asc, desc = f.getmetrics()
        d.text((pad + h * 0.45, pad + h / 2 + (asc - desc) / 2), text, font=f, fill=tuple(int(v) for v in self.tcol) + (255,), anchor="ls")
        a = np.asarray(img, np.float32); return a[..., :3], a[..., 3] / 255.0

    def build_text(self):
        sc = self.sc; k = sc["kind"]; S = self.s; P = self.portrait; comp = self.comp; beat = self.beat or 0.5
        big = 118 if P else 112; mid = 52; small = 40; acc2 = self.accent * 0.5 + 255 * 0.5 if not self.light else self.accent * 0.8
        title = sc.get("title") or ""
        if k == "intro":
            if comp == "slam" and title: self.slam(title, big * 1.05, 0.44, 0.2, max(0.3, beat))
            elif comp == "stack" and title: self.stack(title, big * 1.05, 0.44, 0.2, "left")
            elif comp == "left" and title:
                h = self.add_text(title, big * 0.92, 0.42, t0=0.25, align="left", x0=self.W * 0.14, anim="slide")
                self.ex["bar"] = (self.W * 0.09, self.H * 0.42, h)
                if sc.get("subtitle"): self.add_text(sc["subtitle"], mid * 0.8, 0.42 + h / self.H / 2 + 0.06, color=acc2, t0=0.9, upper=False, align="left", x0=self.W * 0.14, anim="fade_up")
            else:
                self.add_text(title, big, 0.42, t0=0.25)
                if sc.get("subtitle"): self.add_text(sc["subtitle"], mid * 0.8, 0.58, color=acc2, t0=0.9, anim="fade_up", upper=False)
                self.ex["rule"] = 1
        elif k == "text":
            txt = title or " ".join(sc.get("lines", []))
            if comp == "slam": self.slam(txt, big * 1.1, 0.5, 0.15, max(0.28, beat * 0.9))
            elif comp == "stack": self.stack(txt, big * 0.95, 0.5, 0.15, "left")
            elif comp == "split": self.add_text(txt, big * 0.86, 0.5, t0=0.2, anim="split", stagger=0.14, dur=0.5)
            elif comp == "wave": self.add_text(txt, big * 0.86, 0.5, t0=0.2, anim="wave", stagger=0.12)
            else:
                a_ = self.j["text"].get("anim", "words"); h = self.add_text(txt, big * 0.86, 0.5, t0=0.2, anim="words" if a_ == "letters" else a_)
                self.ex["rule_y"] = 0.5 - h / self.H / 2 - 0.05
            if sc.get("subtitle"): self.add_text(sc["subtitle"], small, 0.7, color=acc2, t0=0.9, upper=False)
        elif k == "quote":
            if comp == "bar":
                h = self.add_text(sc.get("quote", ""), 60 if P else 56, 0.46, t0=0.3, anim="words", fkind="elegant", upper=False, stagger=0.07, align="left", x0=self.W * 0.14)
                self.ex["qbar"] = (self.W * 0.09, self.H * 0.46, h)
                if sc.get("attribution"): self.add_text("— " + sc["attribution"], small, 0.46 + h / self.H / 2 + 0.07, color=acc2, t0=1.2, upper=False, align="left", x0=self.W * 0.14)
            else:
                self.add_text("“", 260, 0.25, color=self.accent, t0=0.05, anim="scale", fkind="elegant", upper=False)
                h = self.add_text(sc.get("quote", ""), 62 if P else 58, 0.48, t0=0.3, anim="words", fkind="elegant", upper=False, stagger=0.07)
                if sc.get("attribution"): self.add_text("— " + sc["attribution"], small, 0.48 + h / self.H / 2 + 0.07, color=acc2, t0=1.2, upper=False)
        elif k == "product":
            self.add_text(title, big * 0.8, 0.22, t0=0.15, anim="words")
            bl = sc.get("bullets", [])[:5]; y = 0.38; self.ex["bullets"] = []
            for i, b in enumerate(bl):
                if comp == "cards":
                    cw = self.W * 0.78; ch = 104 * S; rgb, a = self.card_sprite(b, cw, ch, mid * 0.8); pad = int(18 * S); yy_ = (y + i * 0.115) * self.H
                    self.units.append(dict(rgb=rgb, a=a, x=self.W * 0.11 - pad, y=yy_ - pad, t0=0.6 + i * 0.3, dur=0.5, t1=None, kind="slide", i=i, text=b)); self.boxes.append(dict(x=self.W * 0.11, y=yy_, w=cw, h=ch, text=b, slam=False))
                else:
                    self.add_text(b, mid * 0.85, y + i * 0.095, t0=0.7 + i * 0.35, anim="slide", upper=False, align="left", x0=self.W * 0.2)
                    self.ex["bullets"].append((self.W * 0.14, (y + i * 0.095) * self.H, 0.7 + i * 0.35))
        elif k == "outro":
            if comp == "slam" and title: self.slam(title, big * 0.95, 0.38, 0.2, max(0.3, beat), keep_last=True)
            else: self.add_text(title, big * 0.9, 0.40, t0=0.2, anim="scale")
            cta = sc.get("cta")
            if cta:
                rgb, a, wl = self.sprite(cta, mid, self.j["text"].get("font", "modern"), (10, 10, 20), shadow=False); pad = int(18 * S)
                bw, bh = wl + 90 * S, 108 * S; self.ex["button"] = dict(cx=self.W / 2, cy=self.H * 0.60, w=bw, h=bh, t0=0.9)
                self.units.append(dict(rgb=rgb, a=a, x=self.W / 2 - wl / 2 - pad, y=self.H * 0.60 - rgb.shape[0] / 2, t0=1.05, dur=0.4, t1=None, kind="fade_up", i=0, text=cta))
                self.boxes.append(dict(x=self.W / 2 - bw / 2, y=self.H * 0.60 - bh / 2, w=bw, h=bh, text=cta, slam=False))
            if sc.get("subtitle"): self.add_text(sc["subtitle"], small, 0.72, color=acc2, t0=1.4, upper=False)
        elif k == "infographic":
            self.add_text(title, mid * 1.1, 0.14, t0=0.1, anim="fade_up", upper=False)
            st = sc.get("stats", [])[:4]; self.ex["stats"] = []; n = len(st)
            if n == 1 and comp == "bignum":
                self.ex["stats"] = [dict(cx=self.W / 2, cy=self.H * 0.44, **st[0], mode="bignum", t0=0.2)]; self.add_text(st[0]["label"], mid * 1.1, 0.58, t0=0.9, anim="fade_up", upper=False)
            elif n == 1:
                self.ex["stats"] = [dict(cx=self.W / 2, cy=self.H * 0.46, r=min(self.W, self.H) * 0.27, **st[0], mode="ring", t0=0.3)]
                self.add_text(st[0]["label"], mid, 0.46 + 0.27 * min(self.W, self.H) / self.H + 0.1, t0=0.9, anim="fade_up", upper=False)
            elif comp == "donuts" and n >= 2:
                r = min(self.W / (n * 2.5), self.H * 0.17)
                for i, s_ in enumerate(st):
                    cx = self.W * (i + 0.5) / n if not P else self.W * 0.5; cy = self.H * 0.40 if not P else self.H * (0.28 + i * 0.22)
                    self.ex["stats"].append(dict(cx=cx, cy=cy, r=r if not P else min(self.W * 0.17, self.H * 0.09), **s_, mode="ring", t0=0.3 + i * 0.25))
                    lx = cx - self.W * 0.0 if not P else cx + min(self.W * 0.30, 330 * S)
                    if P: self.add_text(s_["label"], small * 1.05, cy / self.H, t0=0.5 + i * 0.25, anim="fade_up", upper=False, align="left", x0=self.W * 0.5 + min(self.W * 0.17, self.H * 0.09) + 28 * S)
                    else: self.add_text(s_["label"], small, cy / self.H + r / self.H + 0.07, t0=0.5 + i * 0.25, anim="fade_up", upper=False)
            else:
                top = 0.30; step = 0.5 / max(1, n)
                for i, s_ in enumerate(st):
                    cy = (top + i * step + 0.03) * self.H; self.ex["stats"].append(dict(cx=self.W * 0.1, cy=cy, **s_, mode="bar", t0=0.3 + i * 0.25))
                    self.add_text(s_["label"], small * 1.1, top + i * step - 0.012, t0=0.3 + i * 0.25, anim="fade_up", upper=False, align="left", x0=self.W * 0.1)
        elif k == "diagram":
            steps = [x for x in sc.get("steps", []) if x][:5]; n = len(steps); self.ex["steps"] = []
            self.add_text(title, mid * 1.1, 0.14, t0=0.1, anim="fade_up", upper=False)
            for i, lbl in enumerate(steps):
                if P:
                    x = self.W * 0.20; y = self.H * (0.28 + i * (0.56 / max(1, n - 1 if n > 1 else 1))) if n > 1 else self.H * 0.5
                    self.ex["steps"].append((x, y)); self.add_text(lbl, small * 1.15, y / self.H, t0=0.5 + i * 0.5, anim="slide", upper=False, align="left", x0=self.W * 0.30)
                else:
                    x = self.W * (0.14 + i * (0.72 / max(1, n - 1))) if n > 1 else self.W * 0.5; y = self.H * 0.47
                    self.ex["steps"].append((x, y)); self.add_text(lbl, small, (y + 80 * S) / self.H, t0=0.5 + i * 0.5, anim="fade_up", upper=False)
        elif k == "showcase":
            self.ex["phone"] = self.make_phone()
            if title: self.add_text(title, big * 0.62, 0.12 if P else 0.5, t0=0.2, anim="words", align="center" if P else "left", x0=None if P else self.W * 0.08)
            if sc.get("subtitle"): self.add_text(sc["subtitle"], small, 0.2 if P else 0.64, color=acc2, t0=0.8, upper=False, align="center" if P else "left", x0=None if P else self.W * 0.08)
        elif k == "product3d":
            self.add_text(title, big * 0.72, 0.12 if P else 0.16, t0=0.25, anim="words")
            if sc.get("subtitle"): self.add_text(sc["subtitle"], small * 1.1, 0.86 if P else 0.84, color=acc2, t0=1.0, upper=False)
            for i, b in enumerate((sc.get("bullets") or [])[:3]): self.add_text(b, small, (0.74 if P else 0.7) + i * 0.045, t0=1.3 + i * 0.3, anim="slide", upper=False, align="left", x0=self.W * 0.08)
        elif k in ("title3d", "logo3d"):
            if sc.get("subtitle"): self.add_text(sc["subtitle"], mid * 0.85, 0.8, color=acc2, t0=1.1, upper=False)
        elif k == "journey3d":
            self.add_text(title, big * 0.9, 0.2, t0=0.3, anim="words" if comp != "slam" else "scale")
            if sc.get("subtitle"): self.add_text(sc["subtitle"], small * 1.1, 0.8, color=acc2, t0=1.2, upper=False)
        elif k in ("scenery25", "photo25d"):
            if title: self.add_text(title, big * 0.72, 0.16 if k == "scenery25" else 0.80, t0=0.3, anim="words")
            if sc.get("subtitle"): self.add_text(sc["subtitle"], small * 1.1, 0.26 if k == "scenery25" else 0.88, color=acc2, t0=1.0, upper=False)
            for i, b in enumerate((sc.get("bullets") or [])[:4]): self.add_text(b, small, 0.88 + i * 0.0 if False else 0.80 + i * 0.045, t0=1.2 + i * 0.3, anim="slide", upper=False, align="left", x0=self.W * 0.1) if k == "scenery25" else None
        elif k in ("image", "footage"):
            if title: self.add_text(title, big * 0.7, 0.80 if P else 0.82, t0=0.3, anim="words")

    def make_phone(self):
        S = self.s; ph = (0.60 if self.portrait else 0.74) * self.H; pw = ph * 0.49; pad = int(30 * S); R = int(pw * 0.14)
        img = Image.new("RGBA", (int(pw) + 2 * pad, int(ph) + 2 * pad), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
        sh = Image.new("RGBA", img.size, (0, 0, 0, 0)); ImageDraw.Draw(sh).rounded_rectangle((pad, pad + 14 * S, pad + pw, pad + ph + 14 * S), radius=R, fill=(0, 0, 0, 150))
        img = Image.alpha_composite(img, sh.filter(ImageFilter.GaussianBlur(14 * S))); d = ImageDraw.Draw(img)
        d.rounded_rectangle((pad, pad, pad + pw, pad + ph), radius=R, fill=(18, 18, 24, 255), outline=(90, 94, 110, 255), width=max(2, int(4 * S)))
        b = int(pw * 0.045); sx0, sy0, sx1, sy1 = pad + b, pad + b, pad + pw - b, pad + ph - b; sw, sh_ = int(sx1 - sx0), int(sy1 - sy0)
        screen = Image.new("RGBA", (sw, sh_), (0, 0, 0, 255))
        if self.asset_img is not None:
            im = Image.fromarray(self.asset_img[..., ::-1]).convert("RGBA"); sc_ = max(sw / im.width, sh_ / im.height); im = im.resize((int(im.width * sc_) + 1, int(im.height * sc_) + 1))
            screen.paste(im, ((sw - im.width) // 2, (sh_ - im.height) // 2))
        else:
            sd = ImageDraw.Draw(screen); sd.rectangle((0, 0, sw, sh_), fill=tuple(int(v) for v in self.cols[1]) + (255,))
            sd.rectangle((0, 0, sw, int(sh_ * 0.16)), fill=tuple(int(v) for v in self.accent) + (255,))
            for i in range(5):
                y = int(sh_ * (0.22 + i * 0.13)); w = int(sw * (0.84 - 0.1 * (i % 3))); sd.rounded_rectangle((int(sw * 0.08), y, int(sw * 0.08) + w, y + int(sh_ * 0.085)), radius=int(sh_ * 0.02), fill=(255, 255, 255, 38))
            sd.ellipse((int(sw * 0.08), int(sh_ * 0.03), int(sw * 0.08) + int(sh_ * 0.09), int(sh_ * 0.03) + int(sh_ * 0.09)), fill=(255, 255, 255, 90))
        m = Image.new("L", (sw, sh_), 0); ImageDraw.Draw(m).rounded_rectangle((0, 0, sw, sh_), radius=int(R * 0.8), fill=255); img.paste(screen, (int(sx0), int(sy0)), m)
        d = ImageDraw.Draw(img); d.rounded_rectangle((pad + pw * 0.36, pad + b * 1.3, pad + pw * 0.64, pad + b * 1.3 + 12 * S), radius=int(6 * S), fill=(8, 8, 12, 255))
        return np.asarray(img, np.float32) / 255.0

    # ---------------------------------------------------------------- compose
    def blit_arr(self, fr, rgb, a, x, y, alpha):
        h, w = a.shape; xi, yi = int(round(x)), int(round(y)); x0, y0, x1, y1 = max(0, xi), max(0, yi), min(self.W, xi + w), min(self.H, yi + h)
        if x1 <= x0 or y1 <= y0 or alpha <= 0: return
        sa = a[y0 - yi:y1 - yi, x0 - xi:x1 - xi, None] * min(1.0, alpha); sr = rgb[y0 - yi:y1 - yi, x0 - xi:x1 - xi]
        fr[y0:y1, x0:x1] = (fr[y0:y1, x0:x1] * (1 - sa) + sr * sa).astype(np.uint8)

    def blit(self, fr, u, t, cam):
        p = (t - u["t0"]) / u["dur"]
        if p <= 0: return
        if u.get("t1") is not None and t >= u["t1"]: return
        rgb, a = u["rgb"], u["a"]; x, y = u["x"] + cam[0] * 0.5, u["y"] + cam[1] * 0.5; k = u["kind"]; S = self.s; al = ease_out(p) * 1.15
        if k == "fade_up": y += (1 - ease_out(p)) * 34 * S
        elif k == "slide": x += (1 - ease_out(p)) * -90 * S
        elif k == "split_l": x += (1 - ease_out(p)) * -self.W * 0.5
        elif k == "split_r": x += (1 - ease_out(p)) * self.W * 0.5
        elif k == "rise": y += (1 - ease_out(p)) * 80 * S
        elif k == "wave": y += (1 - ease_out(p)) * 40 * S + (math.sin((t - u["t0"]) * 5.0 + u["i"] * 0.6) * 9 * S if p > 1 else 0)
        elif k in ("scale", "slam"):
            z = (1.0 + 0.35 * (1 - back_out(p)) if p < 1 else 1.0) if k == "scale" else (1.0 + 0.9 * (1 - ease_out(p * 1.4)) if p < 0.72 else 1.0)
            al = 1.0 if k == "slam" else al
            if abs(z - 1) > 0.004:
                h, w = a.shape; nw, nh = max(2, int(w * z)), max(2, int(h * z)); rgb = cv2.resize(rgb, (nw, nh)); a = cv2.resize(a, (nw, nh)); x -= (nw - w) / 2; y -= (nh - h) / 2
        self.blit_arr(fr, rgb, a, x, y, al)

    def shape_layer(self, fr, t):
        k = self.sc["kind"]; S = self.s; acc = tuple(int(v) for v in self.accent); comp = self.comp
        if k == "intro" and "rule" in self.ex:
            p = ease_out((t - 0.5) / 0.9); w = int(self.W * 0.22 * p); y = int(self.H * (0.50 if self.sc.get("subtitle") else 0.52))
            if w > 1: cv2.line(fr, (self.W // 2 - w // 2, y), (self.W // 2 + w // 2, y), acc, max(2, int(6 * S)), cv2.LINE_AA)
        elif k == "intro" and "bar" in self.ex:
            bx, by, h = self.ex["bar"]; p = ease_out((t - 0.2) / 0.7); L = int(h * 1.2 * p)
            if L > 1: cv2.line(fr, (int(bx), int(by - L / 2)), (int(bx), int(by + L / 2)), acc, max(3, int(8 * S)), cv2.LINE_AA)
        elif k == "quote" and "qbar" in self.ex:
            bx, by, h = self.ex["qbar"]; p = ease_out((t - 0.1) / 0.8); L = int(h * 1.25 * p)
            if L > 1: cv2.line(fr, (int(bx), int(by - L / 2)), (int(bx), int(by + L / 2)), acc, max(3, int(7 * S)), cv2.LINE_AA)
        elif k == "text" and "rule_y" in self.ex:
            p = ease_out((t - 0.4) / 0.9); w = int(self.W * 0.12 * p); y = int(self.H * max(0.12, self.ex["rule_y"]))
            if w > 1: cv2.line(fr, (self.W // 2 - w // 2, y), (self.W // 2 + w // 2, y), acc, max(2, int(6 * S)), cv2.LINE_AA)
        elif k == "product":
            for (bx, by, t0) in self.ex.get("bullets", []):
                p = back_out((t - t0) / 0.4)
                if p > 0: cv2.circle(fr, (int(bx), int(by)), max(2, int(13 * S * min(p, 1.2))), acc, -1, cv2.LINE_AA)
        elif k == "outro" and "button" in self.ex:
            b = self.ex["button"]; p = back_out((t - b["t0"]) / 0.45)
            if p > 0:
                pulse = 1 + 0.025 * math.sin(t * 5.0) * min(1.0, (t - b["t0"] - 0.5) * 3)
                w, h = b["w"] * min(p, 1.1) * pulse, b["h"] * min(p, 1.1) * pulse; x0, y0 = int(b["cx"] - w / 2), int(b["cy"] - h / 2)
                r = int(h / 2); X0, Y0, X1, Y1 = max(0, x0 - 4), max(0, y0 - 4), min(self.W, x0 + int(w) + 4), min(self.H, y0 + int(h) + 4)
                roi = fr[Y0:Y1, X0:X1]; lay = roi.copy(); o = (-X0, -Y0)
                cv2.rectangle(lay, (x0 + r + o[0], y0 + o[1]), (x0 + int(w) - r + o[0], y0 + int(h) + o[1]), acc, -1, cv2.LINE_AA)
                cv2.circle(lay, (x0 + r + o[0], y0 + r + o[1]), r, acc, -1, cv2.LINE_AA); cv2.circle(lay, (x0 + int(w) - r + o[0], y0 + r + o[1]), r, acc, -1, cv2.LINE_AA)
                fr[Y0:Y1, X0:X1] = lay if p >= 1 else (roi * (1 - min(1, p)) + lay * min(1, p)).astype(np.uint8)
        elif k == "infographic":
            for s_ in self.ex.get("stats", []):
                p = ease_out((t - s_["t0"]) / 1.4); val = float(s_["value"]); mx = max(1.0, float(s_.get("max") or (100 if s_.get("suffix") == "%" else val)))
                if s_["mode"] == "bignum":
                    self.counter(fr, s_["cx"], s_["cy"], val * p, s_.get("suffix", ""), 230)
                elif s_["mode"] == "ring":
                    r = int(s_["r"]); c = (int(s_["cx"]), int(s_["cy"])); th = max(8, int(r * 0.16))
                    cv2.ellipse(fr, c, (r, r), -90, 0, 360, (60, 64, 90) if not self.light else (200, 204, 215), th, cv2.LINE_AA)
                    cv2.ellipse(fr, c, (r, r), -90, 0, float(360 * min(1.0, val / mx) * p), acc, th, cv2.LINE_AA)
                    self.counter(fr, c[0], c[1], val * p, s_.get("suffix", ""), max(40, 96 * r / (min(self.W, self.H) * 0.27)))
                else:
                    x0 = int(self.W * 0.1); wmax = int(self.W * 0.8); y = int(s_["cy"]); th = int(34 * S)
                    cv2.rectangle(fr, (x0, y), (x0 + wmax, y + th), (60, 64, 90) if not self.light else (200, 204, 215), -1, cv2.LINE_AA)
                    cv2.rectangle(fr, (x0, y), (x0 + int(wmax * min(1.0, val / mx) * p), y + th), acc, -1, cv2.LINE_AA)
                    self.counter(fr, x0 + wmax, y - int(40 * S), val * p, s_.get("suffix", ""), 52, right=True)
        elif k == "diagram":
            pts = self.ex.get("steps", []); n = len(pts)
            if n:
                prog = ease((t - 0.35) / (0.5 * max(1, n))); lim = prog * (n - 1) if n > 1 else 1
                for i in range(n - 1):
                    seg = min(1.0, max(0.0, lim - i))
                    if seg > 0:
                        a_, b_ = pts[i], pts[i + 1]; cv2.line(fr, (int(a_[0]), int(a_[1])), (int(a_[0] + (b_[0] - a_[0]) * seg), int(a_[1] + (b_[1] - a_[1]) * seg)), acc, max(3, int(6 * S)), cv2.LINE_AA)
                for i, (x, y) in enumerate(pts):
                    on = back_out((t - (0.35 + 0.5 * i)) / 0.4)
                    if on > 0:
                        r = int(34 * S * min(on, 1.15)); cv2.circle(fr, (int(x), int(y)), r, acc, -1, cv2.LINE_AA)
                        if t - (0.35 + 0.5 * i) > 0.4: cv2.circle(fr, (int(x), int(y)), int(r + 10 * S + 8 * S * math.sin(t * 4 + i)), acc, max(1, int(2 * S)), cv2.LINE_AA)
                        self.counter(fr, x, y, i + 1, "", 40, color=(10, 10, 20), intval=True)
        elif k == "showcase" and "phone" in self.ex:
            ph = self.ex["phone"]; h, w = ph.shape[:2]; p = ease_out((t - 0.2) / 0.8); kk = 0.07 * math.sin(t * 0.9 + 0.4); kl, kr = max(kk, 0), max(-kk, 0)
            src = np.float32([[0, 0], [w, 0], [w, h], [0, h]]); dst = np.float32([[0, h * kl], [w, h * kr], [w, h * (1 - kr)], [0, h * (1 - kl)]])
            M = cv2.getPerspectiveTransform(src, dst); wr = cv2.warpPerspective(ph, M, (w, h), flags=cv2.INTER_LINEAR)
            cx = self.W * 0.5 if self.portrait else self.W * 0.72; cy = self.H * 0.60 if self.portrait else self.H * 0.5
            cx += self.cam(t)[0] * 1.6; cy += (1 - p) * 120 * S + math.sin(t * 1.6) * 9 * S + self.cam(t)[1] * 1.6
            self.blit_arr(fr, wr[..., :3] * 255.0, wr[..., 3], cx - w / 2, cy - h / 2, p * 1.1)

    def counter(self, fr, x, y, v, suffix, size, right=False, color=None, intval=False):
        txt = (f"{v:.0f}" if (self.whole or intval) else f"{v:.1f}") + suffix
        rgb, a, wl = self.sprite(txt, size, self.j["text"].get("font", "modern"), self.tcol if color is None else color, shadow=color is None); h, w = a.shape
        xi = int(x - w + int(18 * self.s)) if right else int(x - w / 2); yi = int(y - h / 2)
        self.blit_arr(fr, rgb, a, xi, yi, 1.0)

    def post(self, fr, t):
        fr = self.draw_motif(fr, t)
        if self.grain is not None:
            ox, oy = self.rs.randint(0, 32), self.rs.randint(0, 32); pos, neg = self.grain
            fr = cv2.subtract(cv2.add(fr, np.ascontiguousarray(pos[oy:oy + self.H, ox:ox + self.W])), np.ascontiguousarray(neg[oy:oy + self.H, ox:ox + self.W]))
        if self.bar: fr[:self.bar] = 0; fr[self.H - self.bar:] = 0
        return fr


    # ======================================================================= 3D  (genuine: meshes, camera, lighting; see render3d.py)
    def build3d(self):
        th = self.sc.get("three"); self.th = th; self.meshes = []; self.R3 = None; self.stat3 = dict(faces=0, ms=0.0, frames=0)
        if not th: return
        self.R3 = r3.Renderer3D(self.W, self.H); asp = self.W / self.H
        fpath = self.j["text"].get("fontFile") or (FONTS.get(self.j["text"].get("font", "modern"), FONTS["modern"])[0])
        for o in th.get("objects", []):
            sh = o.get("shape", "cube"); col = hexrgb(o.get("color") or "#c8a24a") if o.get("color") else self.accent
            metal, gloss = float(o.get("metal", 0.3)), float(o.get("gloss", 0.7)); size = float(o.get("size", 1.0)); parts = []
            if sh == "bottle":
                prof = r3.smooth_profile([(0.001, 0), (0.55, 0), (0.62, 0.12), (0.62, 0.95), (0.5, 1.15), (0.2, 1.22), (0.17, 1.5), (0.17, 1.62)], 2, 0.2)
                body = r3.revolve(prof, 56, color=col, metal=0.15, gloss=0.97); cap = r3.translate(r3.cylinder(0.26, 0.5, 32, color=(212, 175, 80), metal=0.95, gloss=0.85), (0, 1.8, 0))
                liq = r3.revolve(r3.smooth_profile([(0.001, 0.05), (0.52, 0.05), (0.57, 0.14), (0.57, 0.8), (0.46, 0.98), (0.001, 1.0)], 2, 0.2), 40, color=np.clip(col * 1.25 + 30, 0, 255), metal=0.0, gloss=0.6, emissive=0.25)
                parts = [body, liq, cap]
                for m in parts: m.v = m.v * size - np.array([0, 0.95 * size, 0], np.float32)
            elif sh == "dumbbell":
                bar = r3.cylinder(0.11, 1.9, 24, color=(170, 170, 180), metal=0.95, gloss=0.8); bar.v = bar.v @ r3.rotm("z", 90).T
                plates = [r3.translate(r3.cylinder(0.55 - 0.08 * k, 0.26, 36, rings=1, color=col if k == 0 else (40, 40, 48), metal=0.6, gloss=0.6), (sgn * (0.55 + 0.3 * k), 0, 0)) for sgn in (-1, 1) for k in (0, 1)]
                for pl in plates: pl.v = pl.v @ r3.rotm("z", 90).T if False else pl.v
                # plates are discs facing +x: rotate cylinders (axis y) onto axis x
                parts = [bar] + [r3.Mesh(pl.v @ r3.rotm("z", 90).T + 0, pl.f, pl.color, pl.flat, pl.metal, pl.gloss, pl.emissive) for pl in plates]
                for k, pl in enumerate(parts[1:]): pass
                for m in parts: m.v = m.v * size; m.pairs = True
            elif sh == "coin":
                c = r3.cylinder(1.0, 0.16, 56, rings=1, color=col, metal=0.95, gloss=0.85); ring = r3.torus(0.94, 0.06, 56, 10, color=np.clip(col * 1.2, 0, 255), metal=0.95, gloss=0.9); ring.v = ring.v * np.array([1, 1.0, 1], np.float32) + np.array([0, 0.08, 0], np.float32)
                parts = [c, ring]
                for m in parts: m.v = (m.v @ r3.rotm("x", 90).T) * size
            elif sh == "gem": g = r3.gem(1.0, color=col, metal=0.2, gloss=1.0); g.v *= size; parts = [g]
            elif sh == "sphere": g = r3.sphere(1.0, 48, 28, color=col, metal=metal, gloss=gloss); g.v *= size; parts = [g]
            elif sh == "torus": g = r3.torus(0.9, 0.34, 56, 20, color=col, metal=metal, gloss=gloss); g.v *= size; parts = [g]
            elif sh == "knot": g = r3.torus_knot(color=col, metal=metal, gloss=gloss, nu=140, nv=12); g.v *= size * 1.15; parts = [g]
            elif sh == "cube": g = r3.box(1.5, 1.5, 1.5, color=col, metal=metal, gloss=gloss); g.v *= size; parts = [g]
            elif sh == "phone":
                body = r3.rbox(1.05, 2.1, 0.12, 0.2, color=(28, 28, 34), metal=0.7, gloss=0.9); body.v *= size; parts = [body]
            elif sh in ("text", "logo"):
                try:
                    if sh == "text": mk = r3.text_mask(o.get("text") or self.sc.get("title") or "TEXT", fpath, px=300)
                    else:
                        im = cv2.imread(o["file"], cv2.IMREAD_UNCHANGED); assert im is not None, "logo not readable"
                        if im.ndim == 3 and im.shape[2] == 4: mk = im[..., 3]
                        else: g_ = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY) if im.ndim == 3 else im; mk = 255 - g_ if g_.mean() > 127 else g_
                        sc_ = 300.0 / max(mk.shape); mk = cv2.resize(mk, None, fx=sc_, fy=sc_, interpolation=cv2.INTER_AREA); mk = cv2.copyMakeBorder(mk, 16, 16, 16, 16, cv2.BORDER_CONSTANT, value=0)
                    mm = r3.extrude_mask(mk, depth=float(o.get("depth", 0.34)), height=1.0, color=col, metal=max(metal, 0.5), gloss=gloss)
                    wdt = float(mm.v[:, 0].max() - mm.v[:, 0].min()); view_w = 2 * 6.0 * math.tan(math.radians(36) / 2) * asp
                    k = (view_w * 0.8) / max(wdt, 1e-3) * (0.9 if sh == "logo" else 1.0); mm.v = mm.v * k * min(size, 1.15); parts = [mm]
                except Exception as e:
                    print("WARN 3D " + sh + ": " + str(e)[:80], file=sys.stderr, flush=True); parts = []
            elif sh == "glb":
                try:
                    mm = r3.load_glb(o["file"]); mm.v = mm.v * 2.2 * size; parts = [mm]
                    for n_ in getattr(mm, "notes", []): print("NOTE " + n_, file=sys.stderr, flush=True)
                except Exception as e:
                    print("WARN glb: " + str(e)[:100], file=sys.stderr, flush=True); parts = []
            if parts:
                tex = None
                if sh == "phone": tex = self.phone_texture()
                self.meshes.append(dict(parts=parts, o=o, tex=tex))
        if th.get("environment") == "terrain":
            tr = r3.terrain(size=16.0, n=44, seed=int(th.get("seed", 3)), height=1.1)
            h = tr.v[:, 1]; hn = (h - h.min()) / (np.ptp(h) + 1e-6); fc = tr.f; hh = hn[fc].mean(1)[:, None]
            lo, hi = np.array([20, 30, 60], np.float32), np.clip(self.accent * 0.6 + 60, 0, 255); tr.fcol = lo * (1 - hh) + hi * hh * 0.9 + 10; tr.color = lo; tr.gloss = 0.15; self.terrain = tr
        else: self.terrain = None
        self.pt = r3.particles3d(int(th.get("particles", 0)), self.j.get("seed", 1)) if th.get("particles") else None

    def phone_texture(self):
        S = 400; img = np.zeros((int(S * 2.0), S, 3), np.uint8); img[:] = tuple(int(v) for v in (self.cols[1] * 0.8 + 20)[::-1])
        if self.asset_img is not None:
            a = self.asset_img; sc = max(img.shape[1] / a.shape[1], img.shape[0] / a.shape[0]); a = cv2.resize(a, None, fx=sc, fy=sc); y0 = (a.shape[0] - img.shape[0]) // 2; x0 = (a.shape[1] - img.shape[1]) // 2; img = a[y0:y0 + img.shape[0], x0:x0 + img.shape[1]].copy()
        else:
            cv2.rectangle(img, (0, 0), (S, int(S * 0.3)), tuple(int(v) for v in self.accent[::-1]), -1)
            for i in range(5): y = int(S * (0.42 + i * 0.28)); cv2.rectangle(img, (int(S * 0.08), y), (int(S * (0.9 - 0.1 * (i % 3))), y + int(S * 0.18)), (255, 255, 255), -1); img[y:y + int(S * 0.18), int(S * 0.08):int(S * (0.9 - 0.1 * (i % 3)))] = (img[y:y + int(S * 0.18), int(S * 0.08):int(S * (0.9 - 0.1 * (i % 3)))] * 0.18 + 255 * 0.12).astype(np.uint8)
        return img

    def cam3(self, t):
        th = self.th; c = th.get("camera", {}); u = ease(t / max(0.1, self.j["seconds"]))
        pair = lambda v, dflt: (list(v) + [v[-1]])[:2] if isinstance(v, (list, tuple)) and v else ([v, v] if isinstance(v, (int, float)) else dflt)
        o0, o1 = pair(c.get("orbit"), [-12, 12]); d0, d1 = pair(c.get("dolly"), [6.4, 5.4]); hgt = c.get("height", 0.5); tg = np.array(c.get("target", [0, 0, 0]), np.float32)
        a = math.radians(o0 + (o1 - o0) * u); d = d0 + (d1 - d0) * u
        if th.get("environment") == "terrain":
            z = -t * float(c.get("speed", 0.9)); return r3.Camera((math.sin(t * 0.3) * 0.5, 1.9 + 0.1 * math.sin(t * 0.7), z + 1.0), (math.sin(t * 0.2) * 0.4, 1.4, z - 6.0), float(c.get("fov", 52)))
        return r3.Camera(tg + np.array([math.sin(a) * d, hgt, math.cos(a) * d], np.float32), tg, float(c.get("fov", 36)))

    def draw3d(self, fr, t):
        th = self.th; t0 = __import__("time").time(); cam = self.cam3(t)
        lk = th.get("light", {}); key = np.array(lk.get("key", [-0.5, 0.8, 0.6]), np.float32); kc = hexrgb(lk["color"]) if lk.get("color") else np.array([255, 240, 225], np.float32)
        light = dict(dir=key, color=kc, intensity=float(lk.get("intensity", 1.0)), rim=list(np.clip(self.accent * 0.8 + 40, 0, 255)))
        tone = np.clip(self.cols[2] * 0.8 + self.accent * 0.4, 20, 255)
        items = []; floor_y = th.get("floor"); decals = []
        for mo in self.meshes:
            o = mo["o"]; sp = o.get("spin", {}); ang = (float(sp.get("start", 0)) + 22.0 * math.sin(t * 0.8)) if o.get("shape") in ("text", "logo") else float(sp.get("start", 0)) + float(sp.get("dps", 28)) * t;   # titles swing (readable); objects revolve
            R = r3.rotm(sp.get("axis", "y"), ang) @ r3.rotm("x", float(o.get("tilt", 0)))
            pos = np.array(o.get("pos", [0, 0, 0]), np.float32) + np.array([0, 0.06 * math.sin(t * 1.4 + o.get("phase", 0)), 0], np.float32)
            ent = ease_out(min(1.0, max(0.0, (t - float(o.get("delay", 0.0))) / 0.9))); sc = 0.55 + 0.45 * back_out(ent) if o.get("pop", True) else 1.0
            for m in mo["parts"]: items.append((m, R, pos, sc))
            if mo["tex"] is not None: decals.append((mo, R, pos, sc))
        if self.terrain is not None:
            items = [(self.terrain, np.eye(3, dtype=np.float32), np.zeros(3, np.float32), 1.0)] + items
        if not items: return fr
        fog = None
        if self.terrain is not None: fog = (list(np.clip(self.accent * 0.5 + self.cols[1] * 0.6 + 30, 0, 255)), 3.0, 17.0)
        fl = None if self.terrain is not None else (float(floor_y) if floor_y is not None else None)
        lay, x0, y0 = self.R3.render(items, cam, light, tone=tone, floor=fl, fog=fog, reflection=bool(th.get("reflection", True)), shadow=bool(th.get("shadow", True)))
        r3.composite(fr, lay, x0, y0)
        for (mo, R, pos, sc) in decals: self.draw_screen(fr, cam, mo, R, pos, sc)
        if self.pt is not None: fr[:] = r3.draw_particles(fr, cam, self.pt[0], self.pt[1], t, self.W, self.H, self.accent, size=float(th.get("particleSize", 3.0)), bounds=(5.0, 4.0, 5.0))
        self.stat3["faces"] = max(self.stat3["faces"], sum(len(m.f) for (m, _, _, _) in items)); self.stat3["ms"] += (__import__("time").time() - t0) * 1000; self.stat3["frames"] += 1
        return fr

    def draw_screen(self, fr, cam, mo, R, pos, sc):
        """The phone screen is a textured quad placed in 3D and projected with the real camera (homography), drawn only while it faces the camera."""
        w, h, z = 0.46 * 2 * 1.0, 0.98 * 2 * 1.0, 0.065
        sz = float(mo["o"].get("size", 1.0)); P = np.array([[-w / 2, h / 2, z], [w / 2, h / 2, z], [w / 2, -h / 2, z], [-w / 2, -h / 2, z]], np.float32) * sz
        W3 = (P @ R.T) * sc + pos; n = R @ np.array([0, 0, 1], np.float32)
        if float(np.dot(n, cam.pos - W3.mean(0))) <= 0: return
        px, _ = cam.project(W3, self.R3.W, self.R3.H); px = px / self.R3.sc; tex = mo["tex"]; th_, tw_ = tex.shape[:2]
        M = cv2.getPerspectiveTransform(np.float32([[0, 0], [tw_, 0], [tw_, th_], [0, th_]]), px.astype(np.float32))
        x0, y0 = np.clip(px.min(0).astype(int) - 2, 0, [self.W - 1, self.H - 1]); x1, y1 = np.clip(px.max(0).astype(int) + 3, 0, [self.W, self.H])
        if x1 <= x0 or y1 <= y0: return
        wr = cv2.warpPerspective(tex, M, (self.W, self.H), flags=cv2.INTER_LINEAR)[y0:y1, x0:x1]; mk = cv2.warpPerspective(np.full((th_, tw_), 255, np.uint8), M, (self.W, self.H), flags=cv2.INTER_LINEAR)[y0:y1, x0:x1]
        mk = cv2.GaussianBlur(mk, (3, 3), 0.8).astype(np.float32)[..., None] / 255.0
        fr[y0:y1, x0:x1] = np.clip(fr[y0:y1, x0:x1] * (1 - mk) + wr[..., ::-1] * mk, 0, 255).astype(np.uint8)

    # ======================================================================= 2.5D  (simulated depth: flat layers moved at different rates; NOT 3D)
    def scenery25(self, fr, t):
        """Layered silhouette landscape/skyline: each layer sits at a notional depth; the camera drift moves near layers more (parallax), haze lightens far ones."""
        W, H = self.W, self.H; kind = self.sc.get("scenery", "mountains"); u = t / max(0.1, self.j["seconds"]); cx = (u - 0.5) * 120 * self.s + self.cam(t)[0] * 2
        n = 5; rs = np.random.RandomState(self.j.get("seed", 1) * 7 + 3)
        for li in range(n):
            depth = 1.0 - li / (n - 1) * 0.85            # 1 = far, ~0.15 = near
            par = (1 - depth) * 1.0 + 0.1; base = H * (0.55 + 0.1 * li); amp = H * (0.10 + 0.045 * li) * (1.0 if kind == "mountains" else 0.6)
            xs = np.linspace(-80, W + 80, 120); off = cx * par * 2.6
            if kind == "city":
                pts = []; x = -80 - (off % 140)
                while x < W + 80:
                    bw = 40 * self.s * (0.9 + li * 0.5) * (0.7 + rs.rand() * 0.9); bh = amp * (0.5 + rs.rand() * 1.6); pts += [(x, base), (x, base - bh), (x + bw, base - bh), (x + bw, base)]; x += bw + 4
                poly = np.array([(0, H)] + [(px_, py_) for px_, py_ in pts] + [(W, H)], np.int32)
            else:
                ys = base - amp * (0.55 * np.sin((xs + off) * 0.006 / (0.4 + li * 0.5) + li * 1.7) + 0.3 * np.sin((xs + off) * 0.017 / (0.4 + li * 0.4) + li) + 0.15 * np.sin((xs + off) * 0.043 + li * 2.3))
                poly = np.array([(-80, H)] + list(zip(xs, ys)) + [(W + 80, H)], np.int32)
            haze = depth ** 1.4 * 0.7; c = self.cols[0] * (1 - haze) * 0.55 + (self.cols[2] * 0.75 + self.cols[1] * 0.25 + self.accent * 0.12) * haze + 6 * li
            lay = fr.copy(); cv2.fillPoly(lay, [poly], tuple(float(v) for v in np.clip(c, 0, 255)[::-1])); fr[:] = lay
            if kind == "city" and li >= 2:       # lit windows on the nearer layers
                for _ in range(26 * li):
                    wx = int(rs.rand() * W); wy = int(base - amp * 0.2 * (1 + rs.rand() * 2)); 
                    if 0 <= wy < H and (np.sin(t * 0.7 + wx) > -0.2): cv2.rectangle(fr, (wx, wy), (wx + 3 + li, wy + 4 + li), (int(self.accent[2]), int(self.accent[1]), int(self.accent[0])), -1)
        return fr

    def photo25(self, fr, t):
        """2.5D photo presentation: blurred full-bleed copy (far layer), the photo as a floating card with perspective tilt and shadow (mid layer), drifting bokeh (near layer)."""
        img = self.asset_img
        if self.cap is not None:
            ok, f_ = self.cap.read()
            if not ok: self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0); ok, f_ = self.cap.read()
            img = f_ if ok else None
        if img is None: return fr
        W, H = self.W, self.H; u = t / max(0.1, self.j["seconds"]); ih, iw = img.shape[:2]
        sc = max(W / iw, H / ih) * (1.15 + 0.05 * u); bgp = cv2.resize(img, None, fx=sc * 0.5, fy=sc * 0.5); bgp = cv2.GaussianBlur(bgp, (0, 0), 9); bh, bw = bgp.shape[:2]
        cxo = int((bw - W * 0.5) / 2 + (u - 0.5) * 30); cyo = int((bh - H * 0.5) / 2); crop = bgp[max(0, cyo):max(0, cyo) + int(H * 0.5), max(0, cxo):max(0, cxo) + int(W * 0.5)]
        far = cv2.resize(crop, (W, H)).astype(np.float32)[..., ::-1] * 0.45 + self.cols[0] * 0.35; fr[:] = np.clip(far, 0, 255).astype(np.uint8)
        cw = W * 0.82; chh = min(H * 0.55, cw * ih / iw); cw = chh * iw / ih if chh == H * 0.55 else cw
        cx_, cy_ = W / 2 + math.sin(t * 0.6) * 14 * self.s, H * 0.44 + math.sin(t * 0.9) * 10 * self.s; tilt = math.sin(t * 0.5) * 0.045
        src = np.float32([[0, 0], [iw, 0], [iw, ih], [0, ih]]); dst = np.float32([[cx_ - cw / 2, cy_ - chh / 2 * (1 - tilt)], [cx_ + cw / 2, cy_ - chh / 2 * (1 + tilt)], [cx_ + cw / 2, cy_ + chh / 2 * (1 + tilt)], [cx_ - cw / 2, cy_ + chh / 2 * (1 - tilt)]])
        M = cv2.getPerspectiveTransform(src, dst); card = cv2.warpPerspective(img, M, (W, H), flags=cv2.INTER_AREA if iw > cw * 1.5 else cv2.INTER_LINEAR); mk = cv2.warpPerspective(np.full((ih, iw), 255, np.uint8), M, (W, H))
        sh = cv2.GaussianBlur(np.roll(mk, (int(22 * self.s), int(14 * self.s)), (0, 1)), (0, 0), 18 * self.s).astype(np.float32)[..., None] / 255.0 * 0.6; fr[:] = np.clip(fr * (1 - sh), 0, 255).astype(np.uint8)
        a = cv2.GaussianBlur(mk, (3, 3), 0.8).astype(np.float32)[..., None] / 255.0; fr[:] = np.clip(fr * (1 - a) + card[..., ::-1] * a, 0, 255).astype(np.uint8)
        lay = np.zeros((H, W, 3), np.float32)
        for (px_, py_, sz_, sp_) in self.parts[:14]:
            y = (py_ - t * sp_ * 0.7) % 1.1 - 0.05; x = px_ + 0.05 * math.sin(t * 0.6 + py_ * 7); cv2.circle(lay, (int(x * W), int(y * H)), max(4, int(sz_ * 16 * self.s)), tuple(float(v) / 255.0 * 0.5 for v in self.accent), -1, cv2.LINE_AA)
        lay = cv2.GaussianBlur(lay, (0, 0), 5 * self.s); fr[:] = np.clip(fr.astype(np.float32) + lay * 255.0, 0, 255).astype(np.uint8); return fr

    # ======================================================================= brand logo (aspect and pixels preserved; only position/opacity/size animate)
    def build_logo(self):
        lg = self.sc.get("logo"); self.lg = None
        if not lg or not lg.get("file") or lg.get("extrude"): return
        try: im = Image.open(lg["file"]).convert("RGBA")
        except Exception as e: print("WARN logo: " + str(e)[:80], file=sys.stderr, flush=True); return
        al = np.asarray(im)[..., 3]
        if (al < 250).any():                                     # crop fully transparent margins only, so the logo is sized by its visible content
            ys, xs = np.nonzero(al > 24)
            if len(xs): im = im.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
        P = self.portrait; hero = bool(lg.get("hero")); k = float(lg.get("scale", 1.0))
        maxw = self.W * ((0.70 if hero else 0.54) if P else (0.42 if hero else 0.30)) * k; maxh = self.H * ((0.20 if hero else 0.12) if P else (0.30 if hero else 0.18)) * k
        r = min(maxw / im.width, maxh / im.height); im = im.resize((max(2, round(im.width * r)), max(2, round(im.height * r))), Image.LANCZOS)     # one factor for both axes: proportions kept
        arr = np.asarray(im).astype(np.float32); a = arr[..., 3] / 255.0; rgb = arr[..., :3]
        cy = self.H * (0.40 if hero else 0.22); cx = self.W / 2; x = cx - im.width / 2; y = cy - im.height / 2
        # contrast: if the logo's own tone matches the background behind it, sit it on a neutral plate (the logo itself is not recoloured)
        l_logo = float((lum_arr(rgb) * a).sum() / max(1e-3, a.sum())); bgp = self.bg_frame(1.0)
        ry0, ry1, rx0, rx1 = max(0, int(y)), min(self.H, int(y + im.height)), max(0, int(x)), min(self.W, int(x + im.width)); l_bg = float(lum_arr(bgp[ry0:ry1, rx0:rx1].astype(np.float32)).mean()) if ry1 > ry0 and rx1 > rx0 else 40.0
        plate = abs(l_logo - l_bg) < 60; self.lg = dict(rgb=rgb, a=a, x=x, y=y, w=im.width, h=im.height, role=lg.get("role", "opening"), reveal=lg.get("reveal", "sweep"), plate=plate, plate_light=l_logo < 128, t0=0.2 if lg.get("role") != "closing" else 0.35)
        self.boxes.append(dict(x=x, y=y, w=im.width, h=im.height, text="[logo]", slam=False, logo=True)); self.logo_info = dict(w=im.width, h=im.height, plate=plate, aspect=round(im.width / im.height, 4))

    def draw_logo(self, fr, t):
        L = self.lg
        if L is None: return
        p = (t - L["t0"]) / 0.8
        if p <= 0: return
        e = ease_out(min(1.0, p)); rgb, a, x, y = L["rgb"], L["a"], L["x"], L["y"]; h, w = a.shape; sc = 0.93 + 0.07 * e if L["reveal"] != "rise" else 1.0
        if L["reveal"] == "rise": y += (1 - e) * 46 * self.s
        if sc < 0.999: nw, nh = max(2, round(w * sc)), max(2, round(h * sc)); rgb = cv2.resize(rgb, (nw, nh), interpolation=cv2.INTER_AREA); a = cv2.resize(a, (nw, nh), interpolation=cv2.INTER_AREA); x += (w - nw) / 2; y += (h - nh) / 2
        if L["reveal"] == "sweep" and 0.45 < (t - L["t0"]) < 1.45:   # a moving light band, visible only on the logo's own pixels; the logo is unchanged when it ends
            ww = rgb.shape[1]; xs = (np.arange(ww, dtype=np.float32) - ww * (((t - L["t0"]) - 0.45) / 1.0) * 1.4 + ww * 0.2) / (ww * 0.12); band = np.exp(-xs ** 2)[None, :, None] * 70.0; rgb = np.clip(rgb + band, 0, 255)
        if L["plate"]:
            pad = int(0.16 * h); x0, y0, x1, y1 = int(x - pad * 1.6), int(y - pad), int(x + a.shape[1] + pad * 1.6), int(y + a.shape[0] + pad); col = (246, 246, 248) if L["plate_light"] else (14, 14, 22)
            ov = fr.copy(); cv2.rectangle(ov, (x0, y0), (x1, y1), col, -1); r_ = int(min(y1 - y0, x1 - x0) * 0.22)
            msk = np.zeros(fr.shape[:2], np.uint8); cv2.rectangle(msk, (x0 + r_, y0), (x1 - r_, y1), 255, -1); cv2.rectangle(msk, (x0, y0 + r_), (x1, y1 - r_), 255, -1)
            for cx_, cy_ in ((x0 + r_, y0 + r_), (x1 - r_, y0 + r_), (x0 + r_, y1 - r_), (x1 - r_, y1 - r_)): cv2.circle(msk, (cx_, cy_), r_, 255, -1)
            m = (cv2.GaussianBlur(msk, (0, 0), 1.2).astype(np.float32) / 255.0)[..., None] * 0.9 * e; fr[:] = np.clip(fr * (1 - m) + np.array(col, np.float32) * m, 0, 255).astype(np.uint8)
        self.blit_arr(fr, rgb, a, x, y, e)

    def frame(self, i):
        t = i / self.fps; k = self.sc["kind"]
        fr = np.ascontiguousarray(self.bg_frame(t)); cam = self.cam(t)
        if self.sc.get("scenery"): fr = np.ascontiguousarray(self.scenery25(fr, t))
        if k == "photo25d": fr = np.ascontiguousarray(self.photo25(fr, t))
        if self.th: fr = np.ascontiguousarray(self.draw3d(fr, t))
        self.shape_layer(fr, t)
        self.draw_logo(fr, t)
        for u in self.units: self.blit(fr, u, t, cam)
        return self.post(fr, t)

def peak_rss_mb():
    try:
        import resource; return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0, 1)
    except Exception:
        return None

def main():
    job = json.loads(sys.stdin.read()); sc = Scene(job)
    enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{sc.W}x{sc.H}", "-r", str(sc.fps), "-i", "-",
                            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "16", "-pix_fmt", "yuv420p", "-f", "mp4", job["out"]], stdin=subprocess.PIPE)
    try:
        for i in range(sc.N):
            enc.stdin.write(sc.frame(i).tobytes())
            if i % 6 == 0 or i == sc.N - 1: print(f"PROGRESS {i + 1} {sc.N}", file=sys.stderr, flush=True)     # real frame counter, read by the pipeline
        enc.stdin.close()
    except BrokenPipeError:
        pass
    if enc.wait() != 0:
        sys.exit("ffmpeg failed while encoding the scene")
    json.dump(dict(boxes=sc.boxes, fonts=sorted(FONT_USED), peakRssMB=peak_rss_mb(), frames=sc.N, w=sc.W, h=sc.H, engine3d=(dict(faces=sc.stat3['faces'], msPerFrame=round(sc.stat3['ms'] / max(1, sc.stat3['frames']), 1), internal=[sc.R3.W, sc.R3.H]) if sc.th else None), logo=getattr(sc, 'logo_info', None), depth25=bool(sc.sc.get('scenery') or sc.sc.get('kind') == 'photo25d')), open(job["out"] + ".meta.json", "w"))

if __name__ == "__main__":
    main()
