from PIL import Image, ImageDraw, ImageFilter
import math

SIZE = 128
cx, cy = SIZE // 2, SIZE // 2

# Colors
BG_DARK   = (15, 30, 60)       # deep navy
RING_COL  = (0, 160, 200)      # cyan ring
NEEDLE_N  = (0, 220, 240)      # bright cyan (north needle)
NEEDLE_S  = (40, 80, 120)      # dim blue   (south needle)
TICK_COL  = (0, 180, 220, 180) # semi-transparent cyan ticks
CIRCUIT   = (0, 200, 230, 140) # circuit lines
DOT_COL   = (0, 240, 255)      # bright dot
GLOW_COL  = (0, 180, 220)

img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# --- Background circle ---
margin = 4
draw.ellipse([margin, margin, SIZE-margin, SIZE-margin], fill=BG_DARK + (255,))

# --- Outer ring ---
draw.ellipse([margin+2, margin+2, SIZE-margin-2, SIZE-margin-2],
             outline=RING_COL + (200,), width=2)

# --- Compass tick marks ---
r_outer = 54
r_inner_major = 46
r_inner_minor = 49
for i in range(16):
    angle = math.radians(i * 22.5)
    is_major = (i % 4 == 0)
    r_in = r_inner_major if is_major else r_inner_minor
    x1 = cx + r_in   * math.cos(angle)
    y1 = cy + r_in   * math.sin(angle)
    x2 = cx + r_outer * math.cos(angle)
    y2 = cy + r_outer * math.sin(angle)
    color = RING_COL + (230,) if is_major else RING_COL + (120,)
    draw.line([x1, y1, x2, y2], fill=color, width=2 if is_major else 1)

# --- Circuit pattern: small horizontal/vertical lines in inner area ---
circuit_pts = [
    # top-left quadrant trace
    (cx-28, cy-10, cx-16, cy-10),
    (cx-16, cy-10, cx-16, cy-22),
    # bottom-right quadrant trace
    (cx+16, cy+10, cx+28, cy+10),
    (cx+28, cy+10, cx+28, cy+22),
    # top-right
    (cx+16, cy-22, cx+16, cy-10),
    (cx+16, cy-10, cx+28, cy-10),
    # bottom-left
    (cx-28, cy+10, cx-16, cy+10),
    (cx-16, cy+10, cx-16, cy+22),
]
for x1, y1, x2, y2 in circuit_pts:
    draw.line([x1, y1, x2, y2], fill=CIRCUIT, width=1)

# small circuit dots
dot_positions = [
    (cx-16, cy-10), (cx+16, cy-10),
    (cx-16, cy+10), (cx+16, cy+10),
    (cx-28, cy-10), (cx+28, cy-10),
    (cx-28, cy+10), (cx+28, cy+10),
]
for dx, dy in dot_positions:
    r = 2
    draw.ellipse([dx-r, dy-r, dx+r, dy+r], fill=CIRCUIT)

# --- Compass needle ---
# North needle (bright cyan, pointing up)
north_tip   = (cx, cy - 36)
south_tip   = (cx, cy + 36)
wing_left   = (cx - 9, cy + 8)
wing_right  = (cx + 9, cy + 8)
wing_left_n = (cx - 7, cy - 8)
wing_right_n= (cx + 7, cy - 8)

# South half (dim)
draw.polygon([south_tip, wing_left, (cx,cy), wing_right], fill=NEEDLE_S + (200,))
# North half (bright)
draw.polygon([north_tip, wing_left_n, (cx,cy), wing_right_n], fill=NEEDLE_N + (255,))

# --- Center dot ---
r_dot = 5
draw.ellipse([cx-r_dot, cy-r_dot, cx+r_dot, cy+r_dot], fill=DOT_COL + (255,))
draw.ellipse([cx-2, cy-2, cx+2, cy+2], fill=BG_DARK + (255,))

# --- Subtle glow on needle tip (by compositing a blurred copy) ---
glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
gdraw = ImageDraw.Draw(glow)
gdraw.ellipse([cx-8, cy-44, cx+8, cy-28], fill=GLOW_COL + (120,))
glow = glow.filter(ImageFilter.GaussianBlur(radius=5))
img = Image.alpha_composite(img, glow)

out_path = "media/icon.png"
img.save(out_path, "PNG")
print(f"Saved {out_path} ({SIZE}x{SIZE})")
