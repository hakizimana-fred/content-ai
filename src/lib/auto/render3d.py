"""
Software 3D engine (NumPy + OpenCV, CPU only, no GL).

This is GENUINE 3D: triangle meshes in world space, a perspective camera with look-at, back-face culling, depth sorting,
per-face lighting (key light, ambient, specular, studio-environment reflection, rim light), planar shadows and mirror reflections,
textured quads by homography, and 3D particles. It is a painter's-algorithm rasteriser: correct for convex/separated objects,
not a z-buffer (intersecting meshes can show sorting artefacts) and without textures on meshes or global illumination.
Nothing here is a 2D effect dressed up as 3D; 2.5D (parallax of flat layers) lives in scene_render.py and is labelled as such.
"""
import json, math, os, struct
import numpy as np
import cv2


def hexrgb(h):
    h = h.lstrip("#")
    if len(h) == 3: h = "".join(c * 2 for c in h)
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], np.float32)


class Mesh:
    def __init__(self, v, f, color=(200, 200, 200), flat=False, metal=0.0, gloss=0.5, emissive=0.0, fcol=None):
        self.v = np.asarray(v, np.float32); self.f = np.asarray(f, np.int32); self.color = np.array(color, np.float32)
        self.flat = flat; self.metal = metal; self.gloss = gloss; self.emissive = emissive
        self.fcol = None if fcol is None else np.asarray(fcol, np.float32)       # optional per-face colour (GLB materials)
        self.alpha = 1.0; self.pairs = False                 # pairs: faces come as quad halves; shade each quad once (removes diagonal saw-tooth)

    def normals(self, R=None):
        v = self.v if R is None else self.v @ R.T
        a, b, c = v[self.f[:, 0]], v[self.f[:, 1]], v[self.f[:, 2]]
        fn = np.cross(b - a, c - a); area = np.linalg.norm(fn, axis=1, keepdims=True) + 1e-9
        if self.flat: return fn / area, v
        vn = np.zeros_like(v);
        for k in range(3): np.add.at(vn, self.f[:, k], fn)
        vn /= (np.linalg.norm(vn, axis=1, keepdims=True) + 1e-9)
        n = vn[self.f].mean(axis=1); return n / (np.linalg.norm(n, axis=1, keepdims=True) + 1e-9), v


# ----------------------------------------------------------------------------- primitives
def uv_grid(nu, nv, fn):
    """fn(u in [0,1], v in [0,1]) -> (x,y,z); returns (verts, faces) for a nu x nv grid, wrapping in u."""
    us = np.linspace(0, 1, nu, endpoint=False); vs = np.linspace(0, 1, nv)
    U, V = np.meshgrid(us, vs); P = np.stack(fn(U, V), -1).reshape(-1, 3)
    idx = lambda i, j: j * nu + (i % nu); F = []
    for j in range(nv - 1):
        for i in range(nu): F += [[idx(i, j), idx(i + 1, j), idx(i + 1, j + 1)], [idx(i, j), idx(i + 1, j + 1), idx(i, j + 1)]]
    return P, np.array(F)


def quads(m):
    m.pairs = True; return m


def sphere(r=1.0, nu=40, nv=24, **kw):
    v, f = uv_grid(nu, nv, lambda U, V: (r * np.sin(np.pi * V) * np.cos(2 * np.pi * U), r * np.cos(np.pi * V), r * np.sin(np.pi * V) * np.sin(2 * np.pi * U))); return quads(Mesh(v, f, **kw))

def torus(R=1.0, r=0.35, nu=48, nv=20, **kw):
    v, f = uv_grid(nu, nv, lambda U, V: ((R + r * np.cos(2 * np.pi * V)) * np.cos(2 * np.pi * U), r * np.sin(2 * np.pi * V), (R + r * np.cos(2 * np.pi * V)) * np.sin(2 * np.pi * U))); return quads(Mesh(v, f, **kw))

def torus_knot(p=2, q=3, R=1.0, r=0.28, nu=160, nv=14, **kw):
    def fn(U, V):
        t = 2 * np.pi * U; rr = R * (2 + np.cos(q * t)) / 3; c = np.stack([rr * np.cos(p * t), rr * np.sin(p * t), R * 0.5 * np.sin(q * t)], -1)
        t2 = t + 1e-3; rr2 = R * (2 + np.cos(q * t2)) / 3; c2 = np.stack([rr2 * np.cos(p * t2), rr2 * np.sin(p * t2), R * 0.5 * np.sin(q * t2)], -1)
        T = c2 - c; T /= np.linalg.norm(T, axis=-1, keepdims=True); Nn = np.cross(T, np.array([0, 0, 1.0])); Nn /= np.linalg.norm(Nn, axis=-1, keepdims=True) + 1e-9; B = np.cross(T, Nn)
        a = 2 * np.pi * V; P = c + r * (np.cos(a)[..., None] * Nn + np.sin(a)[..., None] * B); return P[..., 0], P[..., 1], P[..., 2]
    v, f = uv_grid(nu, nv, fn); m = quads(Mesh(v, f, **kw))
    t = 2 * np.pi * np.linspace(0, 1, nu, endpoint=False); rr = R * (2 + np.cos(q * t)) / 3; cl = np.stack([rr * np.cos(p * t), rr * np.sin(p * t), R * 0.5 * np.sin(q * t)], -1)
    return orient(m, np.tile(cl, (nv, 1)))

def orient(m, centers):
    """Flip winding so face normals point away from `centers` (per-vertex interior point, e.g. a tube's centre line)."""
    a, b, c = m.v[m.f[:, 0]], m.v[m.f[:, 1]], m.v[m.f[:, 2]]; fn = np.cross(b - a, c - a); cen = (a + b + c) / 3; ctr = centers[m.f].mean(1)
    if np.sum(np.sum(fn * (cen - ctr), 1) > 0) < len(m.f) / 2: m.f = m.f[:, [0, 2, 1]]
    return m

def revolve(profile, n=56, **kw):
    """Surface of revolution about the Y axis. profile = [(radius, y), ...] bottom to top. Used for bottles, cans, vases, coins."""
    pr = np.array(profile, np.float32); nv = len(pr)
    th = np.linspace(0, 2 * np.pi, n, endpoint=False); X = pr[:, 0][:, None] * np.cos(th)[None]; Z = pr[:, 0][:, None] * np.sin(th)[None]; Y = np.repeat(pr[:, 1][:, None], n, 1)
    v = np.stack([X, Y, Z], -1).reshape(-1, 3); F = []
    for j in range(nv - 1):
        for i in range(n):
            a, b, c, d = j * n + i, j * n + (i + 1) % n, (j + 1) * n + (i + 1) % n, (j + 1) * n + i; F += [[a, c, b], [a, d, c]]
    return quads(Mesh(v, np.array(F), **kw))

def smooth_profile(pts, per=8, maxlen=0.16):
    p = np.array(pts, np.float32); out = []
    for i in range(len(p) - 1):
        per_i = max(per, int(np.linalg.norm(p[i + 1] - p[i]) / maxlen) + 1)
        for t in np.linspace(0, 1, per_i, endpoint=False):
            s = t * t * (3 - 2 * t); out.append(p[i] * (1 - s) + p[i + 1] * s)
    out.append(p[-1]); return np.array(out)

def box(w=1, h=1, d=1, **kw):
    x, y, z = w / 2, h / 2, d / 2
    v = np.array([[-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z], [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]], np.float32)
    f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [2, 3, 7], [2, 7, 6], [1, 2, 6], [1, 6, 5], [0, 4, 7], [0, 7, 3]]
    kw.setdefault("flat", True); return Mesh(v, f, **kw)

def rbox(w, h, d, r, seg=6, **kw):
    """Rounded box (phone body): a box with spherical-ish corners made from a superellipsoid."""
    def fn(U, V):
        th = 2 * np.pi * U; ph = np.pi * V; e = 0.22
        sx = np.sign(np.cos(th)) * np.abs(np.cos(th)) ** e; sz = np.sign(np.sin(th)) * np.abs(np.sin(th)) ** e; sy = np.sign(np.cos(ph)) * np.abs(np.cos(ph)) ** e; s = np.abs(np.sin(ph)) ** e
        return (w / 2 * s * sx, h / 2 * sy, d / 2 * s * sz)
    v, f = uv_grid(64, 40, fn); return quads(Mesh(v, f, **kw))

def cylinder(r=0.5, h=1.0, n=40, rings=1, **kw):
    """Smooth side + two flat fan caps (separate vertices, so cap normals are exactly +/-Y and never blend with the side)."""
    side = revolve([(r, -h / 2), (r, h / 2)], n, **kw); th = np.linspace(0, 2 * np.pi, n, endpoint=False); ring = np.stack([r * np.cos(th), np.zeros(n), r * np.sin(th)], 1).astype(np.float32); parts = [side]
    for sgn in (1, -1):
        v = np.concatenate([[[0, sgn * h / 2, 0]], ring + np.array([0, sgn * h / 2, 0], np.float32)]).astype(np.float32)
        f = np.array([[0, 1 + i, 1 + (i + 1) % n] for i in range(n)]); a, b_, c = v[f[:, 0]], v[f[:, 1]], v[f[:, 2]]
        if np.sum(np.cross(b_ - a, c - a)[:, 1] * sgn < 0) > n / 2: f = f[:, [0, 2, 1]]
        parts.append(Mesh(v, f, **kw))
    m = merge(parts); m.metal, m.gloss, m.emissive = side.metal, side.gloss, side.emissive; m.pairs = False; return m


def gem(r=1.0, **kw):
    t = (1 + 5 ** 0.5) / 2; v = np.array([[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]], np.float32)
    v = v / np.linalg.norm(v[0]) * r; f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]]
    v[:, 1] *= 1.25; kw.setdefault("flat", True); return Mesh(v, f, **kw)

def merge(meshes):
    """Combine meshes (each with its own colour) into one with per-face colours."""
    vs, fs, cs, off = [], [], [], 0
    for m in meshes: vs.append(m.v); fs.append(m.f + off); cs.append(np.tile(m.color, (len(m.f), 1)) if m.fcol is None else m.fcol); off += len(m.v)
    m0 = meshes[0]; return Mesh(np.concatenate(vs), np.concatenate(fs), m0.color, m0.flat, m0.metal, m0.gloss, m0.emissive, np.concatenate(cs))

def translate(m, t): m.v = m.v + np.array(t, np.float32); return m

def terrain(size=14.0, n=70, seed=3, height=1.6, **kw):
    rs = np.random.RandomState(seed); xs = np.linspace(-size / 2, size / 2, n); zs = np.linspace(4.0, -size * 1.6, n * 2)
    X, Z = np.meshgrid(xs, zs); Hh = np.zeros_like(X)
    for k in range(5): a = 0.35 * 2 ** k; Hh += (height / (1.9 ** k)) * np.sin(X * a + rs.rand() * 6) * np.cos(Z * a * 0.8 + rs.rand() * 6)
    ridge = np.exp(-(X / (size * 0.26)) ** 2); Hh = Hh * (0.35 + 1.6 * (1 - ridge)) + 1.4 * np.maximum(0, (np.abs(X) / (size * 0.5))) ** 2 * 2.0
    v = np.stack([X, Hh, Z], -1).reshape(-1, 3); F = []; nx = n
    for j in range(len(zs) - 1):
        for i in range(nx - 1): a = j * nx + i; F += [[a, a + 1, a + nx], [a + 1, a + nx + 1, a + nx]]       # wound so normals point up
    return Mesh(v, np.array(F), flat=True, **kw)


# ----------------------------------------------------------------------------- extrusion (3D text and logos)
def extrude_mask(mask, depth=0.3, height=1.0, spacing=9.0, **kw):
    """Turn a binary image (text or logo, white = solid) into a real extruded mesh: Delaunay-triangulated front/back faces + side walls."""
    m = (mask > 127).astype(np.uint8) * 255; h, w = m.shape
    m = ((cv2.GaussianBlur(m, (0, 0), max(1.5, h / 90.0)) > 127).astype(np.uint8)) * 255          # smooth the pixel staircase so wall facets are near-parallel
    cnts, _ = cv2.findContours(m, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    loops = []
    for c in cnts:
        if len(c) < 8: continue
        ap = cv2.approxPolyDP(c, max(1.2, h / 160.0), True)[:, 0, :].astype(np.float32); pts = []
        for i in range(len(ap)):
            a, b = ap[i], ap[(i + 1) % len(ap)]; n = max(1, int(np.linalg.norm(b - a) / spacing))
            for t in range(n): pts.append(a + (b - a) * (t / n))
        if len(pts) >= 6: loops.append(np.array(pts, np.float32))
    if not loops: raise ValueError("no outline found in the image")
    allp = np.concatenate(loops); sc = height / h
    sub = cv2.Subdiv2D((-2, -2, w + 4, h + 4))
    for p in allp: sub.insert((float(np.clip(p[0], 0, w)), float(np.clip(p[1], 0, h))))
    mt = cv2.dilate(m, np.ones((3, 3), np.uint8)); tris = []
    for t in sub.getTriangleList().reshape(-1, 3, 2):
        if (t < -1).any() or (t[:, 0] > w + 1).any() or (t[:, 1] > h + 1).any(): continue
        c0 = t.mean(0); pts = [c0] + [c0 + 0.5 * (t[k] - c0) for k in range(3)]            # interior probes, kept away from the (approximated) boundary
        if all(mt[int(np.clip(p[1], 0, h - 1)), int(np.clip(p[0], 0, w - 1))] > 127 for p in pts): tris.append(t)
    if not tris: raise ValueError("could not triangulate the outline")
    T = np.array(tris, np.float32); cx, cy = w / 2, h / 2; z = depth / 2
    def P(xy, zz): return [(xy[0] - cx) * sc, -(xy[1] - cy) * sc, zz]
    V, F, WANT = [], [], []
    for t in T:                                       # front (+z) and back (-z) caps
        a = np.cross(np.append(t[1] - t[0], 0), np.append(t[2] - t[0], 0))[2]; q = t if a < 0 else t[[0, 2, 1]]       # image-space winding -> world +z facing
        b = len(V); V += [P(q[0], z), P(q[1], z), P(q[2], z)]; F.append([b, b + 1, b + 2]); WANT.append([0, 0, 1])
        b = len(V); V += [P(q[0], -z), P(q[2], -z), P(q[1], -z)]; F.append([b, b + 1, b + 2]); WANT.append([0, 0, -1])
    for lp in loops:                                  # side walls; outward normal tested against the mask
        for i in range(len(lp)):
            a, b2 = lp[i], lp[(i + 1) % len(lp)]; e = b2 - a; nrm = np.array([e[1], -e[0]]); nl = np.linalg.norm(nrm)
            if nl < 1e-6: continue
            nrm /= nl; mid = (a + b2) / 2; probe = mid + nrm * 2.0
            inside = m[int(np.clip(probe[1], 0, h - 1)), int(np.clip(probe[0], 0, w - 1))] > 127
            p0, p1 = (a, b2) if not inside else (b2, a)
            bi = len(V); V += [P(p0, z), P(p1, z), P(p1, -z), P(p0, -z)]; F += [[bi, bi + 2, bi + 1], [bi, bi + 3, bi + 2]]; out_n = -nrm if inside else nrm; WANT += [[out_n[0], -out_n[1], 0]] * 2
    mm = Mesh(np.array(V, np.float32), np.array(F), flat=True, **kw)
    # orient every face outward: caps along +/-z, walls along the 2D outward normal recorded when they were built
    want = np.array(WANT, np.float32); a_, b_, c_ = mm.v[mm.f[:, 0]], mm.v[mm.f[:, 1]], mm.v[mm.f[:, 2]]; fn = np.cross(b_ - a_, c_ - a_)
    flip = np.sum(fn * want, 1) < 0; mm.f[flip] = mm.f[flip][:, [0, 2, 1]]
    return mm


def text_mask(text, font_path, px=320, pad=20):
    from PIL import Image, ImageDraw, ImageFont
    f = ImageFont.truetype(font_path, px); l, t, r, b = f.getbbox(text); im = Image.new("L", (r - l + 2 * pad, b - t + 2 * pad), 0)
    ImageDraw.Draw(im).text((pad - l, pad - t), text, font=f, fill=255); return np.asarray(im)


# ----------------------------------------------------------------------------- glTF binary loader (GLB only)
_CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
_NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}

def load_glb(path, max_faces=30000):
    """Minimal GLB reader: positions, indices, normals-by-computation, node transforms, base colour factors. Textures are NOT rendered."""
    with open(path, "rb") as fh: data = fh.read()
    if len(data) < 20 or data[:4] != b"glTF": raise ValueError("not a GLB file")
    ver, total = struct.unpack("<II", data[4:12])
    if ver != 2: raise ValueError(f"unsupported glTF version {ver}")
    off, js, bin_ = 12, None, b""
    while off + 8 <= len(data):
        ln, ty = struct.unpack("<II", data[off:off + 8]); ch = data[off + 8: off + 8 + ln]; off += 8 + ln
        if ty == 0x4E4F534A: js = json.loads(ch.decode("utf8"))
        elif ty == 0x004E4942: bin_ = ch
    if js is None: raise ValueError("GLB has no JSON chunk")
    def acc(i):
        a = js["accessors"][i]; bv = js["bufferViews"][a["bufferView"]]; nc = _NC[a["type"]]; dt = np.dtype(_CT[a["componentType"]])
        st = bv.get("byteStride") or nc * dt.itemsize; base = bv.get("byteOffset", 0) + a.get("byteOffset", 0); n = a["count"]
        if st == nc * dt.itemsize: arr = np.frombuffer(bin_, dt, n * nc, base).reshape(n, nc)
        else: arr = np.stack([np.frombuffer(bin_, dt, nc, base + k * st) for k in range(n)])
        return arr.astype(np.float32 if dt.kind == "f" else np.int64)
    def nodemat(nd):
        if "matrix" in nd: return np.array(nd["matrix"], np.float32).reshape(4, 4).T
        T = np.eye(4, dtype=np.float32); S = np.eye(4, dtype=np.float32); R = np.eye(4, dtype=np.float32)
        T[:3, 3] = nd.get("translation", [0, 0, 0]); S[0, 0], S[1, 1], S[2, 2] = nd.get("scale", [1, 1, 1])
        x, y, z, w = nd.get("rotation", [0, 0, 0, 1])
        R[:3, :3] = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
        return T @ R @ S
    V, F, C = [], [], []; notes = []
    def visit(ni, parent):
        nd = js["nodes"][ni]; M = parent @ nodemat(nd)
        if "mesh" in nd:
            for pr in js["meshes"][nd["mesh"]]["primitives"]:
                if pr.get("mode", 4) != 4: continue
                p = acc(pr["attributes"]["POSITION"]); idx = acc(pr["indices"])[:, 0] if "indices" in pr else np.arange(len(p))
                p4 = np.c_[p, np.ones(len(p), np.float32)] @ M.T; base = sum(len(x) for x in V); V.append(p4[:, :3]); f = idx.reshape(-1, 3) + base; F.append(f)
                col = [200, 200, 200]
                if "material" in pr:
                    mt = js["materials"][pr["material"]].get("pbrMetallicRoughness", {}); bc = mt.get("baseColorFactor", [0.8, 0.8, 0.8, 1])
                    col = [int(255 * (c ** (1 / 2.2))) for c in bc[:3]]
                    if "baseColorTexture" in mt: notes.append("base-colour textures are not rendered (flat base colour used)")
                C.append(np.tile(np.array(col, np.float32), (len(f), 1)))
        for c in nd.get("children", []): visit(c, M)
    sc = js["scenes"][js.get("scene", 0)]
    for n in sc["nodes"]: visit(n, np.eye(4, dtype=np.float32))
    if not V: raise ValueError("GLB contains no triangle meshes")
    v = np.concatenate(V); f = np.concatenate(F); c = np.concatenate(C)
    if len(f) > max_faces:                              # vertex-clustering decimation to keep CPU cost bounded
        lo, hi = v.min(0), v.max(0); cell = (hi - lo).max() / 90.0; key = np.floor((v - lo) / cell).astype(np.int64); _, inv, = np.unique(key, axis=0, return_inverse=True)
        nv = np.zeros((inv.max() + 1, 3), np.float32); cnt = np.bincount(inv).astype(np.float32);
        for k in range(3): nv[:, k] = np.bincount(inv, v[:, k]) / cnt
        f2 = inv[f]; keep = (f2[:, 0] != f2[:, 1]) & (f2[:, 1] != f2[:, 2]) & (f2[:, 0] != f2[:, 2]); notes.append(f"decimated {len(f)} -> {int(keep.sum())} faces"); v, f, c = nv, f2[keep], c[keep]
    v = v - (v.min(0) + v.max(0)) / 2; v = v / max(1e-6, (v.max(0) - v.min(0))[1] if (v.max(0) - v.min(0))[1] > 0 else (v.max(0) - v.min(0)).max())
    m = Mesh(v, f, fcol=c, color=c.mean(0), flat=False); m.notes = notes; return m


# ----------------------------------------------------------------------------- camera, lights, rendering
def rotm(ax, deg):
    a = math.radians(deg); c, s = math.cos(a), math.sin(a)
    return {"x": np.array([[1, 0, 0], [0, c, -s], [0, s, c]]), "y": np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]]), "z": np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])}[ax].astype(np.float32)


class Camera:
    def __init__(self, pos, target=(0, 0, 0), fov=38.0, roll=0.0):
        self.pos = np.array(pos, np.float32); self.target = np.array(target, np.float32); self.fov = fov; self.roll = roll

    def basis(self):
        f = self.target - self.pos; f /= np.linalg.norm(f); r = np.cross(f, np.array([0, 1, 0], np.float32)); r /= np.linalg.norm(r) + 1e-9; u = np.cross(r, f)
        if self.roll: c, s = math.cos(math.radians(self.roll)), math.sin(math.radians(self.roll)); r, u = r * c + u * s, u * c - r * s
        return r, u, f

    def project(self, P, W, H):
        r, u, f = self.basis(); d = P - self.pos; x, y, z = d @ r, d @ u, d @ f; z = np.maximum(z, 1e-3)
        fl = (H / 2.0) / math.tan(math.radians(self.fov) / 2); return np.stack([W / 2 + fl * x / z, H / 2 - fl * y / z], -1), z


def studio_env(rd, tone):
    """Reflected-direction -> colour of a simple studio environment (dark room, soft boxes, warm floor bounce). Cheap fake of an HDRI."""
    y = rd[:, 1]; base = np.clip(0.5 + 0.5 * y, 0, 1)[:, None] * tone * 0.55 + 18
    k1 = np.exp(-(((rd[:, 0] + 0.55) ** 2) * 9 + ((y - 0.45) ** 2) * 6) * (rd[:, 2] < 0.2))[:, None] * 250      # left strip softbox
    k2 = np.exp(-(((rd[:, 0] - 0.7) ** 2) * 14 + ((y - 0.2) ** 2) * 10))[:, None] * 160                           # right rim strip
    k3 = np.exp(-(((rd[:, 0]) ** 2) * 4 + ((y - 0.95) ** 2) * 14))[:, None] * 120                                  # top light
    return base + (k1 + k2 + k3) * np.array([1.0, 0.97, 0.92])


def shade(m, R, cam, light, tone, vcol=None):
    n, v = m.normals(R); cen = v[m.f].mean(axis=1); ldir = light["dir"] / np.linalg.norm(light["dir"])
    vd = cam.pos - cen; vd /= (np.linalg.norm(vd, axis=1, keepdims=True) + 1e-9)
    ndl = np.clip(n @ ldir, 0, 1)[:, None]; base = (m.fcol if m.fcol is not None else np.tile(m.color, (len(m.f), 1)))
    refl = 2 * np.sum(n * vd, 1, keepdims=True) * n - vd                 # view vector reflected about the normal
    env = studio_env(refl, tone)
    h = (ldir + vd); h /= (np.linalg.norm(h, axis=1, keepdims=True) + 1e-9); spec = np.clip(np.sum(n * h, 1, keepdims=True), 0, 1) ** (8 + 120 * m.gloss) * (0.25 + 0.9 * m.gloss)
    ndv = np.clip(np.sum(n * vd, 1, keepdims=True), 0, 1); fres = (1 - ndv) ** 3
    lc = light["color"] * light["intensity"]
    diff = base * (0.16 + 0.95 * ndl) * (lc / 255.0)
    metal = base * (env / 255.0) * 1.15
    nonmetal = diff + env * (0.06 + 0.5 * fres * m.gloss) + spec * 255.0 * (lc / 255.0)
    out = metal * m.metal + nonmetal * (1 - m.metal) + metal * 0.0 + fres * np.array(light.get("rim", [90, 110, 160]), np.float32) * 0.45 + m.emissive * base
    out = np.clip(out, 0, 255)
    if m.pairs and len(out) % 2 == 0: out = np.repeat(out.reshape(-1, 2, 3).mean(1), 2, axis=0)
    return out, n, v


class Renderer3D:
    def __init__(self, W, H, ss=1, max_w=720):
        self.sc = min(1.0, max_w / float(W)); self.W, self.H, self.ss = max(2, int(round(W * self.sc))), max(2, int(round(H * self.sc))), ss

    def render(self, items, cam, light, tone=(120, 120, 140), floor=None, smooth=2.6, shadow=True, reflection=True, fog=None):
        """items: list of (mesh, R(3x3), t(3,), scale). floor: y of a reflective ground plane or None. Returns (BGRA region, x0, y0) in output pixels."""
        W, H, ss = self.W, self.H, self.ss; tone = np.array(tone, np.float32)
        draws = []                                              # (depth, poly(px), colour(rgb), alpha)
        hulls = []
        for (m, R, t, s) in items:
            col, n, v = shade(m, R, cam, light, tone)
            v = v * s + np.array(t, np.float32); a, b, c = v[m.f[:, 0]], v[m.f[:, 1]], v[m.f[:, 2]]
            fn = np.cross(b - a, c - a); cen = (a + b + c) / 3; front = np.sum(fn * (cam.pos - cen), 1) > 0
            _, zc = cam.project(v, W, H); near_ok = (zc[m.f] > 0.35).all(1); front &= near_ok          # faces touching the near plane are skipped
            if fog is not None:                                  # fog = (rgb, start, end) distance blend (atmospheric depth)
                dz = zc[m.f].mean(1); k = np.clip((dz - fog[1]) / (fog[2] - fog[1]), 0, 1)[:, None] ** 1.3; col = col * (1 - k) + np.array(fog[0], np.float32) * k
            if reflection and floor is not None:
                mv = v.copy(); mv[:, 1] = 2 * floor - mv[:, 1]; ma, mb, mc = mv[m.f[:, 0]], mv[m.f[:, 1]], mv[m.f[:, 2]]
                mfn = -np.cross(mb - ma, mc - ma); mcen = (ma + mb + mc) / 3; vis = np.sum(mfn * (cam.pos - mcen), 1) > 0       # mirroring flips winding
                px, z = cam.project(mv, W * ss, H * ss); fade = np.clip(1 - (np.abs(cen[:, 1] - floor) / 3.2), 0.0, 1) ** 1.5; tri = px[m.f]; dep = z[m.f].max(1) * 0.5 + z[m.f].mean(1) * 0.5
                tri = np.round(tri * 16).astype(np.int32)
                for i in np.nonzero(vis)[0]: draws.append((dep[i] + 50, tri[i], col[i] * 0.85, 120 * fade[i]))
            if shadow and floor is not None:
                ld = light["dir"] / np.linalg.norm(light["dir"]); k = (v[:, 1] - floor) / np.maximum(ld[1], 0.2); sp = v - ld[None] * k[:, None]; sp[:, 1] = floor + 0.002
                spx, _ = cam.project(sp[m.f][front].reshape(-1, 3), W * ss, H * ss); hulls.append(cv2.convexHull(np.round(spx * 16).astype(np.int32)))
            px, z = cam.project(v, W * ss, H * ss); tri = np.round(px[m.f] * 16).astype(np.int32); dep = z[m.f].max(1) * 0.5 + z[m.f].mean(1) * 0.5
            for i in np.nonzero(front)[0]: draws.append((dep[i], tri[i], col[i], 255.0))
        draws.sort(key=lambda d: -d[0])
        # bounding region of everything drawn: all full-frame work (buffers, blur, resolve) is restricted to it
        allpts = [d[1].reshape(-1, 2) for d in draws] + [h.reshape(-1, 2) for h in hulls]
        if not allpts: return np.zeros((1, 1, 4), np.uint8), 0, 0
        P = np.concatenate(allpts) / 16.0; m_ = 12 * ss + (28 * ss if hulls else 0)
        x0 = int(max(0, math.floor(P[:, 0].min() / ss) * ss - m_)); y0 = int(max(0, math.floor(P[:, 1].min() / ss) * ss - m_))
        x1 = int(min(W * ss, math.ceil(P[:, 0].max() / ss) * ss + m_)); y1 = int(min(H * ss, math.ceil(P[:, 1].max() / ss) * ss + m_))
        if x1 <= x0 or y1 <= y0: return np.zeros((1, 1, 4), np.uint8), 0, 0
        off = np.array([x0 * 16, y0 * 16], np.int32); lay = np.zeros((y1 - y0, x1 - x0, 4), np.uint8)
        if hulls:                                               # planar shadow: convex hull of each mesh's projected footprint, softened
            sm = np.zeros(lay.shape[:2], np.uint8)
            for hh in hulls: cv2.fillConvexPoly(sm, hh - off, 255, cv2.LINE_8, 4)
            sm = cv2.GaussianBlur(sm, (0, 0), 7 * ss); lay[..., 3] = (sm * 0.55).astype(np.uint8)
        for _, poly, rgb, al in draws:
            c = (int(rgb[2]), int(rgb[1]), int(rgb[0]), int(al)); cv2.fillConvexPoly(lay, poly - off, c, cv2.LINE_8, 4)
        if smooth > 0:                                           # per-face shading smoothed in screen space (approximates Gouraud); uint8 normalised convolution over opaque faces
            core = np.where(lay[..., 3] >= 250, 255, 0).astype(np.uint8); k = max(3, int(smooth * 4) | 1)
            num = cv2.blur(cv2.bitwise_and(lay[..., :3], lay[..., :3], mask=core), (k, k)); den = cv2.blur(core, (k, k))
            ext = np.stack([cv2.divide(num[..., c], den, scale=255) for c in range(3)], -1)
            use = (core > 0) | (lay[..., 3] == 0); lay[..., :3] = np.where(use[..., None], ext, lay[..., :3])
            lay[..., 3] = np.maximum(lay[..., 3], cv2.GaussianBlur(core, (3, 3), 0.7) * (lay[..., 3] == 0))       # soft anti-aliased silhouette
        sc = self.sc
        if sc != 1.0:                                           # the 3D layer is rasterised at reduced size and resized for the final frame
            lay = cv2.resize(lay, (max(1, int(round(lay.shape[1] / sc))), max(1, int(round(lay.shape[0] / sc)))), interpolation=cv2.INTER_CUBIC)
        return lay, int(round(x0 / sc)), int(round(y0 / sc))


def composite(frame_rgb, layer, x0=0, y0=0):
    """Alpha-composite a BGRA region onto an RGB uint8 frame at (x0, y0), in place."""
    h, w = layer.shape[:2]; H, W = frame_rgb.shape[:2]; X1, Y1 = min(W, x0 + w), min(H, y0 + h)
    if X1 <= x0 or Y1 <= y0: return frame_rgb
    lay = layer[:Y1 - y0, :X1 - x0]; a = lay[..., 3:4].astype(np.float32) / 255.0
    if a.max() <= 0: return frame_rgb
    roi = frame_rgb[y0:Y1, x0:X1]; frame_rgb[y0:Y1, x0:X1] = np.clip(roi * (1 - a) + lay[..., 2::-1].astype(np.float32) * a, 0, 255).astype(np.uint8); return frame_rgb


def particles3d(n, seed, spread=(4.0, 3.0, 4.0)):
    rs = np.random.RandomState(seed); return (rs.rand(n, 3) - 0.5) * np.array(spread, np.float32), rs.rand(n).astype(np.float32)


def draw_particles(frame, cam, P, ph, t, W, H, accent, size=3.0, drift=0.25, bounds=(4.0, 3.0, 4.0), focus_z=None):
    """3D particles: positions in world space drift, are projected with the real camera, sized by depth and softened by depth-of-field."""
    Q = P.copy(); Q[:, 1] = ((P[:, 1] + t * drift * (0.4 + ph)) + bounds[1] / 2) % bounds[1] - bounds[1] / 2; Q[:, 0] += 0.15 * np.sin(t * 0.7 + ph * 9)
    px, z = cam.project(Q, W, H); lay = np.zeros((H, W, 3), np.float32); dist = np.linalg.norm(cam.target - cam.pos); fz = focus_z or dist
    for i in range(len(Q)):
        x, y = px[i]
        if not (0 <= x < W and 0 <= y < H): continue
        r = max(1, int(size * float(dist / z[i]) * float(0.6 + ph[i]) * H / 960)); blur = float(abs(z[i] - fz) / fz)
        cv2.circle(lay, (int(x), int(y)), r + int(blur * r * 1.6), tuple(float(c) * float(0.5 + 0.5 * ph[i]) * (0.6 if blur > 0.35 else 1.0) for c in accent), -1, cv2.LINE_AA)
    lay = cv2.GaussianBlur(lay, (0, 0), 1.2)
    return np.clip(frame.astype(np.float32) + lay * 0.9, 0, 255).astype(np.uint8)
