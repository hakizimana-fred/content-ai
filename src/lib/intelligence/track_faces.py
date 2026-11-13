"""
Speaker-aware framing track for vertical crops. Local, open-source (OpenCV Haar cascades).

For a time range it samples frames, detects faces, scores which face is SPEAKING from motion in the
mouth region, and emits smoothed keyframes of the horizontal centre (0..1 of frame width) the 9:16
crop window should follow. Prints one JSON object on stdout.

Honest limits: frontal faces only; "speaking" = mouth-region motion (can be fooled by head movement);
does not identify people across cuts.
"""
import argparse, json, subprocess, sys
import cv2
import numpy as np

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--start", type=float, required=True)
    ap.add_argument("--end", type=float, required=True)
    ap.add_argument("--rate", type=float, default=3.0, help="samples per second")
    a = ap.parse_args()

    # Decode with the system FFmpeg (handles AV1/VP9/HEVC that OpenCV's bundled decoder cannot) and
    # only the requested range: raw grayscale frames at `rate` per second, piped in.
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                            "-of", "csv=p=0:s=x", a.input], capture_output=True, text=True)
    try:
        W0, H0 = [int(v) for v in probe.stdout.strip().split("x")]
    except Exception:
        print(json.dumps({"error": "Could not read video dimensions"})); sys.exit(2)
    fw = 640 if W0 > 640 else W0
    fh = max(2, int(round(fw * H0 / W0 / 2)) * 2)
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    if cascade.empty():
        print(json.dumps({"error": "Face model not found"})); sys.exit(2)

    ff = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-ss", str(a.start), "-t", str(a.end - a.start), "-i", a.input, "-an",
         "-vf", f"fps={a.rate},scale={fw}:{fh},format=gray", "-f", "rawvideo", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    frame_bytes = fw * fh

    prev_gray = None
    tracks = []   # {x, motion(EMA), hits}
    active = None
    pending, pending_n = None, 0
    out, cx, max_faces = [], 0.5, 0
    idx = 0

    while True:
        buf = ff.stdout.read(frame_bytes)
        if len(buf) < frame_bytes:
            break
        t = a.start + idx / a.rate
        gray = np.frombuffer(buf, dtype=np.uint8).reshape(fh, fw)
        faces = cascade.detectMultiScale(gray, 1.15, 5, minSize=(max(24, int(fw * 0.035)),) * 2)
        max_faces = max(max_faces, len(faces))
        for (x, y, w, h) in faces:
            fx = (x + w / 2) / fw
            motion = 0.0
            if prev_gray is not None:
                my0, my1 = y + int(h * 0.55), y + h   # mouth region = lower part of the face box
                motion = float(cv2.absdiff(gray[my0:my1, x:x + w], prev_gray[my0:my1, x:x + w]).mean())
            tr = min(tracks, key=lambda k: abs(k["x"] - fx), default=None)
            if tr is None or abs(tr["x"] - fx) > 0.12:
                tr = {"x": fx, "motion": 0.0, "hits": 0}
                tracks.append(tr)
            tr["x"] = 0.6 * tr["x"] + 0.4 * fx
            tr["motion"] = 0.7 * tr["motion"] + 0.3 * motion
            tr["hits"] += 1
            tr["seen"] = idx
        prev_gray = gray

        live = [k for k in tracks if k.get("seen") == idx]
        if live:
            best = max(live, key=lambda k: k["motion"])
            if active is None or active not in live:
                active = best
            elif best is not active and best["motion"] > 1.4 * max(active["motion"], 0.5):
                # switch speaker only after ~1s of consistent evidence (hysteresis)
                if pending is best:
                    pending_n += 1
                else:
                    pending, pending_n = best, 1
                if pending_n >= max(2, int(a.rate)):
                    active, pending, pending_n = best, None, 0
            else:
                pending, pending_n = None, 0
            target = active["x"]
            if abs(target - cx) > 0.03:   # deadband: ignore tiny movements
                cx = cx + 0.35 * (target - cx)
        out.append({"t": round(t, 2), "x": round(cx, 4)})
        idx += 1

    ff.stdout.close()
    ff.wait()
    people = len([k for k in tracks if k["hits"] >= 3])
    print(json.dumps({"keyframes": out, "faces": max(people, 1 if out and max_faces else 0), "maxSimultaneous": max_faces, "frames": len(out)}))

if __name__ == "__main__":
    main()
