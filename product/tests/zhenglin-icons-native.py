"""Read-only native decoding + previews of generated Zhenglin Soup archive art.

Run the Rust archive::portrait tests with PIXEL_MIX_ZHENGLIN_ICON_OUTPUT first.
This script creates PNG/JSON evidence only. No registry, Shell windows or app
processes are launched or changed; Explorer display remains a separate check.
"""
from pathlib import Path
import argparse
import ctypes as C
import hashlib
import importlib.util
import json
import struct
import sys

from PIL import Image, ImageDraw


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', type=Path, default=Path(__file__).resolve().parents[1] / 'evidence/zhenglin-soup-icons/preview')
    args = parser.parse_args()
    output = args.directory.resolve()
    meta = json.loads((output / 'portrait.json').read_text(encoding='utf-8'))
    source = Path(meta['archive'])
    icon = (output / 'zhenglin-soup.ico').read_bytes()
    spec = importlib.util.spec_from_file_location('archive_native', Path(__file__).with_name('archive-icons-native.py'))
    native = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(native)
    assert struct.calcsize('P') == 8, 'Run with the bundled 64-bit Python'
    extract = C.windll.user32.PrivateExtractIconsW
    extract.argtypes = [C.c_wchar_p, C.c_int, C.c_int, C.c_int, C.POINTER(C.c_void_p), C.POINTER(C.c_uint), C.c_uint, C.c_uint]
    extract.restype = C.c_uint
    C.windll.user32.DestroyIcon.argtypes = [C.c_void_p]
    rows = []
    opened = Image.open(output / 'zhenglin-soup.ico')
    assert opened.ico.sizes() == {(n,n) for n in meta['sizes']}
    for n in meta['sizes']:
        expected = opened.ico.getimage((n,n)).convert('RGBA')
        expected.save(output / f'zhenglin-soup-{n}.png')
        raw = output / f'zhenglin-soup-{n}.rgba'
        if raw.exists():
            assert expected.tobytes() == raw.read_bytes(), f'ICO encoding differs from renderer at {n}'
        handle, index = C.c_void_p(), C.c_uint()
        count = extract(str(source), 0, n, n, C.byref(handle), C.byref(index), 1, 0)
        assert count == 1 and handle.value, f'Native extraction failed at {n}'
        try:
            dimensions = native.icon_dimensions(handle)
            actual = native.icon_pixels(handle, n)
            expected_bgra = expected.tobytes('raw', 'BGRA')
            assert dimensions == [n,n]
            assert actual == expected_bgra, f'Native HICON differs at {n}'
            Image.frombytes('RGBA', (n,n), actual, 'raw', 'BGRA').save(output / f'zhenglin-soup-native-{n}.png')
            rows.append({'size':n,'actual_hicon_size':dimensions,'pixel_sha256':hashlib.sha256(actual).hexdigest(),'matches_production_pixels':True})
        finally:
            C.windll.user32.DestroyIcon(handle)
    drag = native.drag_bitmap(native.single_frame(icon,64))
    for variant in ['no-foam','no-peel']:
        image = Image.open(output / f'zhenglin-soup-{variant}.ico').ico.getimage((256,256)).convert('RGBA')
        image.save(output / f'zhenglin-soup-{variant}.png')
    sheet = Image.new('RGB',(1024,420),'#101721')
    draw = ImageDraw.Draw(sheet)
    for index,n in enumerate([16,32,48,256]):
        frame = Image.open(output / f'zhenglin-soup-{n}.png').convert('RGBA')
        enlarged = frame.resize((256,256),Image.Resampling.NEAREST)
        sheet.paste(enlarged,(index*256,24),enlarged)
        draw.text((index*256+12,8),f'{n}px source / nearest enlargement',fill='#e2e9e5')
        if n<256:
            sheet.paste(frame,(index*256+120,304),frame)
            draw.text((index*256+70,370),'Actual native size',fill='#a8bbbf')
    sheet.save(output / 'zhenglin-soup-contact-sheet.png')
    result = {'runtime':{'executable':sys.executable,'pointer_bits':struct.calcsize('P')*8},'archive':str(source),'frames':rows,'wic_drag_64':drag,'read_only_native_checks':True,'explorer_visible_icons_verified':False,'note':'Offscreen file decoding and HICON pixel equivalence only; physical Explorer drag/display is verified separately by the root task.'}
    (output / 'native-verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'frames_passed':len(rows),'wic_drag':True,'preview':str(output / 'zhenglin-soup-contact-sheet.png')},ensure_ascii=False))


if __name__ == '__main__':
    main()
