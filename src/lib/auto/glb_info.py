"""Validate a GLB model and render a preview still with the software 3D engine. stdin: {file, out?}  stdout: {faces, size, notes}"""
import json, sys, os
import numpy as np, cv2
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render3d as r3

def main():
    job = json.loads(sys.stdin.read()); m = r3.load_glb(job["file"])
    info = dict(faces=int(len(m.f)), vertices=int(len(m.v)), notes=list(getattr(m, "notes", [])), colours=int(len(np.unique(m.fcol.astype(np.int32), axis=0))) if m.fcol is not None else 1)
    if job.get("out"):
        W, H = 640, 640; bg = np.zeros((H, W, 3), np.uint8); bg[:] = (26, 24, 32)
        L = dict(dir=np.array([-0.5, 0.8, 0.6], np.float32), color=np.array([255, 240, 225], np.float32), intensity=1.0)
        lay, x0, y0 = r3.Renderer3D(W, H).render([(m, r3.rotm("y", 30), (0, 0, 0), 1.7)], r3.Camera((0, 0.5, 6.0), (0, 0, 0), 36), L, floor=-0.85)
        r3.composite(bg, lay, x0, y0); cv2.imwrite(job["out"], bg[..., ::-1])
    print(json.dumps(info))

if __name__ == "__main__":
    try: main()
    except Exception as e: sys.exit(f"{type(e).__name__}: {str(e)[:200]}")
