from PIL import Image, ImageDraw
import math
import os

S = 1024  # supersample size
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")

ACCENT_DARK = (15, 110, 75, 255)    # #0f6e4b
ACCENT_LIGHT = (51, 221, 154, 255)  # #33dd9a
WHITE = (255, 255, 255, 255)

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(4))

def make_gradient(size, c1, c2):
    """Diagonal linear gradient top-left (c1) to bottom-right (c2)."""
    grad = Image.new("RGBA", (size, size))
    px = grad.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * size)
            px[x, y] = lerp(c1, c2, t)
    return grad

def thick_line(draw, p1, p2, width, fill):
    draw.line([p1, p2], fill=fill, width=width)
    r = width / 2
    for (cx, cy) in (p1, p2):
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)

def build_master():
    canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # Badge: gradient-filled circle
    grad = make_gradient(S, ACCENT_DARK, ACCENT_LIGHT)
    mask = Image.new("L", (S, S), 0)
    mdraw = ImageDraw.Draw(mask)
    pad = 22
    mdraw.ellipse([pad, pad, S - pad, S - pad], fill=255)
    canvas.paste(grad, (0, 0), mask)

    draw = ImageDraw.Draw(canvas)

    stroke_w = 78
    # Vertical bar of the K
    bar_x0, bar_x1 = 322, 322 + stroke_w
    bar_y0, bar_y1 = 268, 756
    draw.rounded_rectangle([bar_x0, bar_y0, bar_x1, bar_y1], radius=stroke_w // 2, fill=WHITE)

    meet = (bar_x1 - 6, 512)
    upper_end = (742, 274)
    lower_end = (742, 750)
    thick_line(draw, meet, upper_end, stroke_w, WHITE)
    thick_line(draw, meet, lower_end, stroke_w, WHITE)

    # Ball at the tip of the upper stroke, mid-motion off the K
    ball_r = 74
    bx, by = upper_end
    draw.ellipse([bx - ball_r, by - ball_r, bx + ball_r, by + ball_r], fill=WHITE)
    # simple pentagon seam mark, abstracted for legibility at small sizes
    seam_r = 24
    pts = []
    for i in range(5):
        ang = -math.pi / 2 + i * (2 * math.pi / 5)
        pts.append((bx + seam_r * math.cos(ang), by + seam_r * math.sin(ang)))
    draw.polygon(pts, fill=ACCENT_DARK)
    # motion trail: two short arcs behind the ball
    for i, r in enumerate((118, 150)):
        bbox = [bx - r, by - r, bx + r, by + r]
        draw.arc(bbox, start=95, end=140, fill=(255, 255, 255, 130 - i * 40), width=14)

    return canvas

def export(master, size, path, background=None):
    img = master.resize((size, size), Image.LANCZOS)
    if background is not None:
        bg = Image.new("RGBA", (size, size), background)
        bg.paste(img, (0, 0), img)
        img = bg
    img.save(path)

master = build_master()
master.save(f"{OUT_DIR}/logo-master.png")

export(master, 512, f"{OUT_DIR}/icon-512.png")
export(master, 192, f"{OUT_DIR}/icon-192.png")
export(master, 180, f"{OUT_DIR}/apple-touch-icon.png", background=(16, 16, 18, 255))
export(master, 32, f"{OUT_DIR}/favicon-32.png")
export(master, 16, f"{OUT_DIR}/favicon-16.png")
export(master, 256, f"{OUT_DIR}/logo-256.png")

print("done")
