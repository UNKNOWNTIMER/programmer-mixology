"""Read-only Windows decoding of all generated DLC archives; no Shell mutation.

The Rust portrait tests emit native-art-manifest.json with
PIXEL_MIX_DLC_ART_OUTPUT=<absolute evidence path>. This script verifies real
HICON pixels against embedded ICO frames and creates inspection PNGs. Explorer
display and physical OLE drag/drop are separate acceptance checks.
"""
from pathlib import Path
import argparse
import ctypes as C
import hashlib
import importlib.util
import json
import struct
import sys
from PIL import Image, ImageDraw, ImageFont


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', type=Path, default=Path(__file__).resolve().parents[1] / 'evidence/xiaodong-art/icons')
    output = parser.parse_args().directory.resolve()
    manifest = json.loads((output / 'native-art-manifest.json').read_text(encoding='utf-8'))
    assert len(manifest['rows']) == 96
    spec = importlib.util.spec_from_file_location('archive_native', Path(__file__).with_name('archive-icons-native.py'))
    native = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(native)
    assert struct.calcsize('P') == 8
    extract = C.windll.user32.PrivateExtractIconsW
    extract.argtypes = [C.c_wchar_p, C.c_int, C.c_int, C.c_int, C.POINTER(C.c_void_p), C.POINTER(C.c_uint), C.c_uint, C.c_uint]
    extract.restype = C.c_uint
    C.windll.user32.DestroyIcon.argtypes = [C.c_void_p]
    font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 12)
    sheet = Image.new('RGB', (1280, 12 * 176), '#08121b')
    draw = ImageDraw.Draw(sheet)
    results = []
    focus = {0,11,23,24,30,31,42,51,52,55,82,83,84,85,86,95}
    for ordinal, row in enumerate(manifest['rows']):
        source = Path(row['archive'])
        ico = Path(row['ico'])
        opened = Image.open(ico)
        assert opened.ico.sizes() == {(n,n) for n in row['sizes']}
        frames = []
        for n in row['sizes']:
            expected = opened.ico.getimage((n,n)).convert('RGBA')
            handle, index = C.c_void_p(), C.c_uint()
            count = extract(str(source), 0, n, n, C.byref(handle), C.byref(index), 1, 0)
            assert count == 1 and handle.value, f'Native extraction failed: {source.name} at {n}'
            try:
                dimensions = native.icon_dimensions(handle)
                actual = native.icon_pixels(handle, n)
                assert dimensions == [n,n]
                assert actual == expected.tobytes('raw', 'BGRA'), f'HICON pixel mismatch: {source.name} at {n}'
                frames.append({'size':n, 'matches_embedded_pixels':True, 'pixel_sha256':hashlib.sha256(actual).hexdigest()})
            finally:
                C.windll.user32.DestroyIcon(handle)
            if n == 256:
                expected.save(output / f"{row['recipe_id']}.png")
        drag = native.drag_bitmap(native.single_frame(ico.read_bytes(),64))
        x, y = (ordinal % 8) * 160, (ordinal // 8) * 176
        tile = opened.ico.getimage((128,128)).convert('RGBA')
        sheet.paste(tile, (x+16,y+3), tile)
        draw.text((x+8,y+132), f'{ordinal+1:02d} {row["name_zh"][:10]}', font=font, fill='#c5d4cf')
        draw.text((x+8,y+151), row['name_en'][:22], font=font, fill='#779d9e')
        if ordinal in focus:
            detailed = Image.new('RGB',(1024,326),'#08121b')
            detail_draw = ImageDraw.Draw(detailed)
            for col,n in enumerate([16,32,48,256]):
                small = opened.ico.getimage((n,n)).convert('RGBA')
                large = small.resize((256,256),Image.Resampling.NEAREST)
                detailed.paste(large,(col*256,22),large)
                detail_draw.text((col*256+10,4),f'{n}px native frame / nearest scale',font=font,fill='#c5d4cf')
                if n<256:detailed.paste(small,(col*256+(256-n)//2,286),small)
            detailed.save(output / f"{row['recipe_id']}-sizes.png")
        results.append({'recipe_id':row['recipe_id'],'archive':str(source),'frames':frames,'wic_drag_64':drag})
    sheet.save(output / 'all-96-native-icons.png')
    result={'runtime':{'executable':sys.executable,'pointer_bits':struct.calcsize('P')*8},'recipes':len(results),'native_frames':sum(len(r['frames']) for r in results),'read_only_native_checks':True,'explorer_verified':False,'physical_ole_verified':False,'results':results}
    (output / 'native-verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'recipes':len(results),'native_frames':result['native_frames'],'wic_drag_64':len(results),'sheet':str(output / 'all-96-native-icons.png')},ensure_ascii=False))


if __name__ == '__main__':
    main()
