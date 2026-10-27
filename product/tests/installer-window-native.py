"""Inspect only the caller-selected installer PID; optional close is test cleanup."""
import argparse
import ctypes as C
from ctypes import wintypes as W
import hashlib
import json
from pathlib import Path
import time
from PIL import Image

p = argparse.ArgumentParser()
p.add_argument('--pid', type=int, required=True)
p.add_argument('--output', type=Path, required=True)
p.add_argument('--close', action='store_true')
a = p.parse_args()
u, g = C.windll.user32, C.windll.gdi32
u.SetProcessDPIAware()
u.GetWindowLongPtrW.restype = C.c_ssize_t
u.GetWindowLongPtrW.argtypes = [W.HWND, C.c_int]
u.GetDC.restype = W.HDC
u.GetDC.argtypes = [W.HWND]
g.CreateCompatibleDC.restype = W.HDC
g.CreateCompatibleDC.argtypes = [W.HDC]
g.CreateCompatibleBitmap.restype = W.HBITMAP
g.CreateCompatibleBitmap.argtypes = [W.HDC, C.c_int, C.c_int]
g.SelectObject.restype = W.HANDLE
g.SelectObject.argtypes = [W.HDC, W.HANDLE]
g.DeleteObject.argtypes = [W.HANDLE]
g.DeleteDC.argtypes = [W.HDC]
u.ReleaseDC.argtypes = [W.HWND, W.HDC]
u.PrintWindow.argtypes = [W.HWND, W.HDC, W.UINT]
g.GetDIBits.argtypes = [W.HDC, W.HBITMAP, W.UINT, W.UINT, C.c_void_p, C.c_void_p, W.UINT]
u.SendMessageW.argtypes = [W.HWND, W.UINT, W.WPARAM, W.LPARAM]
CALLBACK = C.WINFUNCTYPE(W.BOOL, W.HWND, W.LPARAM)

def describe(hwnd):
    name, text = C.create_unicode_buffer(256), C.create_unicode_buffer(1024)
    u.GetClassNameW(hwnd, name, 256)
    u.GetWindowTextW(hwnd, text, 1024)
    r = W.RECT()
    u.GetWindowRect(hwnd, C.byref(r))
    return dict(hwnd=hwnd, cls=name.value, text=text.value, visible=bool(u.IsWindowVisible(hwnd)), id=u.GetDlgCtrlID(hwnd), rect=[r.left,r.top,r.right,r.bottom], style=u.GetWindowLongPtrW(hwnd,-16))

windows = []
@CALLBACK
def collect(hwnd, unused):
    pid = W.DWORD()
    u.GetWindowThreadProcessId(hwnd, C.byref(pid))
    if pid.value == a.pid and u.IsWindowVisible(hwnd): windows.append(describe(hwnd))
    return True

for _ in range(60):
    windows.clear()
    u.EnumWindows(collect, 0)
    if windows: break
    time.sleep(.1)
assert windows, 'No visible installer window for selected PID'
window = max(windows,key=lambda w:(w['rect'][2]-w['rect'][0])*(w['rect'][3]-w['rect'][1]))
hwnd = window['hwnd']
children = []
@CALLBACK
def child(hwnd, unused):
    children.append(describe(hwnd))
    return True
u.EnumChildWindows(hwnd, child, 0)

def capture(path):
    r=W.RECT();u.GetWindowRect(hwnd,C.byref(r));w,h=r.right-r.left,r.bottom-r.top
    dc=u.GetDC(hwnd);mem=g.CreateCompatibleDC(dc);bmp=g.CreateCompatibleBitmap(dc,w,h);old=g.SelectObject(mem,bmp)
    assert u.PrintWindow(hwnd,mem,2),'PrintWindow failed'
    class INFO(C.Structure):
        _fields_=[('size',W.DWORD),('width',W.LONG),('height',W.LONG),('planes',W.WORD),('bitcount',W.WORD),('compression',W.DWORD),('sizeimage',W.DWORD),('xppm',W.LONG),('yppm',W.LONG),('used',W.DWORD),('important',W.DWORD)]
    info=INFO(C.sizeof(INFO),w,-h,1,32,0,0,0,0,0,0);pixels=C.create_string_buffer(w*h*4)
    assert g.GetDIBits(mem,bmp,0,h,pixels,C.byref(info),0)==h,'GetDIBits failed'
    img=Image.frombytes('RGB',(w,h),pixels.raw,'raw','BGRX');img.save(path)
    g.SelectObject(mem,old);g.DeleteObject(bmp);g.DeleteDC(mem);u.ReleaseDC(hwnd,dc)
    return hashlib.sha256(img.tobytes()).hexdigest()

a.output.parent.mkdir(parents=True,exist_ok=True)
frame1=a.output.with_suffix('.frame1.png');frame2=a.output.with_suffix('.frame2.png')
hash1=capture(frame1);time.sleep(.37);hash2=capture(frame2)
report=dict(pid=a.pid,window=window,children=children,caption_removed=(window['style']&0x00C00000)==0,thick_frame_removed=(window['style']&0x00040000)==0,has_status_bar=any(c['visible'] and c['cls']=='msctls_statusbar32' for c in children),animation_changed=hash1!=hash2,frame1=str(frame1),frame2=str(frame2))
a.output.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
assert report['caption_removed'] and report['thick_frame_removed'] and not report['has_status_bar'], report
assert report['animation_changed'],'No changed pixels between timed installer frames'
if a.close: u.SendMessageW(hwnd,0x10,0,0)
print(json.dumps({k:v for k,v in report.items() if k!='children'},ensure_ascii=False))
