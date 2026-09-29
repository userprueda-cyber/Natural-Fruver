#!/usr/bin/env python3
"""THE THIRD ACTOR - documentary build.

Follows video-use's production rules: per-scene extract -> lossless `-c copy` concat,
30 ms audio fades at every scene edge, cut edges padded on silence gaps, captions applied
LAST in each scene's filter chain, all outputs in ./edit/.

Usage: python tools/build.py [--preview]
Env:   FFMPEG (path to ffmpeg), SRC_VIDEO, SRC_GORDON (audio), edit dir = ../edit
"""
import os, sys, glob, json, math, subprocess, textwrap
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
EDIT = os.path.join(ROOT, "edit"); os.makedirs(EDIT, exist_ok=True)
FF = os.environ.get("FFMPEG", "ffmpeg")
UP = "/root/.claude/uploads/667eecf4-e906-536b-8c62-5d58178423a8"
SRC_V = os.environ.get("SRC_VIDEO", f"{UP}/d7d96556-VIDEO-2026-09-29-12-06-47.mp4")
SRC_A = os.environ.get("SRC_GORDON", f"{UP}/4fe1c122-AUDIO-2026-09-29-11-36-44.m4a")  # Ms. Gordon
SRC_B = os.environ.get("SRC_CAMILO", f"{UP}/9ee86347-AUDIO-2026-09-29-12-03-50.m4a")  # Camilo Gonzalez
PREVIEW = "--preview" in sys.argv
W, H, FPS = 1280, 720, 30
CRF = "26" if PREVIEW else "18"

# ---- theme "Curtain Call" -------------------------------------------------
GOLD = (226, 180, 90); IVORY = (243, 233, 210); VELVET = (107, 15, 34); INK = (18, 6, 10)
A_GOLD, A_IVORY = "&H5AB4E2&", "&HD2E9F3&"        # ASS is BGR
F_BOLD = "/usr/share/fonts/X11/Type1/c0632bt_.pfb"
F_BOLDIT = "/usr/share/fonts/X11/Type1/c0633bt_.pfb"
F_REG = "/usr/share/fonts/X11/Type1/c0648bt_.pfb"
F_IT = "/usr/share/fonts/X11/Type1/c0649bt_.pfb"
FONTSDIR = "/usr/share/fonts/X11/Type1"

def sh(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode:
        print(" ".join(map(str, cmd))[:600]); print(r.stderr[-1800:]); raise SystemExit(1)
    return r

def ease_out_cubic(t): return 1 - (1 - t) ** 3
def ease_in_out_cubic(t): return 4 * t ** 3 if t < .5 else 1 - (-2 * t + 2) ** 3 / 2
def clamp01(x): return max(0.0, min(1.0, x))

# ---- theme frame (vignette + gold inset border), applied over all live scenes ----
def make_frame():
    p = os.path.join(EDIT, "theme_frame.png")
    yy, xx = np.mgrid[0:H, 0:W]
    r = np.sqrt(((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2)
    a = (np.clip(r - 0.45, 0, 1) ** 1.6 * 150).astype(np.uint8)
    img = Image.new("RGBA", (W, H), (10, 3, 6, 0)); img.putalpha(Image.fromarray(a))
    d = ImageDraw.Draw(img); m = 20; c = GOLD + (170,)
    d.rectangle([m, m, W - m, H - m], outline=GOLD + (95,), width=1)
    L = 34
    for (x, y, sx, sy) in ((m, m, 1, 1), (W - m, m, -1, 1), (m, H - m, 1, -1), (W - m, H - m, -1, -1)):
        d.line([(x, y), (x + sx * L, y)], fill=c, width=3); d.line([(x, y), (x, y + sy * L)], fill=c, width=3)
    img.save(p); return p

# ---- curtains -------------------------------------------------------------
def curtain_panel(w, h, folds=7, base=(122, 16, 34)):
    xs = np.arange(w)
    f = (np.sin(xs / w * folds * 2 * np.pi) * .5 + .5) ** 1.3
    shade = .3 + .9 * f
    col = (np.array(base, float)[None, :] * shade[:, None])[None].repeat(h, 0)
    yy = np.linspace(1.0, .55, h)[:, None, None]
    return np.clip(col * yy, 0, 255)

LP = curtain_panel(W // 2 + 30, H); RP = curtain_panel(W // 2 + 30, H)[:, ::-1]

def stage_backdrop():
    yy, xx = np.mgrid[0:H, 0:W]
    t = np.linspace(0, 1, H)[:, None, None]
    a = np.array((40, 10, 20), float) * (1 - t) + np.array((12, 4, 8), float) * t
    a = np.repeat(a, W, 1)
    dy = np.maximum(yy - (-30), 1).astype(float); dx = (xx - W / 2).astype(float)
    m = np.clip(1 - np.abs(dx) / dy / 0.55, 0, 1) ** 1.6 * np.clip(1 - dy / 900, 0, 1) ** .8
    a += m[..., None] * np.array((255, 190, 120)) * .55
    pool = np.exp(-(((xx - W / 2) / 380) ** 2 + ((yy - 640) / 70) ** 2))
    a += pool[..., None] * np.array((255, 190, 120)) * .35
    r = np.sqrt(((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2)
    return np.clip(a * (1 - .5 * np.clip(r - .3, 0, 1))[..., None], 0, 255)

BACK = stage_backdrop()

def spaced(d, xy, text, font, fill, spacing=0, anchor="mm"):
    """Draw letter-spaced text centred at xy."""
    widths = [font.getlength(ch) for ch in text]
    total = sum(widths) + spacing * (len(text) - 1)
    x = xy[0] - total / 2
    for ch, w in zip(text, widths):
        d.text((x, xy[1]), ch, font=font, fill=fill, anchor="lm"); x += w + spacing

def divider(d, cy, half=190):
    d.line([(W / 2 - half, cy), (W / 2 - 16, cy)], fill=GOLD, width=2)
    d.line([(W / 2 + 16, cy), (W / 2 + half, cy)], fill=GOLD, width=2)
    d.polygon([(W / 2, cy - 8), (W / 2 + 8, cy), (W / 2, cy + 8), (W / 2 - 8, cy)], fill=GOLD)

def title_layer(kind):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    if kind == "title":
        spaced(d, (W / 2, 190), "A  DOCUMENTARY", ImageFont.truetype(F_REG, 26), GOLD, 9)
        spaced(d, (W / 2, 300), "THE THIRD ACTOR", ImageFont.truetype(F_BOLD, 96), IVORY, 6)
        divider(d, 372)
        d.text((W / 2, 440), "Including the Audience", font=ImageFont.truetype(F_IT, 46), fill=GOLD, anchor="mm")
        spaced(d, (W / 2, 610), "PABLO  &  EMILIANO", ImageFont.truetype(F_REG, 24), IVORY, 8)
    else:
        spaced(d, (W / 2, 140), "THE  THIRD  ACTOR", ImageFont.truetype(F_REG, 26), GOLD, 9)
        d.text((W / 2, 250), "Thank you,", font=ImageFont.truetype(F_IT, 54), fill=IVORY, anchor="mm")
        d.text((W / 2, 330), "Ms. Gordon", font=ImageFont.truetype(F_BOLD, 88), fill=IVORY, anchor="mm")
        d.text((W / 2, 410), "and Camilo Gonzalez", font=ImageFont.truetype(F_BOLDIT, 50), fill=IVORY, anchor="mm")
        divider(d, 468)
        spaced(d, (W / 2, 535), "A DOCUMENTARY BY", ImageFont.truetype(F_REG, 22), GOLD, 8)
        d.text((W / 2, 585), "Pablo & Emiliano", font=ImageFont.truetype(F_BOLD, 44), fill=IVORY, anchor="mm")
    sh_ = img.filter(ImageFilter.GaussianBlur(6)); a = np.array(sh_)[..., 3] * .7
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0)); out.paste(Image.new("RGBA", (W, H), (0, 0, 0, 255)), mask=Image.fromarray(a.astype(np.uint8)))
    out.alpha_composite(img); return out

def render_card(kind, dur, out):
    """Curtain-open title / curtain-close end card, frames piped to ffmpeg."""
    layer = title_layer(kind); la = np.array(layer, float)
    n = int(dur * FPS)
    p = subprocess.Popen([FF, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                          "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", out], stdin=subprocess.PIPE)
    rng = np.random.default_rng(3)
    for i in range(n):
        t = i / FPS
        f = BACK.copy()
        if kind == "title":
            op = ease_in_out_cubic(clamp01((t - .6) / 2.0))            # curtains part
            txt = ease_out_cubic(clamp01((t - 1.9) / 1.2))              # text lands as they open
        else:
            op = 1 - ease_in_out_cubic(clamp01((t - (dur - 2.2)) / 1.8))  # curtains close at the end
            op = min(op, 1 - ease_in_out_cubic(clamp01(1 - t / 1.2))) if False else op
            txt = ease_out_cubic(clamp01(t / 1.2))
        dx = int(op * (W / 2 + 30))
        # text
        al = (la[..., 3:4] / 255.0) * txt
        f = f * (1 - al) + la[..., :3] * al
        # curtains
        lw = W // 2 + 30
        f[:, :max(lw - dx, 0)] = LP[:, dx:dx + max(lw - dx, 0)] if lw - dx > 0 else f[:, :0]
        f[:, W - max(lw - dx, 0):] = RP[:, :max(lw - dx, 0)] if lw - dx > 0 else f[:, :0]
        f += rng.normal(0, 3, f.shape)
        if kind == "title":
            f *= clamp01(t / .5)                                        # fade up from black
        else:
            f *= 1 - clamp01((t - (dur - .6)) / .6)                     # final fade to black
        p.stdin.write(np.clip(f, 0, 255).astype(np.uint8).tobytes())
    p.stdin.close(); p.wait()

# ---- Ken Burns montage of theater images ------------------------------------
def theater_pool(names):
    photos = sorted(glob.glob(os.path.join(ROOT, "theater_images", "photo_*.*")))
    pool = []
    for n in names:
        pool.append(sorted(glob.glob(os.path.join(ROOT, "theater_images", n + "*")))[0])
    if photos:  # user-supplied real photos take over
        pool = [photos[i % len(photos)] for i in range(len(names))]
    return pool

def render_montage(paths, dur, out, zoom_out=False, xfade=1.1):
    n = int(round(dur * FPS)); k = len(paths)
    seg = (dur + xfade * (k - 1)) / k
    imgs = [Image.open(p).convert("RGB") for p in paths]
    iw, ih = imgs[0].size
    p = subprocess.Popen([FF, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                          "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", out], stdin=subprocess.PIPE)
    def frame(idx, lt):
        im = imgs[idx]; u = clamp01(lt / seg); e = ease_in_out_cubic(u)
        z0, z1 = (1.22, 1.0) if (zoom_out or idx % 2) else (1.0, 1.22)
        z = z0 + (z1 - z0) * e
        cw, ch = iw / z, ih / z
        dirn = (-1) ** idx
        cx = iw / 2 + dirn * (e - .5) * (iw - cw) * .8; cy = ih / 2 + (e - .5) * (ih - ch) * .3
        box = (cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2)
        return np.asarray(im.resize((W, H), Image.BICUBIC, box=box), np.float32)
    for i in range(n):
        t = i / FPS; idx = min(int(t // (seg - xfade)), k - 1) if k > 1 else 0
        lt = t - idx * (seg - xfade)
        f = frame(idx, lt)
        if idx + 1 < k and lt > seg - xfade:
            w = ease_in_out_cubic((lt - (seg - xfade)) / xfade)
            f = f * (1 - w) + frame(idx + 1, lt - (seg - xfade)) * w
        p.stdin.write(np.clip(f, 0, 255).astype(np.uint8).tobytes())
    p.stdin.close(); p.wait()

# ---- ASS captions / overlays ---------------------------------------------------
def tc(t):
    t = max(t, 0); h = int(t // 3600); m = int(t % 3600 // 60); s = t % 60
    return f"{h}:{m:02d}:{s:05.2f}"

ASS_HEAD = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 2
[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Cap,Bitstream Charter,34,{A_IVORY},{A_IVORY},&H120812&,&H8C120812&,0,0,0,0,100,100,0,0,3,7,0,2,90,90,58,1
Style: Ask,Bitstream Charter,32,{A_GOLD},{A_GOLD},&H120812&,&H8C120812&,0,-1,0,0,100,100,0,0,3,7,0,2,90,90,58,1
Style: Name,Bitstream Charter,46,{A_IVORY},{A_IVORY},&H000000&,&H00000000,-1,0,0,0,100,100,1,0,1,0,0,7,0,0,0,1
Style: Role,Bitstream Charter,22,{A_GOLD},{A_GOLD},&H000000&,&H00000000,0,0,0,0,100,100,6,0,1,0,0,7,0,0,0,1
Style: Big,Bitstream Charter,58,{A_IVORY},{A_IVORY},&H000000&,&H00000000,-1,0,0,0,100,100,6,0,1,2,0,5,0,0,0,1
Style: Step,Bitstream Charter,30,{A_IVORY},{A_IVORY},&H000000&,&H00000000,-1,0,0,0,100,100,3,0,1,0,0,7,0,0,0,1
[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
"""

def box(x, y, w, h, alpha="&H55&", color="&H0A0308&", t0=0, dur=0, fade=(250, 250)):
    return (f"Dialogue: 0,{tc(t0)},{tc(t0 + dur)},Cap,,0,0,0,,{{\\an7\\pos({x},{y})\\p1\\bord0\\shad0\\1c{color}\\1a{alpha}"
            f"\\fad({fade[0]},{fade[1]})}}m 0 0 l {w} 0 {w} {h} 0 {h}{{\\p0}}")

def split_text(text, maxc=46):
    words = text.split(); chunks, cur = [], ""
    n = max(1, math.ceil(len(text) / maxc)); target = len(text) / n
    for w in words:
        if cur and len(cur) + 1 + len(w) > target + 6: chunks.append(cur); cur = w
        else: cur = (cur + " " + w).strip()
    if cur: chunks.append(cur)
    return chunks

class Ass:
    def __init__(self, src0, lead=0.0): self.ev = []; self.src0 = src0; self.lead = lead
    def rel(self, t): return t - self.src0 + self.lead
    def cap(self, t0, t1, text, ask=False):
        chunks = split_text(text); tot = sum(len(c) for c in chunks); t = t0
        for c in chunks:
            d = (t1 - t0) * len(c) / tot
            self.ev.append(f"Dialogue: 1,{tc(self.rel(t))},{tc(self.rel(t + d) - .02)},{'Ask' if ask else 'Cap'},,0,0,0,,{{\\fad(120,120)}}{c}")
            t += d
    def raw(self, line): self.ev.append(line)
    def write(self, path): open(path, "w").write(ASS_HEAD + "\n".join(self.ev) + "\n")

def lower_third(a, t0, dur, name, role):
    x, y = 90, 468
    a.raw(box(x - 24, y - 12, 470, 108, t0=t0, dur=dur))
    a.raw(f"Dialogue: 2,{tc(t0)},{tc(t0 + dur)},Cap,,0,0,0,,{{\\an7\\pos({x - 24},{y - 12})\\p1\\bord0\\shad0\\1c{A_GOLD}\\fad(250,250)}}m 0 0 l 5 0 5 108 0 108{{\\p0}}")
    a.raw(f"Dialogue: 3,{tc(t0)},{tc(t0 + dur)},Name,,0,0,0,,{{\\pos({x},{y})\\fad(350,250)\\move({x - 30},{y},{x},{y},0,450)}}{name}")
    a.raw(f"Dialogue: 3,{tc(t0 + .2)},{tc(t0 + dur)},Role,,0,0,0,,{{\\pos({x},{y + 62})\\fad(350,250)}}{role.upper()}")

def step_tag(a, t0, dur, num, label):
    x, y = 70, 64
    a.raw(box(x - 20, y - 14, 30 * len(label) * .78 + 118, 62, t0=t0, dur=dur))
    a.raw(f"Dialogue: 3,{tc(t0)},{tc(t0 + dur)},Step,,0,0,0,,{{\\pos({x},{y})\\fad(300,250)}}{{\\c{A_GOLD}}}{num}  {{\\c{A_IVORY}}}{label}")

def center_card(a, t0, dur, lines, y=150):
    a.raw(box(190, y - 56, 900, 112 + 62 * (len(lines) - 1), t0=t0, dur=dur, alpha="&H40&"))
    for i, ln in enumerate(lines):
        a.raw(f"Dialogue: 3,{tc(t0)},{tc(t0 + dur)},Big,,0,0,0,,{{\\pos({W // 2},{y + i * 62})\\fad(400,300)}}{ln}")

# ---- scene assembly ---------------------------------------------------------------
GRADE = ("eq=contrast=1.08:saturation=0.80:gamma=0.94,"
         "colorbalance=rs=.06:gs=.01:bs=-.08:rm=.05:bm=-.05:rh=.04:bh=-.06,"
         "curves=all='0/0.02 0.5/0.48 1/0.97',vignette=PI/5,noise=alls=5:allf=t")

def voice_chain(gain_db, dur):
    return (f"highpass=f=85,afftdn=nr=9:nf=-45,acompressor=threshold=-24dB:ratio=3:attack=8:release=120,"
            f"volume={gain_db}dB,afade=t=in:st=0:d=0.03,afade=t=out:st={dur - 0.03:.3f}:d=0.03")

def scene(name, dur, vid, aud, ass_path=None, frame=None, grade=False, gain_db=0, fade_in=.35, fade_out=.35, vid_kind="source"):
    """vid: (path, ss) ; aud: (path, ss) or None (silence)."""
    out = os.path.join(EDIT, f"scene_{name}.mp4")
    cmd = [FF, "-y", "-loglevel", "error"]
    if vid_kind == "source": cmd += ["-ss", f"{vid[1]:.3f}", "-t", f"{dur:.3f}", "-i", vid[0]]
    else: cmd += ["-i", vid[0]]
    if aud: cmd += ["-ss", f"{aud[1]:.3f}", "-t", f"{dur:.3f}", "-i", aud[0]]
    else: cmd += ["-f", "lavfi", "-t", f"{dur:.3f}", "-i", "anullsrc=r=48000:cl=stereo"]
    fi = 2
    if frame: cmd += ["-loop", "1", "-t", f"{dur:.3f}", "-i", frame]
    v = "[0:v]"
    if vid_kind == "source":
        v += f"scale=-2:{H}:flags=lanczos,crop={W}:{H},{GRADE if grade else 'null'}"
    else: v += "null"
    v += f",fps={FPS},format=yuv420p[v0]"
    fc = [v]; last = "[v0]"
    if frame:
        fc.append(f"{last}[2:v]overlay=0:0:format=auto[v1]"); last = "[v1]"
    fc.append(f"{last}fade=t=in:st=0:d={fade_in}:color=black,fade=t=out:st={dur - fade_out:.3f}:d={fade_out}:color=black[v2]"); last = "[v2]"
    if ass_path:  # captions/overlays LAST (Hard Rule 1)
        fc.append(f"{last}ass={ass_path}:fontsdir={FONTSDIR}[v3]"); last = "[v3]"
    if aud: fc.append(f"[1:a]aformat=sample_rates=48000:channel_layouts=stereo,{voice_chain(gain_db, dur)}[a]")
    else: fc.append("[1:a]anull[a]")
    cmd += ["-filter_complex", ";".join(fc), "-map", last, "-map", "[a]", "-t", f"{dur:.3f}",
            "-c:v", "libx264", "-crf", CRF, "-preset", "medium" if not PREVIEW else "veryfast", "-pix_fmt", "yuv420p", "-r", str(FPS),
            "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", out]
    sh(cmd); return out

# ---- loudness measure so all voices sit at the same level -------------------------
def loud(path, ss, dur):
    r = subprocess.run([FF, "-hide_banner", "-ss", str(ss), "-t", str(dur), "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True)
    lines = [l for l in r.stderr.splitlines() if "I:" in l and "LUFS" in l]
    return float(lines[-1].split("I:")[1].split("LUFS")[0])

def main():
    frame = make_frame()
    TARGET = -19.0
    gv = TARGET - loud(SRC_V, 21, 128)      # narration
    ga = TARGET - loud(SRC_A, 2, 95)        # Ms. Gordon
    print("voice gains dB: narration %.1f  gordon %.1f" % (gv, ga))
    cards = []
    render_card("title", 5.0, os.path.join(EDIT, "card_title.mp4"))
    render_card("end", 6.0, os.path.join(EDIT, "card_end.mp4"))

    scenes, tl = [], []           # tl: (scene name, start_in_output, duration)
    def add(name, dur, path): tl.append((name, sum(d for _, _, d in tl), dur)); scenes.append(path)

    # S0 cold open: stage B-roll, 1.5 s music-only lead-in then narration
    lead = 1.5; s0, s1 = 20.8, 31.2; dur = lead + (s1 - s0)
    m = os.path.join(EDIT, "m0.mp4"); render_montage(theater_pool(["01_empty_stage", "06_stage_lights"]), dur, m)
    a = Ass(s0, lead)
    a.cap(21.1, 22.3, "Every performance"); a.cap(22.8, 27.2, "begins with a simple promise: someone will watch, and someone will perform.")
    a.cap(27.9, 30.7, "But what happens when the audience becomes part of the show?"); a.write(os.path.join(EDIT, "s0.ass"))
    # narration delayed by `lead` via adelay inside a pre-cut wav
    pre = os.path.join(EDIT, "s0_voice.wav")
    sh([FF, "-y", "-loglevel", "error", "-ss", str(s0), "-t", str(s1 - s0), "-i", SRC_V, "-af", f"adelay={int(lead * 1000)}|{int(lead * 1000)},apad", "-t", str(dur), pre])
    add("00_cold_open", dur, scene("00_cold_open", dur, (m,), (pre, 0), os.path.join(EDIT, "s0.ass"), frame, gain_db=gv, vid_kind="raw"))
    add("01_title", 5.0, scene("01_title", 5.0, (os.path.join(EDIT, "card_title.mp4"),), None, None, fade_in=.01, fade_out=.3, vid_kind="raw"))

    # S2 setup (on camera)
    s0, s1 = 32.4, 50.9; dur = s1 - s0; a = Ass(s0)
    a.cap(32.7, 33.7, "I'm Pablo."); a.cap(35.2, 37.5, "I'm Emiliano."); a.cap(37.9, 42.4, "In this documentary, we explore how performances can include the people watching them.")
    a.cap(43.5, 50.3, "To start, we spoke with Ms. Angela Gordon, a teacher who recently watched Much Ado About Nothing by Shakespeare."); a.write(os.path.join(EDIT, "s2.ass"))
    add("02_setup", dur, scene("02_setup", dur, (SRC_V, s0), (SRC_V, s0), os.path.join(EDIT, "s2.ass"), frame, True, gv))

    # S3 interview clip 1 (answers 1-3)
    s0, s1 = 2.0, 43.0; dur = s1 - s0; a = Ass(s0)
    a.cap(2.4, 5.3, "Good morning, my name is Angela Gordon"); a.cap(5.3, 8.2, "and I will answer the eight questions you have here.")
    a.cap(8.8, 11.0, "What is the last performance you watched?", True); a.cap(11.0, 13.6, "I watched Much Ado About Nothing"); a.cap(14.0, 15.0, "by Shakespeare.")
    a.cap(15.6, 18.7, "Why did you choose to watch it?", True)
    a.cap(19.3, 22.7, "I decided to watch it because I needed to teach my students"); a.cap(23.1, 25.4, "about the different perceptions"); a.cap(25.7, 30.7, "people have about relationships, and the ones shown in the play.")
    a.cap(31.4, 33.3, "What did you expect before watching it?", True); a.cap(33.8, 36.5, "Well, since it is a Shakespeare"); a.cap(37.2, 40.4, "play, I expected to have something"); a.cap(40.8, 42.7, "very interesting, and in fact it is.")
    lower_third(a, s0 * 0 + 0.6, 6.5, "Ms. Angela Gordon", "Teacher"); a.write(os.path.join(EDIT, "s3.ass"))
    m = os.path.join(EDIT, "m3.mp4"); render_montage(theater_pool(["03_horseshoe", "02_auditorium", "04_elizabethan", "08_velvet", "05_curtains"]), dur, m)
    add("03_interview_1", dur, scene("03_interview_1", dur, (m,), (SRC_A, s0), os.path.join(EDIT, "s3.ass"), frame, gain_db=ga, vid_kind="raw"))

    # S4 narration 1
    s0, s1 = 53.8, 66.4; dur = s1 - s0; a = Ass(s0)
    a.cap(54.1, 57.4, "She chose the play to teach her students"); a.cap(57.9, 60.2, "about how people see relationships.")
    a.cap(60.6, 64.1, "And since it was Shakespeare, her expectations were high,"); a.cap(64.5, 65.9, "but did it keep her engaged?"); a.write(os.path.join(EDIT, "s4.ass"))
    add("04_narration_1", dur, scene("04_narration_1", dur, (SRC_V, s0), (SRC_V, s0), os.path.join(EDIT, "s4.ass"), frame, True, gv))

    # S5 interview clip 2 (answers 4-5)
    s0, s1 = 43.0, 53.95; dur = s1 - s0; a = Ass(s0)
    a.cap(43.3, 45.8, "What made you feel engaged during the performance?", True); a.cap(46.1, 50.5, "The different kinds of relationships that we could see there in the play.")
    a.cap(51.2, 52.3, "What made you lose interest?", True); a.cap(52.4, 53.5, "That it was very long."); a.write(os.path.join(EDIT, "s5.ass"))
    m = os.path.join(EDIT, "m5.mp4"); render_montage(theater_pool(["07_masks", "06_stage_lights"]), dur, m)
    add("05_interview_2", dur, scene("05_interview_2", dur, (m,), (SRC_A, s0), os.path.join(EDIT, "s5.ass"), frame, gain_db=ga, vid_kind="raw"))

    # S6 narration 2 + on-screen problem statement
    s0, s1 = 69.4, 82.2; dur = s1 - s0; a = Ass(s0)
    a.cap(69.8, 72.9, "She also lost interest when the play dragged on."); a.cap(73.3, 75.9, "That is where the audience can be invited in.")
    a.cap(76.5, 81.6, "Here's the problem: the relationships in the play kept her engaged, because the content mattered to her.")
    a.raw(box(190, 94, 900, 112, t0=.7, dur=7.2, alpha="&H40&"))
    a.raw(f"Dialogue: 3,{tc(.7)},{tc(7.9)},Big,,0,0,0,,{{\\an5\\pos({W // 2},150)\\fad(400,300)}}Long performance {{\\c{A_GOLD}\\fnDejaVu Serif}}→{{\\fnBitstream Charter\\c{A_IVORY}}} lost attention")
    a.write(os.path.join(EDIT, "s6.ass"))
    add("06_narration_2", dur, scene("06_narration_2", dur, (SRC_V, s0), (SRC_V, s0), os.path.join(EDIT, "s6.ass"), frame, True, gv))

    # S7 interview clip 3 (answers 6-8)
    s0, s1 = 54.0, 96.7; dur = s1 - s0; a = Ass(s0)
    a.cap(54.4, 58.8, "How do you feel about participating in a performance, if you were just attending as an audience?", True)
    a.cap(59.4, 63.3, "I feel interested because I like to see"); a.cap(64.0, 67.8, "what the play wants to transmit to us.")
    a.cap(68.4, 72.6, "Can a performance change the way people think or behave?", True); a.cap(73.1, 73.8, "Sure."); a.cap(74.2, 78.1, "It depends on how open-minded you are"); a.cap(78.5, 80.6, "to receive the message from a play.")
    a.cap(81.4, 84.0, "Where do you think the responsibility of an audience is?", True); a.cap(84.4, 85.7, "Well, as I said before,"); a.cap(86.2, 88.8, "to be open-minded and")
    a.cap(89.6, 92.6, "receive the message, and analyze,"); a.cap(93.0, 96.2, "and see the best things you can apply to your life. Thank you."); a.write(os.path.join(EDIT, "s7.ass"))
    m = os.path.join(EDIT, "m7.mp4"); render_montage(theater_pool(["05_curtains", "02_auditorium", "01_empty_stage", "03_horseshoe", "07_masks", "08_velvet"]), dur, m)
    add("07_interview_3", dur, scene("07_interview_3", dur, (m,), (SRC_A, s0), os.path.join(EDIT, "s7.ass"), frame, gain_db=ga, vid_kind="raw"))

    # S8 the solutions
    s0, s1 = 83.5, 139.5; dur = s1 - s0; a = Ass(s0)
    a.cap(83.9, 90.9, "Ms. Gordon believes the audience must be open-minded and analyze the message. But performers can help.")
    a.cap(92.7, 94.1, "First, pauses."); a.cap(94.6, 101.3, "When actors break the fourth wall and ask the audience what they think, or what should happen next, attention comes back.")
    a.cap(102.2, 113.1, "Second, a reason to participate. In a war performance, the audience could say how they feel. Ethical scenarios work the same way. People act on what they believe and"); a.cap(113.4, 114.8, "share their opinion.")
    a.cap(116.2, 123.4, "Third, making it normal. Numbered cards let anyone join without pressure. And presenting the audience"); a.cap(123.7, 125.4, "alongside the actors makes everyone feel included.")
    a.cap(126.0, 129.2, "Finally, preparation: acting classes and puppets"); a.cap(129.7, 132.6, "of their own give shy audience members"); a.cap(132.9, 134.5, "a safe way to take part,"); a.cap(135.2, 139.0, "and improvised performances can turn them into the performers.")
    t = lambda x: x - s0
    a.raw(box(W // 2 - 260, 96, 520, 100, t0=.3, dur=3.3, alpha="&H40&"))
    a.raw(f"Dialogue: 3,{tc(.3)},{tc(3.6)},Big,,0,0,0,,{{\\an5\\pos({W // 2},146)\\fad(400,400)}}THE {{\\c{A_GOLD}}}SOLUTIONS")
    for t0, t1, n, lab in ((92.5, 102.0, "01", "PAUSES"), (102.0, 115.5, "02", "A REASON TO PARTICIPATE"), (116.0, 125.8, "03", "MAKING IT NORMAL"), (125.8, 139.0, "04", "PREPARATION")):
        step_tag(a, t(t0), t1 - t0, n, lab)
    a.write(os.path.join(EDIT, "s8.ass"))
    add("08_solutions", dur, scene("08_solutions", dur, (SRC_V, s0), (SRC_V, s0), os.path.join(EDIT, "s8.ass"), frame, True, gv))

    # S8b second interview: Camilo Gonzalez (audio B), cut = intro 0-5 s + answers 22-133.7 s
    segs = [(0.0, 5.0), (22.0, 133.7)]; dur = sum(b - a_ for a_, b in segs)
    pre = os.path.join(EDIT, "s8b_voice.wav")
    parts = "".join(f"[0:a]atrim={a_}:{b}, asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.03,afade=t=out:st={b - a_ - .03:.3f}:d=0.03[c{i}];".replace(" ", "") for i, (a_, b) in enumerate(segs))
    sh([FF, "-y", "-loglevel", "error", "-i", SRC_B, "-filter_complex", parts + "[c0][c1]concat=n=2:v=0:a=1[o]", "-map", "[o]", pre])
    gb = TARGET - loud(pre, 0, dur)
    def cm(t): return t if t < 5.0 else t - 22.0 + 5.0        # source time -> clip time
    a = Ass(0.0); C = lambda t0, t1, txt, ask=False: a.cap(cm(t0), cm(t1), txt, ask)
    C(0.1, 4.7, "Hi everybody, today we're going to interview teacher Camilo Gonzalez.")
    C(22.2, 23.9, "Why did you choose to watch it?", True); C(24.1, 25.0, "I've seen it before,"); C(25.5, 27.5, "and the group is also…"); C(27.9, 29.0, "yeah, I'm familiar with it.")
    C(30.0, 35.5, "Both are incredible, the group is amazing and the play is also pretty good."); C(35.9, 39.3, "What do you expect from watching it?", True)
    C(41.7, 43.0, "I expected the same."); C(43.3, 45.3, "The same play I've watched at least"); C(46.1, 47.4, "three times before.")
    C(47.9, 57.1, "However, every time there is something different, something new. So I was expecting the same, but at the same time I was expecting something that I would try and identify,")
    C(57.2, 59.8, "like the change, like something new."); C(59.8, 63.2, "What made you feel engaged in the performance?", True)
    C(63.4, 70.5, "The music, all the music of the play, they play themselves with their own instruments. It's amazing. And the puppets, really good puppets.")
    C(71.0, 72.7, "What made you lose interest?", True); C(74.7, 82.4, "Nothing, honestly. I mean, the play is really good at keeping you engaged with the music, the songs, the puppets, the dynamics.")
    C(83.3, 88.5, "How do you feel about participating in a performance if you were just attending as an audience?", True); C(88.5, 92.1, "I actually participated once. I was part of the production team")
    C(92.5, 94.2, "for a play by a Chinese guy."); C(94.4, 96.2, "It was about the Tiananmen Square massacre."); C(96.9, 100.2, "and I was in charge of the soundboard and the subtitles.")
    C(102.4, 106.8, "Can a performance change the way people think or behave?", True); C(107.5, 110.2, "I once watched a play, it was called"); C(110.4, 113.4, "…")
    C(113.4, 119.6, "It was really good. And at the end of the play, I was essentially crying, and I even called my mom"); C(119.9, 123.4, "because the play is so sad.")
    C(123.8, 128.4, "And what do you think the responsibility of an audience is?", True); C(128.5, 130.0, "To pay attention"); C(130.2, 131.8, "and to respect the space."); C(132.3, 133.4, "That's it.")
    lower_third(a, .5, 6.0, "Camilo Gonzalez", "Teacher")
    a.raw(box(W // 2 - 300, 94, 600, 100, t0=.5, dur=3.6, alpha="&H40&"))
    a.raw(f"Dialogue: 3,{tc(.5)},{tc(4.1)},Big,,0,0,0,,{{\\an5\\pos({W // 2},144)\\fad(400,400)}}A {{\\c{A_GOLD}}}SECOND VOICE")
    a.write(os.path.join(EDIT, "s8b.ass"))
    m = os.path.join(EDIT, "m8b.mp4"); render_montage(theater_pool(["08_velvet", "06_stage_lights", "03_horseshoe", "07_masks", "02_auditorium", "04_elizabethan", "05_curtains", "01_empty_stage", "07_masks", "03_horseshoe"]), dur, m)
    add("08b_interview_camilo", dur, scene("08b_interview_camilo", dur, (m,), (pre, 0), os.path.join(EDIT, "s8b.ass"), frame, gain_db=gb, vid_kind="raw"))

    # S9 closing B-roll (slow zoom out) then end card
    s0, s1 = 141.0, 149.2; dur = s1 - s0; a = Ass(s0)
    a.cap(141.2, 143.4, "When both do their part,"); a.cap(143.4, 146.0, "a performance can change the way we think."); a.cap(146.0, 148.5, "Thank you, Ms. Gordon, and thank you for watching."); a.write(os.path.join(EDIT, "s9.ass"))
    m = os.path.join(EDIT, "m9.mp4"); render_montage(theater_pool(["01_empty_stage"]), dur, m, zoom_out=True)
    add("09_closing", dur, scene("09_closing", dur, (m,), (SRC_V, s0), os.path.join(EDIT, "s9.ass"), frame, gain_db=gv, vid_kind="raw"))
    add("10_end_card", 6.0, scene("10_end_card", 6.0, (os.path.join(EDIT, "card_end.mp4"),), None, None, fade_in=.01, fade_out=.01, vid_kind="raw"))

    # lossless concat (Hard Rule 2)
    lst = os.path.join(EDIT, "concat.txt"); open(lst, "w").write("".join(f"file '{p}'\n" for p in scenes))
    base = os.path.join(EDIT, "assembled.mp4"); sh([FF, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", base])
    total = sum(d for _, _, d in tl); print("assembled duration %.2f s" % total)
    json.dump({"scenes": [{"name": n, "start": s, "dur": d} for n, s, d in tl], "total": total}, open(os.path.join(EDIT, "timeline.json"), "w"), indent=1)

    # music bed + mix
    import music
    mus = os.path.join(EDIT, "music.wav"); music.make(mus, total, tl)
    final = os.path.join(EDIT, "preview.mp4" if PREVIEW else "final.mp4")
    sh([FF, "-y", "-loglevel", "error", "-i", base, "-i", mus, "-filter_complex",
        "[0:a]asplit=2[v1][v2];[1:a]volume=1.0[m];[m][v1]sidechaincompress=threshold=0.02:ratio=8:attack=30:release=500:makeup=1[md];"
        "[v2][md]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[a]",
        "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", final])
    print("wrote", final)

if __name__ == "__main__":
    main()
