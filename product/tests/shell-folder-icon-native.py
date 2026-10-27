"""Read-only PIDL -> IShellFolder -> IExtractIcon diagnostic.

No registry changes, notifications, processes, input or visible windows.
"""
import argparse
import ctypes as C
import importlib.util
import json
from pathlib import Path
import sys
import winreg

spec = importlib.util.spec_from_file_location('pixels', Path(__file__).with_name('archive-icons-native.py'))
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
P, U, I = p.P, p.U, p.I


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('file', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--dll', type=Path, help='Override this process only via CoRegisterClassObject; never writes registry')
    args = parser.parse_args()
    assert C.sizeof(P) == 8
    C.windll.ole32.CoInitialize(None)
    C.windll.ole32.CoTaskMemFree.argtypes = [P]
    C.windll.user32.DestroyIcon.argtypes = [P]
    shell = C.windll.shell32
    shell.SHParseDisplayName.argtypes = [C.c_wchar_p, P, C.POINTER(P), U, C.POINTER(U)]
    shell.SHBindToParent.argtypes = [P, P, C.POINTER(P), C.POINTER(P)]
    path = str(args.file.resolve())
    pidl, parent, child, icon = P(), P(), P(), P()
    report = {'path': path, 'runtime': sys.executable, 'pointer_bits': C.sizeof(P)*8,
              'registry_modified':False,'process_only_activation_override':bool(args.dll)}
    factory,cookie = P(), U()
    try:
        if args.dll:
            dll=C.WinDLL(str(args.dll.resolve()))
            dll.DllGetClassObject.argtypes=[P,P,C.POINTER(P)]
            candidate_clsid='81ab84ec-130c-4a8f-84b1-a9c11f10bcca'
            assert dll.DllGetClassObject(p.guid(candidate_clsid),p.guid('00000001-0000-0000-c000-000000000046'),C.byref(factory))==0
            # Exercise the proposed DLL through the *actual* file association
            # without mutating it before the app performs its upgrade.
            # Resolve the association of the supplied file, including legacy fixtures.
            extension = args.file.suffix.lower()
            assert extension in ('.timermix', '.pixelmix'), 'Use a TIMER archive sample'
            with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT,extension) as key:
                progid=winreg.QueryValueEx(key,'')[0]
            with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT,progid+'\\shellex\\IconHandler') as key:
                registered_clsid=winreg.QueryValueEx(key,'')[0]
            C.windll.ole32.CoRegisterClassObject.argtypes=[P,P,U,U,C.POINTER(U)]
            hr=C.windll.ole32.CoRegisterClassObject(p.guid(registered_clsid),factory,1,1,C.byref(cookie))
            assert hr==0,hex(hr&0xffffffff)
            report['dll']=str(args.dll.resolve())
            report['candidate_clsid']=candidate_clsid
            report['overridden_in_this_process_only']=registered_clsid
        assert shell.SHParseDisplayName(path, None, C.byref(pidl), 0, None) == 0
        assert shell.SHBindToParent(pidl, p.guid('000214e6-0000-0000-c000-000000000046'), C.byref(parent), C.byref(child)) == 0
        p.com(parent, 10, [P,U,P,P,P,C.POINTER(P)], None,1,C.byref(child),p.guid('000214fa-0000-0000-c000-000000000046'),None,C.byref(icon))
        text = C.create_unicode_buffer(32768)
        index, flags = I(), U()
        p.com(icon,3,[U,P,U,C.POINTER(I),C.POINTER(U)],0,text,len(text),C.byref(index),C.byref(flags))
        report.update({'location':text.value,'index':index.value,'flags':hex(flags.value)})
        big, small = P(),P()
        p.com(icon,4,[C.c_wchar_p,U,C.POINTER(P),C.POINTER(P),U],text.value,index.value,C.byref(big),C.byref(small),32 | (16<<16))
        try:
            report.update({'large':p.icon_dimensions(big),'small':p.icon_dimensions(small)})
            report['shell'] = p.shell_icon_digest(args.file.resolve(),p.icon_pixels(big))
        finally:
            for handle in [big,small]:
                if handle.value: C.windll.user32.DestroyIcon(handle)
    except Exception as e:
        report['error'] = str(e)
    finally:
        for obj in [icon,parent]: p.release(obj)
        if cookie.value:C.windll.ole32.CoRevokeClassObject(cookie)
        p.release(factory)
        if pidl.value:C.windll.ole32.CoTaskMemFree(pidl)
        C.windll.ole32.CoUninitialize()
    if args.output:args.output.write_text(json.dumps(report,indent=2),encoding='utf8')
    print(json.dumps(report,indent=2))


if __name__ == '__main__': main()
