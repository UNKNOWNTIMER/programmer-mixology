"""Exercise the actual COM DLL without registering it or starting Explorer."""
from pathlib import Path
import argparse
import ctypes as C
import importlib.util
import hashlib
import json
import sys
from PIL import Image
from io import BytesIO

spec = importlib.util.spec_from_file_location('icon_pixels', Path(__file__).with_name('archive-icons-native.py'))
pixels = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pixels)
P, U, I = pixels.P, pixels.U, pixels.I


def call(pointer, slot, types, *args):
    address = C.cast(pointer, C.POINTER(C.POINTER(P))).contents[slot]
    return C.WINFUNCTYPE(I, P, *types)(address)(pointer, *args)


CLSID = '81ab84ec-130c-4a8f-84b1-a9c11f10bcca'
THUMBNAIL_CLSID = '34ac24f9-ff06-4610-a459-a49a6e30535d'
IID_FACTORY = '00000001-0000-0000-c000-000000000046'
IID_PERSIST = '0000010b-0000-0000-c000-000000000046'
IID_ICON = '000214fa-0000-0000-c000-000000000046'
IID_FILE = 'b7d14566-0509-4cce-a71f-0a554233bd9b'
IID_STREAM = 'b824b49d-22ac-4161-ac8a-9916e8fa3f7f'
IID_THUMB = 'e357fccd-a995-4576-b01f-234630154e96'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dll', required=True, type=Path)
    parser.add_argument('--samples', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    assert C.sizeof(P) == 8, 'Use the bundled 64-bit Python to test the x64 Explorer handler'
    dll = C.WinDLL(str(args.dll.resolve()))
    get = dll.DllGetClassObject
    get.argtypes = [P, P, C.POINTER(P)]
    get.restype = I
    dll.DllCanUnloadNow.restype = I
    C.windll.user32.DestroyIcon.argtypes = [P]
    factory = P()
    assert get(pixels.guid(CLSID), pixels.guid(IID_FACTORY), C.byref(factory)) == 0
    thumbnail_factory = P()
    assert get(pixels.guid(THUMBNAIL_CLSID), pixels.guid(IID_FACTORY), C.byref(thumbnail_factory)) == 0
    assert dll.DllCanUnloadNow() == 1
    results = []
    args.output.parent.mkdir(exist_ok=True, parents=True)
    # Shell picks an initialization interface by QueryInterface. The icon
    # class must never advertise the stream-only thumbnail contract.
    for factory_ptr, rejected in [(factory, [IID_FILE, IID_STREAM, IID_THUMB]),
                                  (thumbnail_factory, [IID_PERSIST, IID_ICON])]:
        for iid in rejected:
            unwanted = P()
            result = call(factory_ptr,3,[P,P,C.POINTER(P)],None,pixels.guid(iid),C.byref(unwanted))
            assert result & 0xffffffff == 0x80004002 and not unwanted.value, ('Unexpected interface',iid)
            results.append({'case':'separate_COM_contracts','rejected_iid':iid,'status':'pass'})

    def instance(path):
        persist = P()
        assert call(factory, 3, [P, P, C.POINTER(P)], None, pixels.guid(IID_PERSIST), C.byref(persist)) == 0
        result = call(persist, 5, [C.c_wchar_p, U], str(path), 0)
        return persist, result

    def extract(persist):
        icon = P()
        assert call(persist, 0, [P, C.POINTER(P)], pixels.guid(IID_ICON), C.byref(icon)) == 0
        try:
            key = C.create_unicode_buffer(260)
            index, flags = I(), U()
            assert call(icon, 3, [U, C.c_wchar_p, U, C.POINTER(I), C.POINTER(U)], 0, key, len(key), C.byref(index), C.byref(flags)) == 0
            assert flags.value == 0x1a, flags.value
            large, small = P(), P()
            result = call(icon, 4, [C.c_wchar_p, U, C.POINTER(P), C.POINTER(P), U], key, index.value, C.byref(large), C.byref(small), (32 << 16) | 128)
            return result, large, small, key.value
        finally:
            pixels.release(icon)

    # New exports and existing historical samples both exercise the same container.
    files = sorted(path for path in args.samples.resolve().iterdir()
                   if path.is_file() and path.suffix.lower() in ('.timermix', '.pixelmix'))
    assert len(files) >= 2
    try:
        for path in files:
            persist, loaded = instance(path)
            assert loaded == 0, (path, hex(loaded & 0xffffffff))
            try:
                result, large, small, key = extract(persist)
                assert result == 0 and large.value and small.value, (path, hex(result & 0xffffffff))
                try:
                    assert pixels.icon_dimensions(large) == [128, 128]
                    assert pixels.icon_dimensions(small) == [32, 32]
                    actual = pixels.icon_pixels(large, 128)
                    expected = Image.open(BytesIO(path.read_bytes())).ico.getimage((128, 128)).convert('RGBA').tobytes('raw', 'BGRA')
                    delta = max(abs(a-b) for n, (a,b) in enumerate(zip(actual, expected)) if n % 4 != 3)
                    assert delta <= 1 and actual[3::4] == expected[3::4], (path, delta)
                    results.append({'file': path.name, 'flags': 'GIL_PERINSTANCE|GIL_NOTFILENAME|GIL_DONTCACHE',
                                    'cache_key': key, 'large': [128, 128], 'small': [32, 32],
                                    'large_bgra_sha256': hashlib.sha256(actual).hexdigest(), 'max_rgb_delta': delta, 'status': 'pass'})
                finally:
                    C.windll.user32.DestroyIcon(large)
                    C.windll.user32.DestroyIcon(small)
                assert call(persist, 6, [C.c_wchar_p, I], str(path), 1) < 0, 'COM Save must be denied'
            finally:
                pixels.release(persist)

        def thumbnail_instance(path, stream_mode):
            initialized = P()
            iid = IID_STREAM if stream_mode else IID_FILE
            assert call(thumbnail_factory, 3, [P, P, C.POINTER(P)], None, pixels.guid(iid), C.byref(initialized)) == 0
            if stream_mode:
                raw = path.read_bytes()
                memory = C.create_string_buffer(raw)
                create_stream = C.windll.shlwapi.SHCreateMemStream
                create_stream.argtypes, create_stream.restype = [P, U], P
                stream = P(create_stream(memory, len(raw)))
                assert stream.value
                try:
                    hr = call(initialized, 3, [P, U], stream, 0)
                finally:
                    pixels.release(stream)
            else:
                hr = call(initialized, 3, [C.c_wchar_p, U], str(path), 0)
            return initialized, hr

        for path in files:
            for stream_mode in [False, True]:
                initialized, hr = thumbnail_instance(path, stream_mode)
                assert hr == 0
                thumb = P()
                assert call(initialized, 0, [P, C.POINTER(P)], pixels.guid(IID_THUMB), C.byref(thumb)) == 0
                try:
                    for requested in [16, 64, 128, 1000]:
                        bitmap, alpha = P(), I()
                        assert call(thumb, 3, [U, C.POINTER(P), C.POINTER(I)], requested, C.byref(bitmap), C.byref(alpha)) == 0
                        assert bitmap.value and alpha.value == 2
                        try:
                            info = pixels.BITMAP()
                            C.windll.gdi32.GetObjectW.argtypes = [P, I, P]
                            assert C.windll.gdi32.GetObjectW(bitmap, C.sizeof(info), C.byref(info))
                            size = min(requested, 256)
                            assert [info.width, info.height] == [size, size]
                            assert info.data
                            actual = C.string_at(info.data, size*size*4)
                            base = Image.open(BytesIO(path.read_bytes())).ico.getimage((16,16) if size == 16 else (64,64) if size == 64 else (128,128)).convert('RGBA')
                            expected = base.resize((size,size), Image.Resampling.NEAREST).tobytes('raw', 'BGRA')
                            assert actual == expected, (path, stream_mode, requested)
                            results.append({'file': path.name, 'interface': 'IInitializeWithStream' if stream_mode else 'IInitializeWithFile',
                                            'thumbnail_requested': requested, 'thumbnail_returned': [size,size],
                                            'alpha_type': 'WTSAT_ARGB', 'bgra_sha256': hashlib.sha256(actual).hexdigest(), 'status':'pass'})
                        finally:
                            C.windll.gdi32.DeleteObject.argtypes = [P]
                            C.windll.gdi32.DeleteObject(bitmap)
                finally:
                    pixels.release(thumb)
                    pixels.release(initialized)

        invalid = args.output.parent / 'invalid-fixtures'
        invalid.mkdir(exist_ok=True)
        original = files[0].read_bytes()
        corrupt = bytearray(original)
        corrupt[200] ^= 0x40
        wrong_frame = bytearray(original)
        wrong_frame[18] = 0
        sha_at = len(wrong_frame) - 9 - 32
        wrong_frame[sha_at:sha_at+32] = hashlib.sha256(wrong_frame[:sha_at]).digest()
        for name, data in [('bad-checksum', corrupt), ('bad-frame-valid-checksum', wrong_frame),
                           ('too-large', b'x' * 524289), ('truncated', original[:100]), ('plain-json', b'{}')]:
            path = (invalid / (name + '.timermix')).resolve()
            path.write_bytes(data)
            persist, loaded = instance(path)
            assert loaded == 0
            try:
                result, large, small, _ = extract(persist)
                assert result < 0 and not large.value and not small.value, (name, result)
                results.append({'case': name, 'hresult': hex(result & 0xffffffff), 'status': 'pass'})
            finally:
                pixels.release(persist)
            initialized, hr = thumbnail_instance(path, True)
            try:
                assert hr < 0, ('Invalid stream accepted', name)
                results.append({'case': name, 'interface':'IInitializeWithStream', 'hresult':hex(hr&0xffffffff), 'status':'pass'})
            finally:
                pixels.release(initialized)
        for path in ['relative.timermix', r'\\server\share\drink.timermix', r'\\?\C:\drink.timermix',
                     r'C:\drink.timermix:secret', r'C:\drink.exe', r'C:\data\..\drink.timermix',
                     # Retain explicit legacy-path rejection coverage too.
                     'relative.pixelmix', r'\\server\share\drink.pixelmix', r'C:\drink.pixelmix:secret']:
            persist, loaded = instance(path)
            assert loaded < 0, path
            pixels.release(persist)
            results.append({'case': path, 'hresult': hex(loaded & 0xffffffff), 'status': 'pass'})
    finally:
        pixels.release(thumbnail_factory)
        pixels.release(factory)
    assert dll.DllCanUnloadNow() == 0, 'COM objects or server locks leaked'
    result = {'dll': str(args.dll.resolve()), 'dll_sha256': hashlib.sha256(args.dll.read_bytes()).hexdigest(),
              'python_executable': sys.executable, 'process_pointer_bits': C.sizeof(P)*8,
              'samples': len(files), 'checks': len(results), 'registry_modified': False,
              'actual_com_handler': True, 'results': results}
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'samples': len(files), 'checks': len(results), 'pass': True, 'dll_sha256': result['dll_sha256']}))


if __name__ == '__main__':
    main()
