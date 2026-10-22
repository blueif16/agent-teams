"""Stitches smart.mp4 clips into short per-feature reels: a title card, then each clip with a caption pill.
Clips longer than MAX_S play faster (up to 3x) so a reel stays short.
Usage: scripts/promo/.venv/bin/python scripts/promo/reels.py [reel-slug ...]   → promo-assets/reels/<n>-<slug>.mp4"""
import json, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "promo-assets")
OUT = os.path.join(ROOT, "reels")
W, H, FPS, TITLE_S, MAX_S = 1920, 1080, 60, 1.6, 7.0
FONT = "/System/Library/Fonts/SFNS.ttf"

REELS = [
    ("build-a-team", "Ask for a team, get one", [
        ("team-choice.proposal", "One sentence in, three staffed teams out"),
        ("staffing.skills-library", "Every agent comes with skills"),
        ("rive-status.channel-header", "See who's working at a glance"),
        ("reactive.live-channel", "Reports stream in live"),
    ]),
    ("reactions", "Reactions are orders", [
        ("reactions.hover-bar", "Quick orders on every message"),
        ("reactions.go-ahead", "Thumbs up: go ahead"),
        ("reactions.redo", "Redo: send it back"),
        ("reactions.remember", "Pin: remember this from now on"),
        ("reactions.hold-rive", "Hold: the agent stops"),
    ]),
    ("pm-and-stats", "A PM runs the work", [
        ("pm.plan-live", "The plan moves as work lands"),
        ("pm.task-drawer", "Every task: owner, criteria, evidence"),
        ("pm.decisions", "Every call, with its reason"),
        ("stats.team-performance", "Spend and tokens, per agent"),
        ("stats.mira-chart", "Ask Mira how teams are doing"),
    ]),
    ("safe-and-learning", "Safe by default, better every run", [
        ("permissions.plain-words", "Set permissions in plain words"),
        ("permissions.auto-approve", "Approve once, never asked again"),
        ("permissions.blocked-secret", "Secrets never leave"),
        ("soul-memory.history", "Agents keep a versioned memory"),
        ("soul-memory.project-retro", "Each project rewrites the playbook"),
        ("soul-memory.designer-evolution", "Better work every run"),
    ]),
]


def font(size, weight):
    f = ImageFont.truetype(FONT, size)
    f.set_variation_by_name(weight)
    return f


def title_card(path, title):
    im = Image.new("RGB", (W, H), (247, 247, 248))
    d = ImageDraw.Draw(im)
    eyebrow, big = font(38, "Medium"), font(104, "Semibold")
    d.text((W / 2, H / 2 - 92), "Agent Teams", font=eyebrow, fill=(110, 110, 120), anchor="mm")
    d.text((W / 2, H / 2 + 10), title, font=big, fill=(20, 20, 24), anchor="mm")
    im.save(path)


def caption(path, text):
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    f = font(44, "Semibold")
    l, t, r, b = d.textbbox((0, 0), text, font=f)
    pw, ph = r - l + 72, 92
    x0, y0 = (W - pw) / 2, H - ph - 56
    d.rounded_rectangle((x0, y0, x0 + pw, y0 + ph), radius=ph / 2, fill=(17, 17, 20, 225))
    d.text((W / 2, y0 + ph / 2), text, font=f, fill=(255, 255, 255), anchor="mm")
    im.save(path)


def duration(path):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]))


def build(n, slug, title, clips):
    tmp = os.path.join(OUT, ".cards")
    os.makedirs(tmp, exist_ok=True)
    title_card(os.path.join(tmp, f"{slug}-title.png"), title)
    args = ["-loop", "1", "-framerate", str(FPS), "-t", str(TITLE_S), "-i", os.path.join(tmp, f"{slug}-title.png")]
    graph = [f"[0:v]format=yuv420p,setsar=1,fade=in:st=0:d=0.25[s0]"]
    total = TITLE_S
    for i, (cid, text) in enumerate(clips, start=1):
        src = os.path.join(ROOT, "effects", cid, "smart.mp4")
        speed = min(3.0, max(1.0, duration(src) / MAX_S))
        total += duration(src) / speed
        cap = os.path.join(tmp, f"{slug}-{i}.png")
        caption(cap, text)
        args += ["-i", src, "-loop", "1", "-framerate", str(FPS), "-i", cap]
        v, c = 2 * i - 1, 2 * i
        graph.append(f"[{v}:v]setpts=PTS/{speed:.3f},fps={FPS},scale={W}:{H},setsar=1[v{i}]")
        graph.append(f"[{c}:v]format=rgba,fade=in:st=0.15:d=0.25:alpha=1[c{i}]")
        graph.append(f"[v{i}][c{i}]overlay=0:0:shortest=1,format=yuv420p[s{i}]")
    n_seg = len(clips) + 1
    graph.append("".join(f"[s{i}]" for i in range(n_seg)) + f"concat=n={n_seg}:v=1:a=0,fade=out:st={total - 0.35:.3f}:d=0.35[out]")
    dst = os.path.join(OUT, f"{n}-{slug}.mp4")
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", *args, "-filter_complex", ";".join(graph), "-map", "[out]",
                    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", dst], check=True)
    print(f"  {dst}  {total:.1f} s")


if __name__ == "__main__":
    pick = sys.argv[1:]
    for n, (slug, title, clips) in enumerate(REELS, start=1):
        if not pick or slug in pick:
            build(n, slug, title, clips)
