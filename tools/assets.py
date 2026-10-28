"""Reads every byte-level fact of the brand assets, writes derived web assets.
Outputs: src/assets/logo-512.png, logo-192.png, favicon.svg, src/tokens.json
Run: python -I tools/assets.py   (inputs live in brand/ and reference/)"""
import struct, json, os
import numpy as np
from PIL import Image
from sklearn.cluster import KMeans

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *a: os.path.join(ROOT, *a)
LOGO_ALPHA = P('brand', 'LOGO LANDOFMEMES PNG...png')   # RGBA, transparent bg
LOGO_OPAQUE = P('brand', 'LOGO LANDOFMEMES PNG.png')    # RGBA, opaque black bg
REF_BG = P('reference', 'LANDOFMEMES 1.jpg.jpeg')       # dark surface sample
OUT = P('src', 'assets')
os.makedirs(OUT, exist_ok=True)

def ihdr(path):
    b = open(path, 'rb').read(33)
    assert b[:8] == b'\x89PNG\r\n\x1a\n'
    w, h, bd, ct, _, _, il = struct.unpack('>IIBBBBB', b[16:29])
    return dict(w=w, h=h, bitdepth=bd, colortype=ct, interlace=il)

def report(path):
    im = Image.open(path); a = np.array(im.convert('RGBA'))
    al = a[..., 3]
    r = dict(file=os.path.relpath(path, ROOT), size=im.size, mode=im.mode,
             alpha_zero=int((al == 0).sum()), alpha_partial=int(((al > 0) & (al < 255)).sum()),
             alpha_full=int((al == 255).sum()))
    z = a[al == 0]
    r['transparent_pure_black'] = int((z[:, :3] == 0).all(1).sum()) if len(z) else 0
    if path.lower().endswith('.png'): r['ihdr'] = ihdr(path)
    return r, a

def snap_clusters(a, k=8, seed=1):
    h, w = a.shape[:2]
    flat = a.reshape(-1, a.shape[-1])
    idx = np.flatnonzero(flat[:, 3] > 40) if flat.shape[1] == 4 else np.arange(len(flat))
    rs = np.random.RandomState(seed)
    if len(idx) > 40000: idx = rs.choice(idx, 40000, replace=False)
    px = flat[idx][:, :3].astype(float)
    km = KMeans(k, n_init=3, random_state=seed).fit(px)
    cnt = np.bincount(km.labels_)
    out = []
    for i in np.argsort(-cnt):
        j = ((px - km.cluster_centers_[i]) ** 2).sum(1).argmin()
        fy, fx = divmod(int(idx[j]), w)
        c = tuple(int(v) for v in px[j])
        out.append(dict(hex='#%02x%02x%02x' % c, share=round(100 * cnt[i] / len(px), 1), x=fx, y=fy, rgb=c))
    return out

lum = lambda c: (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255

reports = []
ra, arr_alpha = report(LOGO_ALPHA); reports.append(ra)
ro, arr_opaque = report(LOGO_OPAQUE); reports.append(ro)
rr, arr_ref = report(REF_BG); reports.append(rr)
for r in reports: print(json.dumps(r))

# ---- palette: k-means, each centre snapped to a real pixel coordinate
cl_logo = snap_clusters(arr_opaque)
cl_ref = snap_clusters(arr_ref)
def pick(cl, target, lo=0, hi=1):
    c = [x for x in cl if lo <= lum(x['rgb']) <= hi]
    return min(c, key=lambda x: abs(lum(x['rgb']) - target))
roles = {
    'ink':   (pick(cl_ref, 0.0), REF_BG),
    'ink2':  (pick(cl_ref, 0.12, 0.08, 0.2), REF_BG),
    'paper': (pick(cl_logo, 1.0), LOGO_OPAQUE),
    'soft':  (pick(cl_logo, 0.76, 0.6, 0.9), LOGO_OPAQUE),
    'mute':  (pick(cl_logo, 0.59, 0.45, 0.7), LOGO_OPAQUE),
    'dim':   (pick(cl_logo, 0.42, 0.3, 0.5), LOGO_OPAQUE),
}
tokens = {k: dict(hex=v[0]['hex'], file=os.path.relpath(v[1], ROOT).replace(chr(92), '/'), x=v[0]['x'], y=v[0]['y'], share=v[0]['share']) for k, v in roles.items()}
for k, v in tokens.items(): print('token', k, v)

# ---- premultiplied resize (transparent region is pure black -> avoid dark fringe)
def premul_resize(a, box, size):
    crop = a[box[1]:box[3], box[0]:box[2]].astype(np.float64)
    al = crop[..., 3:4] / 255.0
    pm = np.concatenate([crop[..., :3] * al, crop[..., 3:4]], axis=-1)
    chans = [np.array(Image.fromarray(pm[..., i].astype(np.float32), 'F').resize((size, size), Image.LANCZOS)) for i in range(4)]
    r = np.stack(chans, -1)
    a2 = np.clip(r[..., 3:4], 0, 255)
    rgb = np.where(a2 > 0.5, r[..., :3] / np.maximum(a2 / 255.0, 1e-6), 0)
    return np.clip(np.concatenate([rgb, a2], -1) + 0.5, 0, 255).astype(np.uint8)

al = arr_alpha[..., 3]
ys, xs = np.where(al > 8)
x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
print('logo bbox', x0, y0, x1, y1)
side = max(x1 - x0, y1 - y0); pad = int(side * 0.04); side += 2 * pad
cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
box = (cx - side // 2, cy - side // 2, cx - side // 2 + side, cy - side // 2 + side)
for s in (512, 192):
    Image.fromarray(premul_resize(arr_alpha, box, s), 'RGBA').save(os.path.join(OUT, f'logo-{s}.png'), optimize=True)

# ---- favicon: 32x32 pixel grid sampled from the logo alpha, run-length rects
g = premul_resize(arr_alpha, box, 32)[..., 3] >= 110
t = tokens
rects = []
for y in range(32):
    x = 0
    while x < 32:
        if g[y, x]:
            s = x
            while x < 32 and g[y, x]: x += 1
            rects.append(f'M{s} {y}h{x - s}v1h-{x - s}z')
        else: x += 1
svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" shape-rendering="crispEdges">'
       f'<rect width="32" height="32" rx="6" fill="{t["ink"]["hex"]}"/>'
       f'<path fill="{t["paper"]["hex"]}" d="{"".join(rects)}"/></svg>')
assert '--' not in svg
open(os.path.join(OUT, 'favicon.svg'), 'w').write(svg)
print('favicon px on:', int(g.sum()), 'bytes', len(svg))

json.dump(dict(tokens=tokens, assets=reports), open(P('src', 'tokens.json'), 'w'), indent=1)
