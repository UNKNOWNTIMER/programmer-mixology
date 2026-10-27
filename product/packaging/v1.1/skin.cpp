// Programmer Mixology V1.2 NSIS chrome. The installer engine remains NSIS: this DLL only
// paints the native installer, verifies the embedded executable and checks locks.
// No service, elevation, network access, process termination or data migration.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <commctrl.h>
#include <uxtheme.h>
#include <bcrypt.h>
#include <dwrite_3.h>
#include <shobjidl.h>
#include <tlhelp32.h>
#include <string>
#include <vector>
#include <algorithm>
#include <cwctype>

static HWND g_main=nullptr,g_canvas=nullptr,g_progress=nullptr;
static WNDPROC g_previous=nullptr;
static HINSTANCE g_module=nullptr;
static HBRUSH g_background=nullptr;
static HFONT g_font=nullptr,g_small=nullptr,g_title=nullptr;
static int g_phase=0,g_tick=0,g_dpi=96;
static std::wstring g_face=L"Microsoft YaHei";
static const COLORREF kBg=RGB(3,9,13),kPanel=RGB(8,19,25),kLine=RGB(46,72,82),kText=RGB(179,204,211),kRed=RGB(165,77,68),kBlue=RGB(73,130,151);
static int px(int v){return MulDiv(v,g_dpi,96);}
static void fill(HDC dc,RECT r,COLORREF color){HBRUSH b=CreateSolidBrush(color);FillRect(dc,&r,b);DeleteObject(b);}
static void line(HDC dc,int x,int y,int xx,int yy,COLORREF color,int width=1){HPEN p=CreatePen(PS_SOLID,px(width),color);auto old=SelectObject(dc,p);MoveToEx(dc,px(x),px(y),nullptr);LineTo(dc,px(xx),px(yy));SelectObject(dc,old);DeleteObject(p);}
static void text(HDC dc,const wchar_t* value,RECT r,HFONT font,COLORREF color,UINT flags=DT_LEFT|DT_VCENTER|DT_SINGLELINE){SetBkMode(dc,TRANSPARENT);SetTextColor(dc,color);auto old=SelectObject(dc,font);DrawTextW(dc,value,-1,&r,flags);SelectObject(dc,old);}
static RECT box(int x,int y,int w,int h){return {px(x),px(y),px(x+w),px(y+h)};}
static int percentage(){if(g_phase==2)return 100;if(!g_progress||!IsWindow(g_progress))return 0;LRESULT pos=SendMessageW(g_progress,PBM_GETPOS,0,0),maximum=SendMessageW(g_progress,PBM_GETRANGE,FALSE,0);return maximum>0?static_cast<int>(std::clamp<LRESULT>(pos*100/maximum,0,100)):0;}
static void paint(HDC dc){
    RECT r{};GetClientRect(g_canvas,&r);fill(dc,r,kBg);
    auto pen=CreatePen(PS_SOLID,px(1),kLine);auto oldp=SelectObject(dc,pen);auto oldb=SelectObject(dc,GetStockObject(NULL_BRUSH));Rectangle(dc,px(1),px(1),r.right-px(1),r.bottom-px(1));SelectObject(dc,oldp);SelectObject(dc,oldb);DeleteObject(pen);
    text(dc,L"Programmer Mixology",box(28,20,470,36),g_title,kText);text(dc,L"V1.2",box(30,58,160,20),g_small,kBlue);
    line(dc,26,92,614,92,kLine);line(dc,250,114,250,326,kLine);line(dc,26,346,614,346,kLine);
    for(int y=121;y<324;y+=24)for(int x=32;x<233;x+=24)fill(dc,box(x,y,1,1),RGB(25,42,50));
    // A glass made of a fixed pixel grid. Rising highlights are decorative;
    // the separate progress bar always reads the real NSIS progress control.
    const wchar_t* glass[]={L"  _____________  ",L"  \\           /  ",L"   \\ .  .  . /   ",L"    \\ .  .  /    ",L"     \\ . . /     ",L"      \\ . /      ",L"       \\_/       ",L"        |        ",L"        |        ",L"      __|__      ",L"    ._______ .   "};
    for(int row=0;row<11;++row){COLORREF c=(row==2||row==3||row==4)?kRed:kBlue;if((g_tick/2)%11==row)c=kText;text(dc,glass[row],box(43,130+row*14,180,16),g_small,c);}
    if(g_phase==1||g_phase==4){text(dc,g_phase==1?L"Installing":L"Uninstalling",box(280,132,330,28),g_font,kText);int p=percentage();fill(dc,box(280,247,330,14),RGB(19,34,41));for(int x=0;x<p*324/100;x+=9)fill(dc,box(283+x,250,6,8),kRed);wchar_t value[16]{};wsprintfW(value,L"%d%%",p);text(dc,value,box(280,269,330,22),g_small,kBlue,DT_RIGHT|DT_SINGLELINE);}
    for(int i=0;i<5;++i){int amount=((g_tick/2+i*3)%15);fill(dc,box(29+i*12,363,7,7),i==amount%5?kRed:RGB(29,51,59));}
}
static LRESULT CALLBACK CanvasProc(HWND w,UINT m,WPARAM a,LPARAM b){switch(m){case WM_PAINT:{PAINTSTRUCT ps{};HDC dc=BeginPaint(w,&ps);RECT r{};GetClientRect(w,&r);HDC mem=CreateCompatibleDC(dc);HBITMAP bmp=CreateCompatibleBitmap(dc,r.right,r.bottom);auto old=SelectObject(mem,bmp);paint(mem);BitBlt(dc,0,0,r.right,r.bottom,mem,0,0,SRCCOPY);SelectObject(mem,old);DeleteObject(bmp);DeleteDC(mem);EndPaint(w,&ps);return 0;}case WM_ERASEBKGND:return 1;case WM_LBUTTONDOWN:ReleaseCapture();SendMessageW(g_main,WM_NCLBUTTONDOWN,HTCAPTION,0);return 0;}return DefWindowProcW(w,m,a,b);}
static bool drawButton(DRAWITEMSTRUCT* d){if(d->CtlType!=ODT_BUTTON)return false;bool disabled=(d->itemState&ODS_DISABLED)!=0;fill(d->hDC,d->rcItem,disabled?kBg:(d->itemState&ODS_SELECTED)?RGB(63,35,34):kPanel);HBRUSH border=CreateSolidBrush(disabled?kLine:d->CtlID==2?kLine:kRed);FrameRect(d->hDC,&d->rcItem,border);DeleteObject(border);wchar_t label[128]{};GetWindowTextW(d->hwndItem,label,128);text(d->hDC,label,d->rcItem,g_font,disabled?kLine:kText,DT_CENTER|DT_VCENTER|DT_SINGLELINE);if(d->itemState&ODS_FOCUS){RECT focus=d->rcItem;InflateRect(&focus,-px(4),-px(4));DrawFocusRect(d->hDC,&focus);}return true;}
static LRESULT CALLBACK PageProc(HWND w,UINT m,WPARAM a,LPARAM b,UINT_PTR,DWORD_PTR){if(m==WM_DRAWITEM&&drawButton(reinterpret_cast<DRAWITEMSTRUCT*>(b)))return TRUE;if(m==WM_CTLCOLORSTATIC||m==WM_CTLCOLOREDIT||m==WM_CTLCOLORBTN||m==WM_CTLCOLORDLG){SetTextColor(reinterpret_cast<HDC>(a),kText);SetBkColor(reinterpret_cast<HDC>(a),kBg);return reinterpret_cast<LRESULT>(g_background);}if(m==WM_ERASEBKGND){RECT r{};GetClientRect(w,&r);FillRect(reinterpret_cast<HDC>(a),&r,g_background);return 1;}return DefSubclassProc(w,m,a,b);}
static BOOL CALLBACK styleControl(HWND w,LPARAM){wchar_t name[64]{};GetClassNameW(w,name,64);SendMessageW(w,WM_SETFONT,reinterpret_cast<WPARAM>(g_font),TRUE);SetWindowTheme(w,L"",L"");if(_wcsicmp(name,L"msctls_progress32")==0){g_progress=w;ShowWindow(w,SW_HIDE);}if(_wcsicmp(name,L"Button")==0){LONG_PTR style=GetWindowLongPtrW(w,GWL_STYLE);if((style&BS_TYPEMASK)==BS_PUSHBUTTON||(style&BS_TYPEMASK)==BS_DEFPUSHBUTTON)SetWindowLongPtrW(w,GWL_STYLE,(style&~BS_TYPEMASK)|BS_OWNERDRAW);}RECT bounds{},parent{};GetWindowRect(w,&bounds);MapWindowPoints(nullptr,GetParent(w),reinterpret_cast<POINT*>(&bounds),2);GetClientRect(GetParent(w),&parent);if(bounds.right>parent.right)SetWindowPos(w,nullptr,0,0,std::max<LONG>(px(20),parent.right-bounds.left),bounds.bottom-bounds.top,SWP_NOMOVE|SWP_NOZORDER|SWP_NOACTIVATE);return TRUE;}
static void layout(){
    if(!g_main)return;
    // Repositioning the buttons changes their sibling order. Snapshot handles
    // first, otherwise HWND_TOP can make GetWindow(GW_HWNDNEXT) cycle forever.
    std::vector<HWND> children;
    for(HWND child=GetWindow(g_main,GW_CHILD);child;child=GetWindow(child,GW_HWNDNEXT))children.push_back(child);
    for(HWND child:children){if(child!=g_canvas&&IsWindow(child)){wchar_t name[64]{};GetClassNameW(child,name,64);int id=GetDlgCtrlID(child);
        if(_wcsicmp(name,L"#32770")==0){SetWindowSubclass(child,PageProc,7122,0);SetWindowPos(child,nullptr,px(280),px(121),px(332),px(207),SWP_NOACTIVATE|SWP_NOZORDER);EnumChildWindows(child,styleControl,0);if(g_phase==1||g_phase==4)ShowWindow(child,SW_HIDE);}
        else if(id==1){SetWindowLongPtrW(child,GWL_STYLE,(GetWindowLongPtrW(child,GWL_STYLE)&~BS_TYPEMASK)|BS_OWNERDRAW);SetWindowPos(child,HWND_TOP,px(461),px(363),px(151),px(38),SWP_NOACTIVATE);SendMessageW(child,WM_SETFONT,reinterpret_cast<WPARAM>(g_font),FALSE);}
        else if(id==2){SetWindowTextW(child,L"×");SetWindowLongPtrW(child,GWL_STYLE,(GetWindowLongPtrW(child,GWL_STYLE)&~BS_TYPEMASK)|BS_OWNERDRAW);SetWindowPos(child,HWND_TOP,px(580),px(20),px(32),px(32),SWP_NOACTIVATE);}
        else ShowWindow(child,SW_HIDE);
    }}
    // nsDialogs creates each new page after the decorative canvas. Keep the
    // canvas behind it on every page transition, not just during Attach.
    SetWindowPos(g_canvas,HWND_BOTTOM,0,0,0,0,SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE);
    InvalidateRect(g_main,nullptr,TRUE);
}
static LRESULT CALLBACK MainProc(HWND w,UINT m,WPARAM a,LPARAM b){
    if(m==WM_TIMER&&a==7121){++g_tick;InvalidateRect(g_canvas,nullptr,FALSE);return 0;}
    if(m==WM_DRAWITEM&&drawButton(reinterpret_cast<DRAWITEMSTRUCT*>(b)))return TRUE;
    if(m==WM_CTLCOLORSTATIC||m==WM_CTLCOLORDLG||m==WM_CTLCOLOREDIT){SetTextColor(reinterpret_cast<HDC>(a),kText);SetBkColor(reinterpret_cast<HDC>(a),kBg);return reinterpret_cast<LRESULT>(g_background);}
    if(m==WM_ERASEBKGND){RECT r{};GetClientRect(w,&r);FillRect(reinterpret_cast<HDC>(a),&r,g_background);return 1;}
    if(m==WM_CLOSE&&g_phase==1)return 0;
    return CallWindowProcW(g_previous,w,m,a,b);
}
extern "C" __declspec(dllexport) int __stdcall LoadPixelFont(const wchar_t* path){
    HMODULE pinned=nullptr;GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_PIN,reinterpret_cast<LPCWSTR>(&LoadPixelFont),&pinned);
    HANDLE f=CreateFileW(path,GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,nullptr);if(f==INVALID_HANDLE_VALUE)return 0;DWORD size=GetFileSize(f,nullptr),read=0;if(size<48||size>4194304){CloseHandle(f);return 0;}std::vector<BYTE> source(size);bool ok=ReadFile(f,source.data(),size,&read,nullptr)&&read==size;CloseHandle(f);if(!ok)return 0;
    IDWriteFactory5* factory=nullptr;if(FAILED(DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED,__uuidof(IDWriteFactory5),reinterpret_cast<IUnknown**>(&factory))))return 0;IDWriteFontFileStream* stream=nullptr;HRESULT hr=factory->UnpackFontFile(DWRITE_CONTAINER_TYPE_WOFF2,source.data(),size,&stream);factory->Release();if(FAILED(hr))return 0;UINT64 unpacked=0;stream->GetFileSize(&unpacked);const void* data=nullptr;void* context=nullptr;if(unpacked>33554432||FAILED(stream->ReadFileFragment(&data,0,unpacked,&context))){stream->Release();return 0;}
    auto bytes=static_cast<const BYTE*>(data);auto u16=[&](size_t p)->unsigned{return p+2<=unpacked?(bytes[p]<<8)|bytes[p+1]:0;};auto u32=[&](size_t p)->unsigned{return p+4<=unpacked?(u16(p)<<16)|u16(p+2):0;};
    for(unsigned i=0;i<u16(4);++i){size_t p=12+i*16;if(p+16>unpacked)break;if(u32(p)!=0x6e616d65)continue;size_t base=u32(p+8),strings=base+u16(base+4);for(unsigned j=0;j<u16(base+2);++j){size_t r=base+6+j*12;if(r+12>unpacked)break;if(u16(r)!=3||u16(r+6)!=1)continue;size_t start=strings+u16(r+10),count=u16(r+8);if(start+count>unpacked||count>120)continue;std::wstring face;for(size_t k=0;k<count;k+=2)face.push_back(static_cast<wchar_t>(u16(start+k)));if(!face.empty())g_face=face;break;}break;}
    DWORD fonts=0;HANDLE font=AddFontMemResourceEx(const_cast<void*>(data),static_cast<DWORD>(unpacked),nullptr,&fonts);stream->ReleaseFileFragment(context);stream->Release();return font&&fonts?1:0;
}
extern "C" __declspec(dllexport) void __stdcall Attach(HWND main){
    if(!main||g_main)return;g_main=main;GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_PIN,reinterpret_cast<LPCWSTR>(&Attach),&g_module);
    using GetDpi=UINT(WINAPI*)(HWND);auto dpi=reinterpret_cast<GetDpi>(GetProcAddress(GetModuleHandleW(L"user32.dll"),"GetDpiForWindow"));g_dpi=dpi?static_cast<int>(dpi(main)):96;
    g_background=CreateSolidBrush(kBg);g_font=CreateFontW(-px(16),0,0,0,FW_NORMAL,FALSE,FALSE,FALSE,DEFAULT_CHARSET,OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,NONANTIALIASED_QUALITY,FIXED_PITCH,g_face.c_str());g_small=CreateFontW(-px(13),0,0,0,FW_NORMAL,FALSE,FALSE,FALSE,DEFAULT_CHARSET,OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,NONANTIALIASED_QUALITY,FIXED_PITCH,L"Consolas");g_title=CreateFontW(-px(24),0,0,0,FW_NORMAL,FALSE,FALSE,FALSE,DEFAULT_CHARSET,OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,NONANTIALIASED_QUALITY,FIXED_PITCH,g_face.c_str());
    g_previous=reinterpret_cast<WNDPROC>(SetWindowLongPtrW(main,GWLP_WNDPROC,reinterpret_cast<LONG_PTR>(MainProc)));
    SetWindowLongPtrW(main,GWL_STYLE,GetWindowLongPtrW(main,GWL_STYLE)&~(WS_CAPTION|WS_THICKFRAME|WS_SYSMENU|WS_MINIMIZEBOX|WS_MAXIMIZEBOX));SetWindowLongPtrW(main,GWL_EXSTYLE,GetWindowLongPtrW(main,GWL_EXSTYLE)&~(WS_EX_DLGMODALFRAME|WS_EX_WINDOWEDGE|WS_EX_CLIENTEDGE));
    RECT work{};SystemParametersInfoW(SPI_GETWORKAREA,0,&work,0);SetWindowPos(main,nullptr,work.left+((work.right-work.left)-px(640))/2,work.top+((work.bottom-work.top)-px(426))/2,px(640),px(426),SWP_NOZORDER|SWP_NOACTIVATE|SWP_FRAMECHANGED);
    WNDCLASSW cls{};cls.hInstance=g_module;cls.lpszClassName=L"TimerInstallerPixels";cls.lpfnWndProc=CanvasProc;cls.hCursor=LoadCursorW(nullptr,IDC_ARROW);RegisterClassW(&cls);g_canvas=CreateWindowExW(0,cls.lpszClassName,L"",WS_CHILD|WS_VISIBLE|WS_CLIPSIBLINGS,0,0,px(640),px(426),main,nullptr,g_module,nullptr);SetWindowPos(g_canvas,HWND_BOTTOM,0,0,0,0,SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE);SetTimer(main,7121,80,nullptr);layout();
}
extern "C" __declspec(dllexport) void __stdcall Refresh(){layout();}
extern "C" __declspec(dllexport) void __stdcall SetPhase(int phase){g_phase=phase;layout();}
extern "C" __declspec(dllexport) int __stdcall VerifyPayload(const wchar_t* file,const wchar_t* expected){
    if(!file||!expected||wcslen(expected)!=64)return 0;HANDLE f=CreateFileW(file,GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_FLAG_SEQUENTIAL_SCAN,nullptr);if(f==INVALID_HANDLE_VALUE)return 0;BCRYPT_ALG_HANDLE alg=nullptr;BCRYPT_HASH_HANDLE hash=nullptr;bool ok=BCryptOpenAlgorithmProvider(&alg,BCRYPT_SHA256_ALGORITHM,nullptr,0)>=0;DWORD size=0,used=0;if(ok)ok=BCryptGetProperty(alg,BCRYPT_OBJECT_LENGTH,reinterpret_cast<PUCHAR>(&size),sizeof(size),&used,0)>=0;std::vector<UCHAR> object(size),buffer(65536);if(ok)ok=BCryptCreateHash(alg,&hash,object.data(),size,nullptr,0,0)>=0;DWORD got=0;while(ok){if(!ReadFile(f,buffer.data(),static_cast<DWORD>(buffer.size()),&got,nullptr)){ok=false;break;}if(!got)break;ok=BCryptHashData(hash,buffer.data(),got,0)>=0;}UCHAR digest[32]{};if(ok)ok=BCryptFinishHash(hash,digest,32,0)>=0;if(hash)BCryptDestroyHash(hash);if(alg)BCryptCloseAlgorithmProvider(alg,0);CloseHandle(f);if(!ok)return 0;const wchar_t* hex=L"0123456789abcdef";for(int i=0;i<32;++i)if(towlower(expected[i*2])!=hex[digest[i]>>4]||towlower(expected[i*2+1])!=hex[digest[i]&15])return 0;return 1;
}
static DWORD checkResourceTree(const std::wstring& directory,unsigned depth,unsigned& visited){
    DWORD attr=GetFileAttributesW(directory.c_str());if(attr==INVALID_FILE_ATTRIBUTES)return ERROR_SUCCESS;if(attr&FILE_ATTRIBUTE_REPARSE_POINT)return ERROR_REPARSE_TAG_INVALID;if(!(attr&FILE_ATTRIBUTE_DIRECTORY))return ERROR_DIRECTORY;if(depth>32)return ERROR_DIRECTORY;
    WIN32_FIND_DATAW entry{};HANDLE find=FindFirstFileW((directory+L"\\*").c_str(),&entry);if(find==INVALID_HANDLE_VALUE){DWORD error=GetLastError();return error==ERROR_FILE_NOT_FOUND?ERROR_SUCCESS:error;}
    DWORD error=ERROR_SUCCESS;do{if(wcscmp(entry.cFileName,L".")==0||wcscmp(entry.cFileName,L"..")==0)continue;if(++visited>10000){error=ERROR_DIRECTORY;break;}if(entry.dwFileAttributes&FILE_ATTRIBUTE_REPARSE_POINT){error=ERROR_REPARSE_TAG_INVALID;break;}if(entry.dwFileAttributes&FILE_ATTRIBUTE_DIRECTORY){error=checkResourceTree(directory+L"\\"+entry.cFileName,depth+1,visited);if(error)break;}}while(FindNextFileW(find,&entry));FindClose(find);return error;
}
extern "C" __declspec(dllexport) DWORD __stdcall CheckTarget(const wchar_t* directory){
    if(!directory||wcslen(directory)<4||wcslen(directory)>240||!iswalpha(directory[0])||directory[1]!=L':'||directory[2]!=L'\\'||wcsstr(directory,L"..")||wcschr(directory+2,L':'))return ERROR_BAD_PATHNAME;
    // Reject reparse points at every existing directory component before any write.
    std::wstring path(directory);for(size_t i=3;i<=path.size();++i)if(i==path.size()||path[i]==L'\\'){auto part=path.substr(0,i);DWORD attr=GetFileAttributesW(part.c_str());if(attr!=INVALID_FILE_ATTRIBUTES&&(attr&FILE_ATTRIBUTE_REPARSE_POINT))return ERROR_REPARSE_TAG_INVALID;}
    unsigned visited=0;DWORD tree=checkResourceTree(path+L"\\notices",0,visited);if(tree)return tree;
    for(const auto* name:{L"TIMER.ico",L"install-manifest.json",L"timer-install.ini",L"uninstall.exe",L".timer-update.exe",L".timer-previous.exe"}){DWORD attr=GetFileAttributesW((path+L"\\"+name).c_str());if(attr!=INVALID_FILE_ATTRIBUTES&&(attr&(FILE_ATTRIBUTE_DIRECTORY|FILE_ATTRIBUTE_REPARSE_POINT)))return ERROR_REPARSE_TAG_INVALID;}
    path+=L"\\pixel-mix.exe";DWORD attr=GetFileAttributesW(path.c_str());if(attr==INVALID_FILE_ATTRIBUTES)return ERROR_SUCCESS;if(attr&(FILE_ATTRIBUTE_DIRECTORY|FILE_ATTRIBUTE_REPARSE_POINT))return ERROR_ACCESS_DENIED;HANDLE f=CreateFileW(path.c_str(),GENERIC_READ|GENERIC_WRITE,0,nullptr,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,nullptr);if(f==INVALID_HANDLE_VALUE)return GetLastError();CloseHandle(f);return ERROR_SUCCESS;
}
extern "C" __declspec(dllexport) int __stdcall RemoveShortcutIfOwned(const wchar_t* path,const wchar_t* target){
    HRESULT init=CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED);IShellLinkW* link=nullptr;bool removed=false;
    if(SUCCEEDED(CoCreateInstance(CLSID_ShellLink,nullptr,CLSCTX_INPROC_SERVER,IID_PPV_ARGS(&link)))){IPersistFile* file=nullptr;if(SUCCEEDED(link->QueryInterface(IID_PPV_ARGS(&file)))){if(SUCCEEDED(file->Load(path,STGM_READ))){wchar_t actual[32768]{};if(SUCCEEDED(link->GetPath(actual,32768,nullptr,SLGP_RAWPATH))&&_wcsicmp(actual,target)==0)removed=DeleteFileW(path)!=0;}file->Release();}link->Release();}if(SUCCEEDED(init))CoUninitialize();return removed?1:0;
}
