"""Render the 32 representative designs from real exported .timermix (or legacy .pixelmix) containers.

Uses only the archive's ICO prefix; it does not regenerate or simulate portraits.
"""
import argparse
import json
from io import BytesIO
from pathlib import Path
from PIL import Image, ImageDraw


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('manifest', type=Path)
    args = parser.parse_args()
    document = json.loads(args.manifest.read_text(encoding='utf-8'))
    chosen = {}
    for recipe in document['recipes']:
        chosen.setdefault(recipe['design'], recipe)
    assert len(chosen) == 32
    canvas = Image.new('RGB', (960, 1056), '#08141b')
    draw = ImageDraw.Draw(canvas)
    for index, (design, recipe) in enumerate(sorted(chosen.items())):
        x, y = index % 4 * 240, index // 4 * 132
        icon = Image.open(BytesIO(Path(recipe['path']).read_bytes()))
        icon.size = (64, 64)
        tile = icon.ico.getimage((64, 64)).convert('RGBA')
        canvas.paste(tile, (x + 88, y + 6), tile)
        draw.text((x + 12, y + 78), design.upper(), fill='#b7d7d7')
        draw.text((x + 12, y + 98), recipe['name_en'][:33], fill='#afbdc2')
        draw.line((x + 12, y + 125, x + 228, y + 125), fill='#263e47')
    dest = args.manifest.parent / '32-designs.png'
    canvas.save(dest)
    print(json.dumps({'output': str(dest), 'designs': len(chosen), 'source_files': len(document['recipes'])}))


if __name__ == '__main__':
    main()
