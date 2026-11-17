"""Frame sampling for the automated QC. stdin: {"file": path, "times": [seconds...]} -> stdout: {"samples":[{"t","ok","mean","std"}], "w","h","frames"}"""
import json, sys
import cv2
import numpy as np

def main():
    job = json.loads(sys.stdin.read()); cap = cv2.VideoCapture(job["file"]); out = []
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)); h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)); n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    for t in job["times"]:
        cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, t) * 1000.0); ok, fr = cap.read()
        if not ok or fr is None: out.append(dict(t=t, ok=False, mean=0, std=0)); continue
        g = cv2.cvtColor(cv2.resize(fr, (max(8, w // 8), max(8, h // 8))), cv2.COLOR_BGR2GRAY).astype(np.float32)
        out.append(dict(t=t, ok=True, mean=round(float(g.mean()), 2), std=round(float(g.std()), 2)))
    print(json.dumps(dict(samples=out, w=w, h=h, frames=n)))

if __name__ == "__main__":
    main()
