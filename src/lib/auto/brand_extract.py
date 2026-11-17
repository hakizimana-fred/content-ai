"""Logo analysis for brand profiles. stdin: {file}. stdout: {width,height,aspect,hasAlpha,bbox,colors:[{hex,share}],roles:{primary,secondary,accent},derived:[...]}
Reads the logo only; never writes or alters it. Colours come from k-means over the logo's own visible pixels."""
import json, sys
import numpy as np
from PIL import Image

def hexof(c): return "#%02x%02x%02x" % tuple(int(round(v)) for v in c)
def lum(c): return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
def sat(c): mx, mn = max(c), min(c); return 0.0 if mx == 0 else (mx - mn) / mx
def dist(a, b): return float(np.linalg.norm(np.array(a) - np.array(b)))
def shade(c, k): return [max(0, min(255, v * k)) for v in c]
def mix(a, b, t): return [a[i] * (1 - t) + b[i] * t for i in range(3)]

def main():
    job = json.loads(sys.stdin.read()); im = Image.open(job["file"]); im.load(); W0, H0 = im.size
    has_alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
    rgba = np.asarray(im.convert("RGBA")); a = rgba[..., 3]
    vis = a > 24 if has_alpha and (a < 250).any() else np.ones(a.shape, bool)
    if not (has_alpha and (a < 250).any()):         # no transparency: a flat backdrop (corners agree) is not part of the logo
        corners = np.array([rgba[0, 0, :3], rgba[0, -1, :3], rgba[-1, 0, :3], rgba[-1, -1, :3]], np.float32)
        if np.max(np.linalg.norm(corners - corners.mean(0), axis=1)) < 18:
            vis = np.linalg.norm(rgba[..., :3].astype(np.float32) - corners.mean(0), axis=2) > 36; has_alpha = False
    if vis.sum() < 20 and not has_alpha: vis = np.ones(a.shape, bool)       # a solid-colour image: the whole image is the logo
    ys, xs = np.nonzero(vis)
    if len(xs) < 20: sys.exit("no visible logo pixels found")
    bbox = [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]
    px = rgba[..., :3][vis].astype(np.float32); step = max(1, len(px) // 20000); px = px[::step]
    rs = np.random.RandomState(7); k = min(7, max(2, len(np.unique(px.astype(np.int32) // 16, axis=0))))
    cen = [px[rs.randint(len(px))]]
    for _ in range(k - 1):
        d = np.min(np.stack([np.linalg.norm(px - c, axis=1) for c in cen]), 0) ** 2
        cen.append(px[rs.choice(len(px), p=d / d.sum())] if d.sum() > 0 else px[rs.randint(len(px))])
    cen = np.array(cen)
    for _ in range(14):
        lab = np.argmin(np.stack([np.linalg.norm(px - c, axis=1) for c in cen]), 0)
        for j in range(len(cen)):
            if (lab == j).any(): cen[j] = px[lab == j].mean(0)
    share = np.bincount(lab, minlength=len(cen)) / len(px)
    cl = sorted([(share[j], cen[j].tolist()) for j in range(len(cen)) if share[j] > 0.01], key=lambda x: -x[0]); merged = []
    for s, c in cl:                                    # merge near-identical clusters
        for m in merged:
            if dist(m[1], c) < 42: m[1] = [(m[1][i] * m[0] + c[i] * s) / (m[0] + s) for i in range(3)]; m[0] += s; break
        else: merged.append([s, c])
    merged.sort(key=lambda x: -x[0]); tot = sum(m[0] for m in merged); colors = [dict(hex=hexof(c), share=round(s / tot, 3)) for s, c in merged]
    chroma = [m for m in merged if sat(m[1]) > 0.28 and 40 < lum(m[1]) < 235]; derived = []
    pool = chroma or merged; primary = pool[0][1]
    rest = [m for m in pool[1:] if dist(m[1], primary) > 60]
    secondary = rest[0][1] if rest else None
    others = [m for m in merged if dist(m[1], primary) > 60 and (secondary is None or dist(m[1], secondary) > 40)]
    accent = max(others, key=lambda m: sat(m[1]) * (0.4 + m[0]))[1] if others and max(sat(m[1]) for m in others) > 0.25 else None
    if secondary is None: secondary = shade(primary, 0.55) if lum(primary) > 90 else mix(primary, [255, 255, 255], 0.55); derived.append("secondary")
    if accent is None: accent = mix(primary, [255, 255, 255], 0.35) if lum(primary) < 120 else shade(primary, 0.7); derived.append("accent")
    print(json.dumps(dict(width=W0, height=H0, aspect=round((bbox[2] - bbox[0]) / (bbox[3] - bbox[1]), 4), hasAlpha=bool(has_alpha), bbox=bbox, colors=colors[:6],
                          roles=dict(primary=hexof(primary), secondary=hexof(secondary), accent=hexof(accent)), derived=derived)))

if __name__ == "__main__":
    try: main()
    except SystemExit: raise
    except Exception as e: sys.exit(f"{type(e).__name__}: {str(e)[:160]}")
