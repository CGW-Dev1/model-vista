# -*- coding: utf-8 -*-
"""Generate ModelVista app icons (PNG + multi-size ICO)."""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "resources")
SS = 4  # supersampling factor
S = 1024 * SS

# ---------- gradient background ----------
def hex2rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

c1 = np.array(hex2rgb("#4F6EF7"), dtype=np.float32)   # indigo
c2 = np.array(hex2rgb("#8B5CF6"), dtype=np.float32)   # violet
c3 = np.array(hex2rgb("#2E3A8C"), dtype=np.float32)   # deep indigo

yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
t = (xx / S * 0.55 + yy / S * 0.45)
t = np.clip(t, 0, 1)[..., None]
# two-stop blend with slight darkening at bottom-right corner
grad = c1 * (1 - t) + c2 * t
corner = np.clip(((xx - S * 0.72) ** 2 + (yy - S * 0.78) ** 2) / (S * 0.55) ** 2, 0, 1)[..., None]
grad = grad * (1 - corner * 0.22) + c3 * (corner * 0.22)

img = Image.fromarray(grad.clip(0, 255).astype(np.uint8), "RGB").convert("RGBA")

# rounded-corner mask (squircle-ish)
mask = Image.new("L", (S, S), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.225), fill=255)
img.putalpha(mask)

# subtle top-left sheen
hl = Image.new("L", (S, S), 0)
hd = ImageDraw.Draw(hl)
hd.ellipse([-int(S * 0.45), -int(S * 0.55), int(S * 0.55), int(S * 0.30)], fill=40)
hl = hl.filter(ImageFilter.GaussianBlur(int(S * 0.10)))
white = Image.new("RGBA", (S, S), (255, 255, 255, 255))
img = Image.composite(white, img, hl.point(lambda v: int(v * 0.10)))
img.putalpha(mask)

d = ImageDraw.Draw(img)

# ---------- data table card ----------
cx, cy = int(S * 0.225), int(S * 0.265)
cw, ch = int(S * 0.445), int(S * 0.40)
r = int(S * 0.035)
# soft shadow
shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
sd = ImageDraw.Draw(shadow)
sd.rounded_rectangle([cx + int(S * 0.012), cy + int(S * 0.018), cx + cw + int(S * 0.012), cy + ch + int(S * 0.018)],
                     radius=r, fill=(20, 24, 60, 90))
shadow = shadow.filter(ImageFilter.GaussianBlur(int(S * 0.018)))
img.alpha_composite(shadow)
d = ImageDraw.Draw(img)

# card body
d.rounded_rectangle([cx, cy, cx + cw, cy + ch], radius=r, fill=(255, 255, 255, 248))
# header bar
d.rounded_rectangle([cx, cy, cx + cw, cy + int(ch * 0.20)], radius=r, fill=(255, 255, 255, 248))
d.rectangle([cx, cy + int(ch * 0.13), cx + cw, cy + int(ch * 0.20)], fill=(255, 255, 255, 248))
d.rectangle([cx, cy + int(ch * 0.16), cx + cw, cy + int(ch * 0.20)], fill=(79, 110, 247, 255))

# header dots
dot_y = cy + int(ch * 0.08)
for i, col in enumerate([(79, 110, 247, 235)] * 3):
    d.ellipse([cx + int(cw * 0.06) + i * int(cw * 0.055), dot_y - int(S * 0.006),
               cx + int(cw * 0.06) + i * int(cw * 0.055) + int(S * 0.012), dot_y + int(S * 0.006)],
              fill=col)

# grid: 3 columns x 4 rows of pills
gx0 = cx + int(cw * 0.075)
gy0 = cy + int(ch * 0.30)
gw = cw - int(cw * 0.15)
gh = ch - int(ch * 0.40)
cols, rows = 3, 4
cell_w = gw / cols
cell_h = gh / rows
for rr in range(rows):
    for cc in range(cols):
        x0 = gx0 + cc * cell_w + int(cell_w * 0.14)
        y0 = gy0 + rr * cell_h + int(cell_h * 0.16)
        x1 = gx0 + (cc + 1) * cell_w - int(cell_w * 0.14)
        y1 = gy0 + (rr + 1) * cell_h - int(cell_h * 0.16)
        color = (79, 110, 247, 235) if rr == 0 else (205, 214, 246, 255)
        d.rounded_rectangle([x0, y0, x1, y1], radius=int(S * 0.008), fill=color)

# ---------- magnifier ----------
mcx, mcy = int(S * 0.755), int(S * 0.705)
mr = int(S * 0.130)
ring = int(S * 0.038)

# glass: keep transparent, only a soft inner tint ring
tint = Image.new("RGBA", (S, S), (0, 0, 0, 0))
td = ImageDraw.Draw(tint)
td.ellipse([mcx - mr + ring // 2, mcy - mr + ring // 2, mcx + mr - ring // 2, mcy + mr - ring // 2],
           fill=(255, 255, 255, 36))
img.alpha_composite(tint)
d = ImageDraw.Draw(img)
# white ring
d.ellipse([mcx - mr, mcy - mr, mcx + mr, mcy + mr], outline=(255, 255, 255, 255), width=ring)

# handle
hx0, hy0 = mcx + int(mr * 0.68), mcy + int(mr * 0.68)
hx1, hy1 = hx0 + int(S * 0.080), hy0 + int(S * 0.080)
d.line([hx0, hy0, hx1, hy1], fill=(255, 255, 255, 255), width=int(S * 0.055))
d.ellipse([hx0 - int(S*0.0275), hy0 - int(S*0.0275), hx0 + int(S*0.0275), hy0 + int(S*0.0275)], fill=(255, 255, 255, 255))
d.ellipse([hx1 - int(S*0.0275), hy1 - int(S*0.0275), hx1 + int(S*0.0275), hy1 + int(S*0.0275)], fill=(255, 255, 255, 255))

# ---------- downsample ----------
out = img.resize((1024, 1024), Image.LANCZOS)
out.save(os.path.join(OUT_DIR, "icon.png"))
out.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT_DIR, "icon-512.png"))
sizes = [16, 24, 32, 40, 48, 64, 96, 128, 256]
out.save(os.path.join(OUT_DIR, "icon.ico"), format="ICO", sizes=[(s, s) for s in sizes])
print("icons written to", OUT_DIR)
