"""Read-only inspection of live Windows HWND icons; no UI or registry mutation.

Example (use the bundled 64-bit Python):
  window-icons-native.py --pid 1234 --output evidence/window-icons.json --expect-min-size 256

WM_GETICON returns borrowed HICONs: this script never destroys those handles.
GetIconInfo-created bitmap copies and this script's own GDI objects are released.
"""
import argparse
import ctypes as C
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
from PIL import Image

spec = importlib.util.spec_from_file_location('icon_pixels', Path(__file__).with_name('archive-icons-native.py'))
pixels = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pixels)
P, U, I = pixels.P, pixels.U, pixels.I
SIZE = C.c_size_t
user, gdi = C.windll.user32, C.windll.gdi32


def configure():
    user.IsWindow.argtypes, user.IsWindowVisible.argtypes = [P], [P]
    user.GetWindowThreadProcessId.argtypes = [P, C.POINTER(U)]
    user.GetWindowTextW.argtypes = [P, C.c_wchar_p, I]
    user.GetClassNameW.argtypes = [P, C.c_wchar_p, I]
    user.GetClassLongPtrW.argtypes, user.GetClassLongPtrW.restype = [P, I], SIZE
    user.GetDpiForWindow.argtypes, user.GetDpiForWindow.restype = [P], U
    user.SendMessageTimeoutW.argtypes = [P, U, SIZE, C.c_ssize_t, U, U, C.POINTER(SIZE)]
    user.SendMessageTimeoutW.restype = C.c_ssize_t
    user.GetIconInfo.argtypes = [P, C.POINTER(pixels.ICONINFO)]
    gdi.GetObjectW.argtypes = [P, I, P]
    gdi.CreateCompatibleDC.argtypes, gdi.CreateCompatibleDC.restype = [P], P
    gdi.GetDIBits.argtypes = [P, P, U, U, P, P, U]
    gdi.DeleteObject.argtypes, gdi.DeleteDC.argtypes = [P], [P]


def raw_colour_bitmap(icon):
    info, bitmap = pixels.ICONINFO(), pixels.BITMAP()
    if not user.GetIconInfo(icon, C.byref(info)):
        raise RuntimeError('GetIconInfo failed')
    dc = None
    try:
        if not info.colour:
            return {'monochrome': True}, None
        assert gdi.GetObjectW(info.colour, C.sizeof(bitmap), C.byref(bitmap))
        width, height = bitmap.width, abs(bitmap.height)
        assert 1 <= width <= 4096 and 1 <= height <= 4096, (width, height)
        header = pixels.BITMAPINFOHEADER(C.sizeof(pixels.BITMAPINFOHEADER), width, -height, 1, 32, 0, width*height*4, 0, 0, 0, 0)
        storage = (C.c_ubyte * (width*height*4))()
        dc = gdi.CreateCompatibleDC(None)
        assert dc
        assert gdi.GetDIBits(dc, info.colour, 0, height, storage, C.byref(header), 0) == height
        data = bytes(storage)
        return {'width': width, 'height': height, 'source_bitmap_bit_depth': bitmap.bits,
                'raw_bgra_sha256': hashlib.sha256(data).hexdigest()}, data
    finally:
        if dc: gdi.DeleteDC(dc)
        for handle in [info.mask, info.colour]:
            if handle: gdi.DeleteObject(handle)


def comparison(actual, expected):
    assert len(actual) == len(expected)
    # Transparent colour channels have no visual meaning. Preserve the full
    # hashes, and also compare visible pixels with a one-level rounding margin.
    differences = [abs(a-b) for i,(a,b) in enumerate(zip(actual,expected))
                   if i % 4 != 3 and expected[i//4*4+3] != 0]
    alpha = actual[3::4] == expected[3::4]
    delta = max(differences,default=0)
    return {'exact_bytes': actual == expected, 'alpha_exact':alpha,
            'visible_rgb_max_delta':delta,'matches':alpha and delta <= 1}


def inspect_icon(handle, name, images, source):
    info, raw = raw_colour_bitmap(handle)
    info['handle'] = hex(handle)
    if raw is None:return info
    size = (info['width'],info['height'])
    raw_png = images / f'{name}-raw.png'
    Image.frombytes('RGBA',size,raw,'raw','BGRA').save(raw_png)
    info['raw_png'] = str(raw_png)
    # DrawIconEx shows the actual alpha/mask rendering result, independently of
    # the colour-plane copy. It does not draw into a visible application window.
    if size[0] == size[1]:
        drawn = pixels.icon_pixels(P(handle),size[0])
        drawn_png = images / f'{name}-drawn.png'
        Image.frombytes('RGBA',size,drawn,'raw','BGRA').save(drawn_png)
        info['drawn_png'] = str(drawn_png)
        info['drawn_bgra_sha256'] = hashlib.sha256(drawn).hexdigest()
    else: drawn = None
    if size in source.ico.sizes():
        expected = source.ico.getimage(size).convert('RGBA').tobytes('raw','BGRA')
        info['source_frame'] = list(size)
        info['source_bgra_sha256'] = hashlib.sha256(expected).hexdigest()
        info['raw_matches_source'] = comparison(raw,expected)
        if drawn is not None: info['drawn_matches_source'] = comparison(drawn,expected)
    return info


def inspect_window(hwnd, images, source):
    pid = U()
    user.GetWindowThreadProcessId(P(hwnd),C.byref(pid))
    title, classname = C.create_unicode_buffer(1024), C.create_unicode_buffer(256)
    user.GetWindowTextW(P(hwnd),title,len(title))
    user.GetClassNameW(P(hwnd),classname,len(classname))
    dpi = user.GetDpiForWindow(P(hwnd))
    result = {'hwnd':hex(hwnd),'pid':pid.value,'title':title.value,'class':classname.value,
              'visible':bool(user.IsWindowVisible(P(hwnd))),'dpi':dpi,'icons':{}}
    for name, kind in [('WM_GETICON_SMALL',0),('WM_GETICON_BIG',1),('WM_GETICON_SMALL2',2)]:
        icon = SIZE()
        # SMTO_BLOCK | SMTO_ABORTIFHUNG, one-second bound, read-only WM_GETICON.
        success = user.SendMessageTimeoutW(P(hwnd),0x7f,kind,dpi,3,1000,C.byref(icon))
        if not success:
            result['icons'][name]={'returned':False,'reason':'message_failed_or_timed_out'}
        elif not icon.value:
            result['icons'][name]={'returned':False,'reason':'window_has_no_explicit_icon'}
        else:
            result['icons'][name]=inspect_icon(icon.value,f'{hwnd:x}-{name}',images,source)
    for name, index in [('CLASS_HICON',-14),('CLASS_HICONSM',-34)]:
        icon=user.GetClassLongPtrW(P(hwnd),index)
        result['icons'][name] = inspect_icon(icon,f'{hwnd:x}-{name}',images,source) if icon else {'returned':False,'reason':'no_class_icon'}
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    target=parser.add_mutually_exclusive_group(required=True)
    target.add_argument('--pid',type=int)
    target.add_argument('--hwnd',type=lambda value:int(value,0))
    parser.add_argument('--source',type=Path,default=Path(__file__).resolve().parents[1]/'apps/client/src-tauri/icons/icon.ico')
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--expect-min-size',type=int,default=0,help='Require an actual WM_GETICON matching the source at or above this native size')
    args=parser.parse_args()
    assert C.sizeof(P)==8,'Use the bundled 64-bit Python'
    configure()
    handles=[]
    if args.hwnd:
        assert user.IsWindow(P(args.hwnd)),'The HWND does not exist'
        handles=[args.hwnd]
    else:
        callback_type=C.WINFUNCTYPE(I,P,C.c_ssize_t)
        @callback_type
        def visit(hwnd,_):
            pid=U()
            user.GetWindowThreadProcessId(hwnd,C.byref(pid))
            if pid.value==args.pid:handles.append(int(hwnd))
            return 1
        user.EnumWindows.argtypes=[callback_type,C.c_ssize_t]
        assert user.EnumWindows(visit,0)
    assert handles,'No top-level HWND belongs to the requested PID'
    output=args.output.resolve()
    output.parent.mkdir(parents=True,exist_ok=True)
    images=output.parent/(output.stem+'-images')
    images.mkdir(exist_ok=True)
    with Image.open(args.source) as source:
        report={'runtime':sys.executable,'pointer_bits':C.sizeof(P)*8,
                'source':str(args.source.resolve()),'source_sha256':hashlib.sha256(args.source.read_bytes()).hexdigest(),
                'source_frames':sorted([list(size) for size in source.ico.sizes()]),
                'read_only_target':True,'windows':[inspect_window(hwnd,images,source) for hwnd in handles]}
    candidates=[icon for window in report['windows'] for name,icon in window['icons'].items()
                if name.startswith('WM_GETICON') and icon.get('raw_matches_source',{}).get('matches')]
    passed=any(min(icon['width'],icon['height'])>=args.expect_min_size for icon in candidates)
    report['matching_window_icon_found']=bool(candidates)
    report['minimum_native_size_required']=args.expect_min_size
    report['minimum_size_check_passed']=passed
    output.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({'report':str(output),'windows':len(handles),'matching_window_icon_found':bool(candidates),'minimum_size_check_passed':passed}))
    if args.expect_min_size:assert passed,'Actual HWND icons do not match the required source/resolution; see report'


if __name__=='__main__':main()
