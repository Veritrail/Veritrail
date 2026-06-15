"""Pillow-rendered PNG charts for the weekly digest email.

Email clients (Gmail, Outlook) strip SVG/JS, so charts ship as PNGs embedded
inline via Content-ID. Arcs/diagonals are supersampled then downscaled with
LANCZOS for smooth edges; axis-aligned bars are drawn at final resolution.
"""
from __future__ import annotations

import io

from PIL import Image, ImageDraw, ImageFont

SEV_ORDER = ("critical", "high", "medium", "low")
SEV_COLORS = {"critical": "#ef4444", "high": "#f97316", "medium": "#f59e0b", "low": "#10b981"}
NEW_COLOR = "#f97316"
RESOLVED_COLOR = "#22c55e"
INK = "#0f172a"
MUTED = "#94a3b8"
GRID = "#e9edf3"
WHITE = "#ffffff"


def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    try:
        return ImageFont.load_default(size=size)  # Pillow >= 10.1 — scalable default
    except TypeError:  # pragma: no cover - very old Pillow
        return ImageFont.load_default()


def _png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def _text_centered(d: ImageDraw.ImageDraw, cx: float, cy: float, text: str, font, fill: str) -> None:
    l, t, r, b = d.textbbox((0, 0), text, font=font)
    d.text((cx - (r - l) / 2 - l, cy - (b - t) / 2 - t), text, font=font, fill=fill)


OTHER_COLOR = "#cbd5e1"


def donut_png(counts: dict[str, int], size: int = 220, hole: float = 0.60, total: int | None = None) -> bytes:
    """Severity donut. ``total`` is the true open-findings count shown in the
    center; any surplus over the four severities is drawn as a grey 'other'
    segment (info/hygiene findings) so the ring and the headline number agree."""
    ss = 4
    W = size * ss
    img = Image.new("RGB", (W, W), WHITE)
    d = ImageDraw.Draw(img)
    seg = sum(counts.get(s, 0) for s in SEV_ORDER)
    total = seg if total is None else total
    other = max(0, total - seg)
    ring_total = seg + other
    box = [W * 0.05, W * 0.05, W * 0.95, W * 0.95]
    if ring_total <= 0:
        d.ellipse(box, fill="#e5e7eb")
    else:
        start = -90.0
        segments = [(counts.get(s, 0), SEV_COLORS[s]) for s in SEV_ORDER] + [(other, OTHER_COLOR)]
        for c, color in segments:
            if c <= 0:
                continue
            sweep = c / ring_total * 360.0
            # tiny overlap avoids hairline gaps between segments after downscale
            d.pieslice(box, start - 0.6, start + sweep + 0.6, fill=color)
            start += sweep
    cx = W / 2
    r = (W * 0.45) * hole
    d.ellipse([cx - r, cx - r, cx + r, cx + r], fill=WHITE)
    img = img.resize((size, size), Image.LANCZOS)

    d2 = ImageDraw.Draw(img)
    _text_centered(d2, size / 2, size / 2 - size * 0.045, str(total), _font(int(size * 0.20)), INK)
    _text_centered(d2, size / 2, size / 2 + size * 0.14, "Total", _font(int(size * 0.075)), MUTED)
    return _png_bytes(img)


def sparkline_png(series: list[float], w: int = 240, h: int = 64, color: str = "#ef4444", fill: str = "#fde2e2") -> bytes:
    ss = 3
    W, H = w * ss, h * ss
    img = Image.new("RGB", (W, H), WHITE)
    d = ImageDraw.Draw(img)
    pts_src = list(series) if len(series) >= 2 else (list(series) * 2 if series else [0, 0])
    mn, mx = min(pts_src), max(pts_src)
    rng = (mx - mn) or 1
    pad = H * 0.16
    n = len(pts_src)
    pts = []
    for i, v in enumerate(pts_src):
        x = pad + i / (n - 1) * (W - 2 * pad)
        y = H - pad - ((v - mn) / rng) * (H - 2 * pad)
        pts.append((x, y))
    d.polygon([*pts, (pts[-1][0], H), (pts[0][0], H)], fill=fill)
    d.line(pts, fill=color, width=ss * 2, joint="curve")
    for (x, y) in (pts[-1],):
        rr = ss * 3
        d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=color)
    return _png_bytes(img.resize((w, h), Image.LANCZOS))


def grouped_bars_png(labels: list[str], new_vals: list[int], resolved_vals: list[int], w: int = 500, h: int = 330) -> bytes:
    """Per-day New (orange) vs Resolved (green) grouped bars. Fonts scale with
    height so the chart stays legible when displayed at 2x in a narrow column."""
    img = Image.new("RGB", (w, h), WHITE)
    d = ImageDraw.Draw(img)
    label_font = _font(max(13, int(h * 0.075)))
    value_font = _font(max(11, int(h * 0.058)))
    lab_gap = int(h * 0.085)
    val_gap = int(h * 0.045)

    pad_l, pad_r, pad_t, pad_b = int(w * 0.02), int(w * 0.02), int(h * 0.10), int(h * 0.13)
    plot_w = w - pad_l - pad_r
    base_y = h - pad_b
    top_y = pad_t
    n = max(len(labels), 1)
    peak = max([*new_vals, *resolved_vals, 1])

    d.line([(pad_l, base_y), (w - pad_r, base_y)], fill=GRID, width=max(1, int(h / 130)))

    group_w = plot_w / n
    bar_w = min(group_w * 0.30, w * 0.045)
    gap = group_w * 0.10
    for i, lab in enumerate(labels):
        gx = pad_l + i * group_w + group_w / 2
        nv = new_vals[i] if i < len(new_vals) else 0
        rv = resolved_vals[i] if i < len(resolved_vals) else 0
        for j, (val, col) in enumerate(((nv, NEW_COLOR), (rv, RESOLVED_COLOR))):
            bh = (val / peak) * (base_y - top_y)
            x0 = gx + (j - 1) * (bar_w + gap) + gap / 2
            x1 = x0 + bar_w
            y0 = base_y - bh
            d.rounded_rectangle([x0, y0, x1, base_y], radius=min(4, bar_w / 2), fill=col)
            if val:
                _text_centered(d, (x0 + x1) / 2, y0 - val_gap, str(val), value_font, "#64748b")
        _text_centered(d, gx, base_y + lab_gap, lab, label_font, MUTED)
    return _png_bytes(img)
