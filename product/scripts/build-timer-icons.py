"""Build high-DPI TIMER icons from the user's original logo, never from 32px ICO.

Requires Pillow (build tooling only). The original 1080px source stays unchanged.
All frame sizes are independently sampled from the original alpha silhouette.
"""
from io import BytesIO
from pathlib import Path
import hashlib
import json
import struct
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'apps/client/public/assets/timer-logo.png'
DEST = ROOT / 'apps/client/src-tauri/icons'
# tauri-codegen 2.6.3 decodes ICO entry zero for the live HWND icon rather
# than selecting its largest frame. Keep a full-resolution first frame: putting
# 16px first made the taskbar scale that tiny image up, despite a 256px resource.
SIZES = (256, 16, 24, 32, 48, 64, 96, 128)


def render(size):
    alpha = Image.open(SOURCE).convert('RGBA').getchannel('A')
    alpha = alpha.crop(alpha.getbbox())
    # The dark tile preserves contrast on light wallpaper; the supplied TIMER
    # silhouette is unchanged. Small frames have deliberately aligned padding.
    tile = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(tile)
    corner = max(1, size // 16)
    points = [(corner, 0), (size-corner-1, 0), (size-1, corner),
              (size-1, size-corner-1), (size-corner-1, size-1),
              (corner, size-1), (0, size-corner-1), (0, corner)]
    draw.polygon(points, fill='#08141b', outline='#52717c')
    padding = max(2, round(size * 0.11))
    inside = size - 2 * padding
    mask = alpha.resize((inside, inside), Image.Resampling.LANCZOS)
    tile.paste((241, 245, 236, 255), (padding, padding), mask)
    return tile


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    directory = bytearray(struct.pack('<HHH', 0, 1, len(SIZES)))
    images = []
    offset = 6 + 16 * len(SIZES)
    for size in SIZES:
        stream = BytesIO()
        render(size).save(stream, format='PNG', optimize=True)
        data = stream.getvalue()
        directory += struct.pack('<BBBBHHII', size % 256, size % 256, 0, 0, 1, 32, len(data), offset)
        images.append(data)
        offset += len(data)
    icon = bytes(directory) + b''.join(images)
    (DEST / 'icon.ico').write_bytes(icon)
    render(256).save(DEST / 'icon.png')
    print(json.dumps({'source': str(SOURCE), 'sizes': SIZES, 'bytes': len(icon),
                      'sha256': hashlib.sha256(icon).hexdigest()}, ensure_ascii=False))


if __name__ == '__main__':
    main()
