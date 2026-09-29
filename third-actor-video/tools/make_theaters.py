"""Procedural theater illustrations (1920x1080). Drop real photos into ../theater_images/
named photo_*.jpg and build.py will use them instead."""
import numpy as np, random, sys, os
from PIL import Image, ImageDraw, ImageFilter
W, H = 1920, 1080
OUT = os.path.join(os.path.dirname(__file__), "..", "theater_images")

def grad(top, bot, h=H, w=W):
    t = np.linspace(0, 1, h)[:, None, None]
    a = np.array(top, float)[None, None, :]; b = np.array(bot, float)[None, None, :]
    return np.repeat(a + (b - a) * t, w, axis=1)

def to_img(a): return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))

def beam(size, apex, spread, length, color, strength):
    """Soft additive spotlight cone as float array."""
    yy, xx = np.mgrid[0:size[1], 0:size[0]]
    dy = (yy - apex[1]).astype(float); dx = (xx - apex[0]).astype(float)
    dy = np.maximum(dy, 1)
    ang = np.abs(dx) / dy
    m = np.clip(1 - ang / spread, 0, 1) ** 1.6 * np.clip(1 - dy / length, 0, 1) ** 0.8
    return m[..., None] * np.array(color, float)[None, None, :] * strength

def finish(a, seed, vig=0.55, warm=True):
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:H, 0:W]
    r = np.sqrt(((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2)
    a = a * (1 - vig * np.clip(r - 0.35, 0, 1) ** 1.5)[..., None]
    a += rng.normal(0, 3.5, a.shape)
    return to_img(a)

def curtain(d, x0, x1, y0, y1, base=(120, 16, 32), folds=9):
    """Draw velvet curtain with vertical folds into float canvas d (H,W,3)."""
    w = x1 - x0
    xs = np.arange(w)
    f = (np.sin(xs / w * folds * 2 * np.pi) * 0.5 + 0.5) ** 1.3
    shade = 0.35 + 0.85 * f
    col = np.array(base, float)[None, :] * shade[:, None]
    d[y0:y1, x0:x1, :] = col[None, :, :]

def stage_scene(seed, curtains=True, seats=True, spot=True, mood=(1.0, 0.8, 0.55)):
    rng = np.random.default_rng(seed)
    a = grad((22, 8, 12), (10, 4, 6)).astype(float)
    # back wall
    a[0:640] = grad((46, 14, 20), (28, 9, 14), 640)
    if curtains:
        curtain(a, 0, 430, 0, 760); curtain(a, W - 430, W, 0, 760, folds=8)
        # valance
        for i in range(0, W, 60):
            a[0:110 + int(30 * np.sin(i / 60 * 2.1)), i:i + 60] = np.array((150, 22, 40)) * (0.7 + 0.3 * np.sin(i / 25))
    # stage floor (wood)
    fl = grad((90, 52, 30), (34, 18, 12), 1080 - 700)
    a[700:] = fl
    for k in range(12):  # plank lines with perspective
        x = int(W / 2 + (k - 6) * 260)
        img = to_img(a); dr = ImageDraw.Draw(img); dr.line([(W / 2 + (k - 6) * 60, 700), (x, H)], fill=(24, 12, 8), width=2); a = np.array(img, float)
    if spot:
        a += beam((W, H), (W // 2, -40), 0.42, 1250, mood, 0.9)
        # pool of light on floor
        yy, xx = np.mgrid[0:H, 0:W]
        pool = np.exp(-(((xx - W / 2) / 420) ** 2 + ((yy - 860) / 90) ** 2))
        a += pool[..., None] * np.array(mood) * 150
    img = to_img(a)
    if seats:
        dr = ImageDraw.Draw(img, "RGBA")
        for row in range(6):
            y = 900 + row * 40; s = 70 + row * 26
            for x in range(-40, W + 60, s):
                hh = s * 0.9
                dr.rounded_rectangle([x, y - hh, x + s * 0.8, y + 30], radius=14, fill=(24 + row * 4, 5, 10, 235))
    return img

def hall_from_back(seed):
    """Auditorium seen from the rear rows, lit stage far away."""
    a = grad((14, 6, 10), (6, 2, 4)).astype(float)
    a[200:560, 480:1440] = grad((190, 120, 70), (110, 50, 34), 360, 960)
    a[100:200, 440:1480] = np.array((60, 12, 24))
    a[200:560, 440:520] = np.array((110, 16, 32)); a[200:560, 1400:1480] = np.array((110, 16, 32))
    a += beam((W, H), (W // 2, 120), 0.5, 900, (1.0, 0.75, 0.5), 0.5)
    img = to_img(a); dr = ImageDraw.Draw(img, "RGBA")
    rng = random.Random(seed)
    for row in range(9):
        y = 620 + row * 52; s = 78 + row * 22
        off = rng.randint(0, s)
        for x in range(-off, W + s, s):
            hh = s * 0.95
            dr.rounded_rectangle([x, y - hh * 0.15, x + s * 0.82, y + 70], radius=16, fill=(14, 3, 6, 250))
            dr.rounded_rectangle([x + 4, y - hh * 0.15, x + s * 0.82 - 4, y - hh * 0.15 + 12], radius=6, fill=(80, 16, 30, 200))
            if rng.random() < 0.35:  # audience heads
                hx = x + s * 0.4
                dr.ellipse([hx - 20, y - 70, hx + 20, y - 26], fill=(8, 2, 4, 255))
                dr.rounded_rectangle([hx - 30, y - 34, hx + 30, y + 30], radius=14, fill=(8, 2, 4, 255))
    return img

def horseshoe(seed):
    """Ornate tiered horseshoe theater, gold balconies."""
    a = grad((30, 10, 14), (12, 4, 6)).astype(float)
    a += beam((W, H), (W // 2, -80), 0.9, 1400, (1.0, 0.8, 0.5), 0.35)
    img = to_img(a); dr = ImageDraw.Draw(img, "RGBA")
    cx, cy = W // 2, 820
    for tier in range(4):
        rx = 520 + tier * 190; ry = 330 + tier * 90
        top = cy - ry
        dr.arc([cx - rx, top, cx + rx, cy + ry], 180, 360, fill=(226, 180, 90, 255), width=10 - tier * 2)
        for k in range(-10, 11):
            ang = np.pi * (0.5 + k / 22)
            x = cx + rx * np.cos(ang - np.pi / 2 + np.pi / 2) * 0 + rx * np.sin(k / 11 * 1.35)
            y = cy - ry * np.cos(k / 11 * 1.35)
            dr.rounded_rectangle([x - 34, y + 8, x + 34, y + 84], radius=8, fill=(110 - tier * 10, 14, 30, 235), outline=(226, 180, 90, 200), width=3)
            dr.ellipse([x - 8, y - 10, x + 8, y + 6], fill=(255, 226, 150, 255))  # lamp
    # lamp glow
    g = img.filter(ImageFilter.GaussianBlur(22)); img = Image.blend(img, g, 0.35)
    a = np.array(img, float)
    yy, xx = np.mgrid[0:H, 0:W]
    a += (np.exp(-(((xx - cx) / 500) ** 2 + ((yy - 900) / 160) ** 2)))[..., None] * np.array((255, 190, 110)) * 0.8
    return to_img(a)

def globe(seed):
    """Elizabethan wooden O with galleries and open sky at dusk."""
    a = grad((236, 150, 90), (60, 32, 60), 520).astype(float)
    a = np.concatenate([a, grad((50, 28, 20), (20, 10, 8), H - 520)], 0)
    img = to_img(a); dr = ImageDraw.Draw(img, "RGBA")
    for tier in range(3):  # galleries
        y0 = 350 + tier * 150
        dr.rectangle([0, y0, W, y0 + 120], fill=(70 - tier * 8, 40 - tier * 5, 24, 255))
        for x in range(0, W, 110):
            dr.rectangle([x, y0, x + 12, y0 + 120], fill=(36, 20, 12, 255))
            dr.rectangle([x + 30, y0 + 30, x + 92, y0 + 100], fill=(18, 8, 6, 255))
            if (x // 110 + tier) % 3 == 0: dr.ellipse([x + 52, y0 + 44, x + 70, y0 + 62], fill=(255, 200, 120, 255))
        dr.rectangle([0, y0 - 8, W, y0], fill=(150, 100, 56, 255))
    dr.polygon([(640, 700), (1280, 700), (1420, 560), (500, 560)], fill=(120, 76, 42, 255))  # stage
    dr.rectangle([500, 380, 520, 560], fill=(200, 150, 80, 255)); dr.rectangle([1400, 380, 1420, 560], fill=(200, 150, 80, 255))
    dr.polygon([(480, 380), (1440, 380), (1380, 300), (540, 300)], fill=(150, 30, 40, 255))
    a = np.array(img, float)
    a += beam((W, H), (W // 2, 0), 0.5, 1000, (1.0, 0.7, 0.4), 0.25)
    return to_img(a)

def curtains_closed(seed):
    a = np.zeros((H, W, 3))
    curtain(a, 0, W, 0, H, folds=16)
    a *= 0.95
    a += beam((W, H), (W // 2, -60), 0.55, 1300, (1.0, 0.7, 0.45), 0.7)
    img = to_img(a); dr = ImageDraw.Draw(img, "RGBA")
    dr.rectangle([0, 0, W, 140], fill=(96, 12, 26, 255))
    for x in range(0, W, 70): dr.ellipse([x, 110, x + 70, 190], fill=(150, 26, 44, 255))
    dr.rectangle([0, 130, W, 146], fill=(226, 180, 90, 255))
    for x in (W // 2 - 60, W // 2 + 60):  # tassel ropes
        dr.rectangle([x - 5, 640, x + 5, 860], fill=(226, 180, 90, 255)); dr.ellipse([x - 26, 830, x + 26, 940], fill=(226, 180, 90, 255))
    return img

def masks(seed):
    a = grad((60, 14, 26), (20, 5, 10)).astype(float)
    curtain(a, 0, W, 0, H, base=(110, 14, 30), folds=12)
    a += beam((W, H), (W // 2, -60), 0.5, 1300, (1.0, 0.75, 0.5), 0.6)
    img = to_img(a); dr = ImageDraw.Draw(img, "RGBA")
    def mask(cx, cy, smile):
        dr.ellipse([cx - 190, cy - 240, cx + 190, cy + 250], fill=(226, 180, 90, 255), outline=(150, 110, 40, 255), width=8)
        for ex in (-80, 80): dr.ellipse([cx + ex - 44, cy - 90, cx + ex + 44, cy - 20], fill=(46, 8, 16, 255))
        if smile: dr.arc([cx - 100, cy + 10, cx + 100, cy + 150], 15, 165, fill=(46, 8, 16, 255), width=18)
        else: dr.arc([cx - 100, cy + 110, cx + 100, cy + 230], 195, 345, fill=(46, 8, 16, 255), width=18)
    mask(640, 560, True); mask(1280, 600, False)
    return img

def stage_side(seed):
    img = stage_scene(seed, curtains=True, seats=False, spot=False, mood=(1.0, 0.7, 0.45))
    a = np.array(img, float)
    for x, s in ((420, 0.5), (960, 0.75), (1500, 0.5)):
        a += beam((W, H), (x, -30), 0.22, 1150, (1.0, 0.8, 0.55) if x != 960 else (0.6, 0.75, 1.0), s)
    rng = np.random.default_rng(seed)  # dust motes
    for _ in range(260):
        x, y = rng.integers(200, W - 200), rng.integers(80, 900)
        a[y:y + 3, x:x + 3] += 120
    return to_img(a)

def seats_closeup(seed):
    a = grad((30, 8, 14), (8, 2, 4)).astype(float)
    img = to_img(a); dr = ImageDraw.Draw(img, "RGBA")
    for row in range(4):
        y = 300 + row * 190
        for i in range(-1, 6):
            x = i * 420 + (row % 2) * 200
            dr.rounded_rectangle([x, y - 240, x + 360, y + 60], radius=60, fill=(120 - row * 16, 16, 34, 255))
            dr.rounded_rectangle([x + 20, y - 220, x + 340, y - 40], radius=44, fill=(150 - row * 18, 22, 44, 255))
            dr.rounded_rectangle([x - 30, y - 20, x + 30, y + 130], radius=16, fill=(226, 180, 90, 255))
    a = np.array(img.filter(ImageFilter.GaussianBlur(3)), float)
    a += beam((W, H), (W // 2, -100), 0.7, 1300, (1.0, 0.8, 0.5), 0.55)
    return to_img(a)

SCENES = {
    "01_empty_stage": lambda: stage_scene(1),
    "02_auditorium_back": lambda: hall_from_back(2),
    "03_horseshoe_balconies": lambda: horseshoe(3),
    "04_elizabethan_globe": lambda: globe(4),
    "05_curtains_closed": lambda: curtains_closed(5),
    "06_stage_lights": lambda: stage_side(6),
    "07_masks": lambda: masks(7),
    "08_velvet_seats": lambda: seats_closeup(8),
}
if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for i, (n, fn) in enumerate(SCENES.items()):
        img = fn()
        a = np.array(img.convert("RGB"), float)
        finish(a, i).save(os.path.join(OUT, n + ".jpg"), quality=92)
        print("wrote", n)
