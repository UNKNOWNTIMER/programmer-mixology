"""Read-only Win32 icon checks; no input automation, window or registry mutation.

Matches drag 2.1.1's Windows Image::Raw implementation: WIC decoder -> frame 0
-> 32bppPBGRA -> CopyPixels -> CreateBitmap. Also tests ExtractIconEx directly
on .timermix (or legacy .pixelmix) and optionally actual per-file Shell icons
after app registration.
"""
from pathlib import Path
import argparse
import ctypes as C
import hashlib
import json
import struct
import sys
import uuid

P = C.c_void_p
U = C.c_uint32
I = C.c_int32
HRESULT = I
WINFUNCTYPE = C.WINFUNCTYPE


def guid(value):
    return (C.c_ubyte * 16).from_buffer_copy(uuid.UUID(value).bytes_le)


def com(pointer, slot, args, *values):
    address = C.cast(pointer, C.POINTER(C.POINTER(P))).contents[slot]
    result = WINFUNCTYPE(HRESULT, P, *args)(address)(pointer, *values)
    if result < 0:
        raise RuntimeError(f'COM slot {slot}: HRESULT 0x{result & 0xffffffff:08x}')
    return result


def release(pointer):
    if pointer.value:
        com(pointer, 2, [])


def drag_bitmap(icon):
    factory, stream, decoder, frame, source = P(), P(), P(), P(), P()
    ole = C.windll.ole32
    ole.CoCreateInstance.argtypes = [P, P, U, P, C.POINTER(P)]
    initialized = ole.CoInitialize(None)
    assert initialized >= 0, f'WIC COM initialization failed: 0x{initialized & 0xffffffff:08x}'
    try:
        result = ole.CoCreateInstance(guid('cacaf262-9370-4615-a13b-9f5539da4c0a'), None, 1,
                                      guid('ec5ec8a9-c395-4314-9c77-54d7a935ff70'), C.byref(factory))
        assert result == 0, hex(result & 0xffffffff)
        # IWICImagingFactory::CreateStream; IWICStream::InitializeFromMemory.
        com(factory, 14, [C.POINTER(P)], C.byref(stream))
        memory = C.create_string_buffer(icon)
        com(stream, 16, [P, U], memory, len(icon))
        com(factory, 4, [P, P, U, C.POINTER(P)], stream, None, 0, C.byref(decoder))
        com(decoder, 13, [U, C.POINTER(P)], 0, C.byref(frame))
        width, height = U(), U()
        com(frame, 3, [C.POINTER(U), C.POINTER(U)], C.byref(width), C.byref(height))
        convert = C.windll.windowscodecs.WICConvertBitmapSource
        convert.argtypes = [P, P, C.POINTER(P)]
        convert.restype = HRESULT
        result = convert(guid('6fddc324-4e03-4bfe-b185-3d77768dc910'), frame, C.byref(source))
        assert result == 0, hex(result & 0xffffffff)
        pixels = (C.c_ubyte * (width.value * height.value * 4))()
        com(source, 7, [P, U, U, P], None, width.value * 4, len(pixels), pixels)
        create = C.windll.gdi32.CreateBitmap
        create.argtypes = [I, I, U, U, P]
        create.restype = P
        bitmap = create(width.value, height.value, 1, 32, pixels)
        assert bitmap
        C.windll.gdi32.DeleteObject.argtypes = [P]
        C.windll.gdi32.DeleteObject(bitmap)
        assert (width.value, height.value) == (64, 64)
        return {'width': width.value, 'height': height.value,
                'pbgra_sha256': hashlib.sha256(bytes(pixels)).hexdigest(),
                'create_bitmap': True}
    finally:
        for pointer in [source, frame, decoder, stream, factory]:
            release(pointer)
        ole.CoUninitialize()


def single_frame(data, target=64):
    count = struct.unpack_from('<H', data, 4)[0]
    for index in range(count):
        entry = data[6+index*16:22+index*16]
        size, height, _, _, planes, depth, length, offset = struct.unpack('<BBBBHHII', entry)
        if (size or 256) == target:
            return (struct.pack('<HHH', 0, 1, 1) +
                    struct.pack('<BBBBHHII', size, height, 0, 0, planes, depth, length, 22) +
                    data[offset:offset+length])
    raise AssertionError('missing 64px portrait frame')


class SHFILEINFO(C.Structure):
    _fields_ = [('hIcon', P), ('iIcon', I), ('dwAttributes', U),
                ('szDisplayName', C.c_wchar * 260), ('szTypeName', C.c_wchar * 80)]


class BITMAPINFOHEADER(C.Structure):
    _fields_ = [('size', U), ('width', I), ('height', I), ('planes', C.c_uint16),
                ('bits', C.c_uint16), ('compression', U), ('image_size', U),
                ('xppm', I), ('yppm', I), ('used', U), ('important', U)]


class ICONINFO(C.Structure):
    _fields_ = [('icon', I), ('hot_x', U), ('hot_y', U), ('mask', P), ('colour', P)]


class BITMAP(C.Structure):
    _fields_ = [('kind', I), ('width', I), ('height', I), ('stride', I),
                ('planes', C.c_uint16), ('bits', C.c_uint16), ('data', P)]


def icon_dimensions(icon):
    info, bitmap = ICONINFO(), BITMAP()
    C.windll.user32.GetIconInfo.argtypes = [P, C.POINTER(ICONINFO)]
    C.windll.gdi32.GetObjectW.argtypes = [P, I, P]
    C.windll.gdi32.DeleteObject.argtypes = [P]
    assert C.windll.user32.GetIconInfo(icon, C.byref(info))
    try:
        assert C.windll.gdi32.GetObjectW(info.colour or info.mask, C.sizeof(bitmap), C.byref(bitmap))
        return [bitmap.width, bitmap.height]
    finally:
        for handle in [info.mask, info.colour]:
            if handle:
                C.windll.gdi32.DeleteObject(handle)


def icon_pixels(icon, size=32):
    """Render the *actual returned HICON* into an offscreen transparent DIB."""
    gdi, user = C.windll.gdi32, C.windll.user32
    gdi.CreateCompatibleDC.argtypes, gdi.CreateCompatibleDC.restype = [P], P
    gdi.CreateDIBSection.argtypes = [P, P, U, C.POINTER(P), P, U]
    gdi.CreateDIBSection.restype = P
    gdi.SelectObject.argtypes, gdi.SelectObject.restype = [P, P], P
    gdi.DeleteObject.argtypes, gdi.DeleteDC.argtypes = [P], [P]
    user.DrawIconEx.argtypes = [P, I, I, P, I, I, U, P, U]
    dc = gdi.CreateCompatibleDC(None)
    assert dc
    header = BITMAPINFOHEADER(C.sizeof(BITMAPINFOHEADER), size, -size, 1, 32, 0, size*size*4, 0, 0, 0, 0)
    memory = P()
    bitmap = gdi.CreateDIBSection(dc, C.byref(header), 0, C.byref(memory), None, 0)
    assert bitmap and memory.value
    old = gdi.SelectObject(dc, bitmap)
    try:
        C.memset(memory, 0, size*size*4)
        assert user.DrawIconEx(dc, 0, 0, icon, size, size, 0, None, 3)
        return C.string_at(memory, size*size*4)
    finally:
        gdi.SelectObject(dc, old)
        gdi.DeleteObject(bitmap)
        gdi.DeleteDC(dc)


def shell_icon_digest(path, expected_pixels, images_dir=None):
    info = SHFILEINFO()
    get = C.windll.shell32.SHGetFileInfoW
    get.argtypes = [C.c_wchar_p, U, C.POINTER(SHFILEINFO), U, U]
    get.restype = C.c_size_t
    assert get(str(path), 0, C.byref(info), C.sizeof(info), 0x100 | 0x4000)
    result = {'image_list_index': info.iIcon, 'has_icon': bool(info.hIcon)}
    if info.hIcon:
        pixels = icon_pixels(info.hIcon)
        actual = hashlib.sha256(pixels).hexdigest()
        # Shell's image list premultiplies some fully opaque colour components
        # with 255/256 rounding. Preserve both hashes, but compare with that
        # measured one-level RGB tolerance and require alpha to match exactly.
        rgb_delta = max(abs(a-b) for i, (a,b) in enumerate(zip(pixels, expected_pixels)) if i % 4 != 3)
        alpha_match = pixels[3::4] == expected_pixels[3::4]
        result.update({'hicon_size': icon_dimensions(info.hIcon), 'hicon_bgra_sha256': actual,
                       'max_rgb_delta_from_direct_extraction': rgb_delta, 'alpha_matches_direct_extraction': alpha_match,
                       'matches_direct_extraction': rgb_delta <= 1 and alpha_match})
        if images_dir:
            from PIL import Image
            images_dir.mkdir(exist_ok=True, parents=True)
            Image.frombytes('RGBA', (32, 32), pixels, 'raw', 'BGRA').save(images_dir / f'{path.stem}.png')
        C.windll.user32.DestroyIcon(info.hIcon)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    parser.add_argument('--expect-embedded', action='store_true')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--images-dir', type=Path)
    args = parser.parse_args()
    # SHGetFileInfo can activate IExtractIcon in addition to reading resources.
    # Keep COM alive for the *whole* run: drag_bitmap's balanced inner scope
    # previously uninitialized this thread immediately before each Shell call.
    ole = C.windll.ole32
    initialized = ole.CoInitializeEx(None, 2)  # COINIT_APARTMENTTHREADED
    assert initialized >= 0, f'Shell COM initialization failed: 0x{initialized & 0xffffffff:08x}'
    try:
        run_checks(args)
    finally:
        ole.CoUninitialize()


def run_checks(args):
    C.windll.user32.DestroyIcon.argtypes = [P]
    extract = C.windll.shell32.ExtractIconExW
    extract.argtypes = [C.c_wchar_p, I, C.POINTER(P), C.POINTER(P), U]
    extract.restype = U
    rows = []
    # Keep old exported fixture directories usable without renaming evidence.
    archives = (path for path in args.directory.resolve().iterdir()
                if path.is_file() and path.suffix.lower() in ('.timermix', '.pixelmix'))
    for path in sorted(archives):
        large, small = P(), P()
        result = extract(str(path), 0, C.byref(large), C.byref(small), 1)
        assert result == 1 and large.value and small.value, path
        direct_pixels = icon_pixels(large)
        direct = hashlib.sha256(direct_pixels).hexdigest()
        C.windll.user32.DestroyIcon(large)
        C.windll.user32.DestroyIcon(small)
        rows.append({'file': path.name, 'extract_icon_ex': result,
                     'direct_extraction_bgra_sha256': direct,
                     'native_drag_bitmap': drag_bitmap(single_frame(path.read_bytes())),
                     'shell': shell_icon_digest(path, direct_pixels, args.images_dir)})
    assert len(rows) >= 2
    assert len({r['native_drag_bitmap']['pbgra_sha256'] for r in rows}) == len(rows)
    result = {'runtime': {'executable': sys.executable, 'pointer_bits': C.sizeof(P) * 8,
                          'com_apartment': 'STA', 'com_initialized_through_shell_checks': True},
              'files': len(rows), 'unique_wic_bitmaps': len(rows),
              'unique_shell_hicons': len({r['shell'].get('hicon_bgra_sha256') for r in rows}),
              'shell_hicons_match_embedded_portraits': all(r['shell'].get('matches_direct_extraction') for r in rows),
              'per_file_shell_icons_required': args.expect_embedded, 'results': rows}
    if args.output:
        args.output.parent.mkdir(exist_ok=True, parents=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=True, indent=2))
    if args.expect_embedded:
        assert result['unique_shell_hicons'] == len(rows), 'Shell still returns duplicate icon pixels'
        assert result['shell_hicons_match_embedded_portraits'], 'Shell icon pixels do not match actual embedded ICO extraction'


if __name__ == '__main__':
    main()
