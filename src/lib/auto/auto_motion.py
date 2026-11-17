"""
Renders ONE photo as a short motion clip (sub-pixel Ken Burns / pan / subject focus / layered) with OpenCV, piped to ffmpeg.
Reads a JSON job on stdin: {image, out, w, h, fps, seconds, move, focus:{cx,cy,w,h}|null, layout:'fill'|'layered', seed}
All moves are eased (smoothstep). Windows are clamped to stay inside the image, so no black borders ever appear.
Lightweight on purpose: warpAffine on a pre-scaled image, no model, no GPU.
"""
import json, subprocess, sys
import cv2
import numpy as np

def ease(t):
    return t * t * (3 - 2 * t)

def window(iw, ih, aspect, z, cx, cy):
    """Largest window of the target aspect inside the image, shrunk by zoom z, centred at (cx,cy) px, clamped inside."""
    ww0 = min(iw, ih * aspect); wh0 = ww0 / aspect
    ww, wh = ww0 / z, wh0 / z
    cx = min(max(cx, ww / 2), iw - ww / 2); cy = min(max(cy, wh / 2), ih - wh / 2)
    return cx, cy, ww, wh

def plan_move(move, iw, ih, aspect, focus):
    fcx = (focus["cx"] if focus else 0.5) * iw; fcy = (focus["cy"] if focus else 0.5) * ih
    ww0 = min(iw, ih * aspect); wh0 = ww0 / aspect
    slack_x = iw - ww0; slack_y = ih - wh0                   # how far the window can slide at z=1
    cx0, cy0 = iw / 2, ih / 2
    if move == "zoom_in":   return (1.0, fcx * 0.6 + cx0 * 0.4, fcy * 0.6 + cy0 * 0.4), (1.2, fcx, fcy)
    if move == "zoom_out":  return (1.2, fcx, fcy), (1.0, fcx * 0.6 + cx0 * 0.4, fcy * 0.6 + cy0 * 0.4)
    if move == "ken_burns": return (1.02, cx0 - (fcx - cx0) * 0.2, cy0 - (fcy - cy0) * 0.2), (1.2, fcx, fcy)
    if move == "subject_focus":
        zs = 1.0 / max(0.3, min(1.0, (focus["w"] if focus else 0.6) * 1.15 * iw / ww0)) if focus else 1.4
        return (1.0, cx0, cy0), (min(1.9, max(1.15, zs)), fcx, fcy)
    z = 1.14
    if move in ("pan_left", "pan_right"):
        span = max(slack_x, ww0 * (1 - 1 / z)) * 0.8; a, b = cx0 - span / 2, cx0 + span / 2
        return ((z, b, cy0), (z, a, cy0)) if move == "pan_left" else ((z, a, cy0), (z, b, cy0))
    if move in ("pan_up", "pan_down"):
        span = max(slack_y, wh0 * (1 - 1 / z)) * 0.8; a, b = cy0 - span / 2, cy0 + span / 2
        return ((z, cx0, b), (z, cx0, a)) if move == "pan_up" else ((z, cx0, a), (z, cx0, b))
    return (1.0, cx0, cy0), (1.12, fcx, fcy)

def main():
    job = json.loads(sys.stdin.read())
    img = cv2.imread(job["image"], cv2.IMREAD_COLOR)
    if img is None:
        print("unreadable image", file=sys.stderr); sys.exit(2)
    W, H, fps = int(job["w"]), int(job["h"]), int(job["fps"])
    n = max(2, int(round(job["seconds"] * fps)))
    aspect = W / H; layered = job.get("layout") == "layered"; focus = job.get("focus")
    ih0, iw0 = img.shape[:2]

    if layered:
        # background: cover-fill, heavily blurred, slow counter-drift; foreground: whole photo fitted inside the canvas, gentle push-in.
        bg_src = cv2.GaussianBlur(cv2.resize(img, (max(2, iw0 // 8), max(2, ih0 // 8)), interpolation=cv2.INTER_AREA), (0, 0), 6)
        bg_src = cv2.resize(bg_src, (iw0, ih0), interpolation=cv2.INTER_LINEAR)
        fit = min(W * 0.94 / iw0, H * 0.94 / ih0)
        fg = cv2.resize(img, (max(2, int(iw0 * fit * 1.1)), max(2, int(ih0 * fit * 1.1))), interpolation=cv2.INTER_AREA)
        pad = 40  # room around the photo for its soft shadow
        a_fg = np.zeros((fg.shape[0] + 2 * pad, fg.shape[1] + 2 * pad), np.float32); a_fg[pad:-pad, pad:-pad] = 1.0
        a_sh = cv2.GaussianBlur(a_fg, (0, 0), 14) * 0.38
        rgb = cv2.copyMakeBorder(fg, pad, pad, pad, pad, cv2.BORDER_REPLICATE).astype(np.float32)
        # ONE premultiplied RGBA layer = photo over its own shadow; composited per frame with a single warp + multiply-add
        alpha_tot = a_fg + a_sh * (1 - a_fg)
        pm = np.dstack([rgb * a_fg[..., None], alpha_tot])
        fga = np.clip(pm * 255 * np.array([1, 1, 1, 1], np.float32) / np.array([255, 255, 255, 1], np.float32), 0, 255).astype(np.uint8)
        fga[..., 3] = np.clip(alpha_tot * 255, 0, 255).astype(np.uint8)
        bg_src = (bg_src.astype(np.float32) * 0.8).astype(np.uint8)
        bgw = (1.0, iw0 / 2, ih0 / 2), (1.1, iw0 / 2, ih0 / 2)
        bg_scale = min(1.0, (H * 1.25) / max(1, min(ih0, iw0 / aspect)))
        bg_img = cv2.resize(bg_src, (max(2, int(iw0 * bg_scale)), max(2, int(ih0 * bg_scale))), interpolation=cv2.INTER_AREA)
        # background is smooth, so render it at quarter resolution once per frame and upscale (cheap)
        qw, qh = max(2, W // 4), max(2, H // 4)
    else:
        (z0, x0, y0), (z1, x1, y1) = plan_move(job["move"], iw0, ih0, aspect, focus)
        amp = float(job.get("amp", 1.0)); z0 = 1 + (z0 - 1) * amp; z1 = 1 + (z1 - 1) * amp   # motion intensity: subtle / medium / strong
        ww0 = min(iw0, ih0 * aspect); wh0 = ww0 / aspect
        pre = min(1.0, (H * 1.25) / wh0)                     # one-off downscale so per-frame resampling stays near 1:1
        src = cv2.resize(img, (max(2, int(iw0 * pre)), max(2, int(ih0 * pre))), interpolation=cv2.INTER_AREA) if pre < 1 else img
        k = src.shape[1] / iw0

    enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(fps), "-i", "-",
                            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "14", "-pix_fmt", "yuv420p", "-threads", "2", "-f", "mp4", job["out"]],
                           stdin=subprocess.PIPE)
    for i in range(n):
        t = ease(i / (n - 1))
        if layered:
            z = bgw[0][0] + (bgw[1][0] - bgw[0][0]) * t
            cx, cy, ww, wh = window(bg_img.shape[1], bg_img.shape[0], aspect, z, bg_img.shape[1] / 2 + (t - 0.5) * 24, bg_img.shape[0] / 2)
            s = qw / ww
            q = cv2.warpAffine(bg_img, np.float32([[s, 0, -(cx - ww / 2) * s], [0, s, -(cy - wh / 2) * s]]), (qw, qh), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
            bg = cv2.resize(q, (W, H), interpolation=cv2.INTER_LINEAR)
            sc = (1.0 + 0.06 * t) / 1.1
            fh_, fw_ = fga.shape[:2]
            M = np.float32([[sc, 0, W / 2 - fw_ * sc / 2 + (0.5 - t) * 10], [0, sc, H / 2 - fh_ * sc / 2]])
            layer = cv2.warpAffine(fga, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
            inv = 255 - layer[..., 3]
            frame = cv2.add(layer[..., :3], cv2.multiply(bg, cv2.merge([inv, inv, inv]), scale=1 / 255.0))
        else:
            z = z0 + (z1 - z0) * t; cx = x0 + (x1 - x0) * t; cy = y0 + (y1 - y0) * t
            cx, cy, ww, wh = window(iw0, ih0, aspect, z, cx, cy)
            s = W / (ww * k)
            M = np.float32([[s, 0, -(cx - ww / 2) * k * s], [0, s, -(cy - wh / 2) * k * s]])
            frame = cv2.warpAffine(src, M, (W, H), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
        enc.stdin.write(frame.tobytes())
    enc.stdin.close(); rc = enc.wait()
    sys.exit(rc)

if __name__ == "__main__":
    main()
