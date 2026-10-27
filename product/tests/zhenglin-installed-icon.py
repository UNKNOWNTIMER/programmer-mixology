"""Read-only Shell/WIC checks on the actual normal-library native export."""
from pathlib import Path
import ctypes as C
import hashlib
import importlib.util
import json

from PIL import Image

product = Path(__file__).resolve().parents[1]
output = product / 'evidence/zhenglin-soup/install'
installation = json.loads((output / 'installation.json').read_text(encoding='utf-8'))
archive = Path(installation['archive']['path'])
data = archive.read_bytes()
assert hashlib.sha256(data).hexdigest() == installation['archive']['sha256']
spec = importlib.util.spec_from_file_location('native_icons', Path(__file__).with_name('archive-icons-native.py'))
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)
extract = C.windll.user32.PrivateExtractIconsW
extract.argtypes = [C.c_wchar_p, C.c_int, C.c_int, C.c_int, C.POINTER(C.c_void_p), C.POINTER(C.c_uint), C.c_uint, C.c_uint]
extract.restype = C.c_uint
C.windll.user32.DestroyIcon.argtypes = [C.c_void_p]
assert C.windll.ole32.CoInitializeEx(None, 2) >= 0
try:
    image = Image.open(archive)
    sizes = [16,24,32,48,64,128,256]
    assert image.ico.sizes() == {(n,n) for n in sizes}
    rows = []
    for size in sizes:
        expected = image.ico.getimage((size,size)).convert('RGBA')
        handle, index = C.c_void_p(), C.c_uint()
        assert extract(str(archive), 0, size, size, C.byref(handle), C.byref(index), 1, 0) == 1
        assert handle.value
        try:
            pixels = native.icon_pixels(handle, size)
            assert native.icon_dimensions(handle) == [size,size]
            assert pixels == expected.tobytes('raw','BGRA')
            rows.append({'size':size,'matches_embedded_pixels':True})
            if size == 32:
                shell = native.shell_icon_digest(archive, pixels, output)
                assert shell['matches_direct_extraction'], shell
        finally:
            C.windll.user32.DestroyIcon(handle)
    image.ico.getimage((256,256)).save(output / 'zhenglin-soup-icon.png')
    drag = native.drag_bitmap(native.single_frame(data))
    report = {'archive':str(archive),'frames':rows,'shell':shell,'wic_drag':drag,
              'read_only':True,'physical_explorer_drag_verified':False}
    (output / 'windows-icon-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'frames_passed':len(rows),'shell_matches_embedded_icon':True,'wic_drag_bitmap':True}))
finally:
    C.windll.ole32.CoUninitialize()
