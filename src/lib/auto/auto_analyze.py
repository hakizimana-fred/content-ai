"""
Local, classical media analysis for AUTO STUDIO (OpenCV + numpy only; no neural network, no network access).

  image  --input F --out NORMALISED.jpg [--maxside 2560]
      Applies EXIF orientation, writes a size-limited JPEG, prints JSON: size, sharpness, exposure, contrast, mean colour,
      64-bit difference hash, frontal faces, a salient-subject box (spectral-residual saliency), composition score.
  video  --input F [--rate 4] [--start S --end E]
      Samples frames and prints per-sample JSON: sharpness, brightness, motion (frame difference), largest face box and
      a mouth-region motion score. Used to rank scenes and find likely speakers.

Honest limits: Haar cascades find frontal faces only; "mouth motion" is a heuristic (head movement can fool it);
saliency is a contrast heuristic, not object recognition.
"""
import argparse, json, subprocess, sys
import cv2
import numpy as np

CASCADE = None
def cascade():
    global CASCADE
    if CASCADE is None:
        CASCADE = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    return CASCADE

def faces_of(gray):
    h, w = gray.shape[:2]
    if cascade().empty():
        return []
    minsz = max(24, int(min(h, w) * 0.07))
    f = cascade().detectMultiScale(gray, scaleFactor=1.12, minNeighbors=5, minSize=(minsz, minsz))
    return [[float(x) / w, float(y) / h, float(fw) / w, float(fh) / h] for (x, y, fw, fh) in f]

def sharpness(gray):
    g = cv2.resize(gray, (640, int(640 * gray.shape[0] / gray.shape[1]))) if gray.shape[1] > 640 else gray
    return float(cv2.Laplacian(g, cv2.CV_64F).var())

def dhash(gray):
    s = cv2.resize(gray, (9, 8), interpolation=cv2.INTER_AREA)
    bits = (s[:, 1:] > s[:, :-1]).flatten()
    v = 0
    for b in bits:
        v = (v << 1) | int(b)
    return format(v, "016x")

def saliency_box(bgr):
    """Spectral-residual saliency (Hou & Zhang 2007) -> box around the most salient region, normalised."""
    small = cv2.resize(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY), (128, int(128 * bgr.shape[0] / bgr.shape[1]) or 1)).astype(np.float32)
    fft = np.fft.fft2(small)
    log_amp = np.log(np.abs(fft) + 1e-8)
    phase = np.angle(fft)
    resid = log_amp - cv2.blur(log_amp, (3, 3))
    sal = np.abs(np.fft.ifft2(np.exp(resid + 1j * phase))) ** 2
    sal = cv2.GaussianBlur(sal.astype(np.float32), (0, 0), 3)
    sal = (sal - sal.min()) / (sal.max() - sal.min() + 1e-8)
    # centre prior: photographers tend to put subjects away from the very edges
    hh, ww = sal.shape
    yy, xx = np.mgrid[0:hh, 0:ww]
    prior = 1.0 - 0.35 * (((xx - ww / 2) / (ww / 2)) ** 2 + ((yy - hh / 2) / (hh / 2)) ** 2) / 2
    sal = sal * prior
    thr = max(sal.mean() + 1.0 * sal.std(), 0.35)
    mask = (sal >= thr).astype(np.uint8)
    n, lab, stats, cent = cv2.connectedComponentsWithStats(mask, 8)
    if n <= 1:
        return {"cx": 0.5, "cy": 0.5, "w": 0.5, "h": 0.5, "confidence": 0.0}
    # weight components by total saliency mass; merge those with at least 40% of the best
    mass = [float(sal[lab == i].sum()) for i in range(1, n)]
    best = max(mass)
    keep = [i + 1 for i, m in enumerate(mass) if m >= 0.4 * best]
    ys, xs = np.where(np.isin(lab, keep))
    x0, x1, y0, y1 = xs.min() / ww, (xs.max() + 1) / ww, ys.min() / hh, (ys.max() + 1) / hh
    conf = float(min(1.0, best / (sal.sum() + 1e-8) * 2.5))
    return {"cx": float((x0 + x1) / 2), "cy": float((y0 + y1) / 2), "w": float(x1 - x0), "h": float(y1 - y0), "confidence": conf}

def cmd_image(a):
    img = cv2.imread(a.input, cv2.IMREAD_COLOR)  # honours EXIF orientation
    if img is None:
        print(json.dumps({"error": "unreadable image"})); sys.exit(2)
    h, w = img.shape[:2]
    if max(h, w) > a.maxside:
        s = a.maxside / max(h, w)
        img = cv2.resize(img, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
        h, w = img.shape[:2]
    cv2.imwrite(a.out, img, [cv2.IMWRITE_JPEG_QUALITY, 93])
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    faces = faces_of(cv2.resize(gray, (800, int(800 * h / w))) if w > 800 else gray)
    sub = saliency_box(img)
    if faces:
        big = max(faces, key=lambda f: f[2] * f[3])
        pad = 1.0  # include some context around a face
        fx, fy, fw, fh = big
        sub = {"cx": fx + fw / 2, "cy": fy + fh / 2 + fh * 0.35, "w": min(1.0, fw * (1 + pad * 2)), "h": min(1.0, fh * (1 + pad * 2.4)), "confidence": 0.9, "source": "face"}
    else:
        sub["source"] = "saliency"
    mean_bgr = img.reshape(-1, 3).mean(axis=0)
    bright = float(gray.mean()); contrast = float(gray.std())
    # thirds: how close the subject centre is to a power point (0..1, 1 = on one)
    pts = [(1/3, 1/3), (2/3, 1/3), (1/3, 2/3), (2/3, 2/3)]
    d = min(((sub["cx"] - px) ** 2 + (sub["cy"] - py) ** 2) ** 0.5 for px, py in pts)
    print(json.dumps({
        "width": w, "height": h, "sharpness": sharpness(gray), "brightness": bright, "contrast": contrast,
        "color": [float(mean_bgr[2]), float(mean_bgr[1]), float(mean_bgr[0])], "hash": dhash(gray),
        "faces": faces, "subject": sub, "thirds": float(max(0.0, 1 - d / 0.5)),
    }))

def cmd_video(a):
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                            "-of", "csv=p=0:s=x", a.input], capture_output=True, text=True)
    try:
        W0, H0 = [int(v) for v in probe.stdout.strip().split("x")]
    except Exception:
        print(json.dumps({"error": "could not read video size"})); sys.exit(2)
    fw = 480 if W0 > 480 else W0
    fh = max(2, int(round(fw * H0 / W0 / 2)) * 2)
    cmd = ["ffmpeg", "-v", "error"]
    if a.start is not None: cmd += ["-ss", str(a.start)]
    if a.end is not None and a.start is not None: cmd += ["-t", str(a.end - a.start)]
    cmd += ["-i", a.input, "-an", "-vf", f"fps={a.rate},scale={fw}:{fh},format=gray", "-f", "rawvideo", "-"]
    ff = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    size = fw * fh
    out = []; prev = None; i = 0
    while True:
        buf = ff.stdout.read(size)
        if len(buf) < size:
            break
        g = np.frombuffer(buf, np.uint8).reshape(fh, fw)
        t = (a.start or 0.0) + i / a.rate
        s = {"t": round(t, 3), "sharp": sharpness(g), "bright": float(g.mean()),
             "motion": float(np.abs(g.astype(np.int16) - prev.astype(np.int16)).mean()) if prev is not None else 0.0,
             "face": None, "mouth": 0.0}
        fs = faces_of(g)
        if fs:
            fx, fy, fww, fhh = max(fs, key=lambda f: f[2] * f[3])
            s["face"] = [fx, fy, fww, fhh]
            if prev is not None:
                x0, x1 = int((fx + fww * 0.2) * fw), int((fx + fww * 0.8) * fw)
                y0, y1 = int((fy + fhh * 0.62) * fh), int((fy + fhh * 0.95) * fh)
                if x1 > x0 + 2 and y1 > y0 + 2:
                    s["mouth"] = float(np.abs(g[y0:y1, x0:x1].astype(np.int16) - prev[y0:y1, x0:x1].astype(np.int16)).mean())
        out.append(s); prev = g; i += 1
    ff.wait()
    print(json.dumps({"samples": out, "rate": a.rate}))

def main():
    ap = argparse.ArgumentParser(); sp = ap.add_subparsers(dest="cmd", required=True)
    i = sp.add_parser("image"); i.add_argument("--input", required=True); i.add_argument("--out", required=True); i.add_argument("--maxside", type=int, default=2560)
    v = sp.add_parser("video"); v.add_argument("--input", required=True); v.add_argument("--rate", type=float, default=4.0)
    v.add_argument("--start", type=float); v.add_argument("--end", type=float)
    a = ap.parse_args()
    {"image": cmd_image, "video": cmd_video}[a.cmd](a)

if __name__ == "__main__":
    main()
