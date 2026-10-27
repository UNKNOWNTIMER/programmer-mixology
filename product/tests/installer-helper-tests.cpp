// Native checks with no visible windows, registry, shortcuts or existing user data writes.
#include "../packaging/v1.1/skin.cpp"
#include <iostream>
#include <filesystem>

int wmain(int argc,wchar_t** argv){
    if(argc!=5)return 64;int pass=0;
    auto check=[&](bool condition,const char* name){std::cout<<(condition?"PASS ":"FAIL ")<<name<<std::endl;if(!condition)ExitProcess(1);++pass;};
    check(VerifyPayload(argv[1],argv[2])==1,"actual payload SHA256");
    check(VerifyPayload(argv[1],L"0000000000000000000000000000000000000000000000000000000000000000")==0,"mismatched payload rejected");
    check(VerifyPayload(argv[1],L"invalid")==0,"invalid digest rejected");
    check(CheckTarget(L"C:\\")==ERROR_BAD_PATHNAME,"root directory rejected");
    check(CheckTarget(L"\\\\server\\folder")==ERROR_BAD_PATHNAME,"network path rejected");
    check(CheckTarget(L"C:\\some\\..\\other")==ERROR_BAD_PATHNAME,"parent traversal rejected");
    check(CheckTarget(L"C:\\some:stream")==ERROR_BAD_PATHNAME,"alternate stream rejected");
    std::filesystem::path task(argv[4]);check(!std::filesystem::exists(task),"isolated helper directory absent before test");
    check(std::filesystem::create_directories(task),"create isolated helper directory");
    check(CheckTarget(task.c_str())==ERROR_SUCCESS,"empty user directory accepted");
    auto exe=task/L"pixel-mix.exe";HANDLE file=CreateFileW(exe.c_str(),GENERIC_WRITE,0,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr);check(file!=INVALID_HANDLE_VALUE,"create own exclusive fixture");
    check(CheckTarget(task.c_str())!=ERROR_SUCCESS,"locked payload refused without termination");CloseHandle(file);
    check(CheckTarget(task.c_str())==ERROR_SUCCESS,"closed payload accepted");
    check(LoadPixelFont(argv[3])==1,"project WOFF2 decoded by Windows and privately loaded");
    HDC dc=CreateCompatibleDC(nullptr);HFONT font=CreateFontW(-16,0,0,0,FW_NORMAL,FALSE,FALSE,FALSE,DEFAULT_CHARSET,OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,NONANTIALIASED_QUALITY,FIXED_PITCH,g_face.c_str());auto old=SelectObject(dc,font);wchar_t actual[256]{};GetTextFaceW(dc,256,actual);check(std::wstring(actual).find(L"Fusion Pixel")!=std::wstring::npos,"GDI selected project pixel font without fallback");SelectObject(dc,old);DeleteObject(font);DeleteDC(dc);
    check(LoadPixelFont(argv[1])==0,"nonfont input rejected");
    HWND hidden=CreateWindowExW(0,L"STATIC",L"Installer hidden regression fixture",WS_POPUP,0,0,100,100,nullptr,nullptr,GetModuleHandleW(nullptr),nullptr);
    check(hidden!=nullptr,"create invisible skin regression fixture");
    CreateWindowExW(0,L"BUTTON",L"next",WS_CHILD,0,0,10,10,hidden,reinterpret_cast<HMENU>(1),GetModuleHandleW(nullptr),nullptr);
    CreateWindowExW(0,L"BUTTON",L"cancel",WS_CHILD,0,0,10,10,hidden,reinterpret_cast<HMENU>(2),GetModuleHandleW(nullptr),nullptr);
    ULONGLONG start=GetTickCount64();Attach(hidden);Refresh();
    check(GetTickCount64()-start<2000,"layout snapshots sibling handles and returns without reorder cycle");
    check(!IsWindowVisible(hidden),"skin regression fixture never becomes visible");
    HWND laterPage=CreateWindowExW(0,L"STATIC",L"Later page fixture",WS_CHILD,0,0,50,50,hidden,nullptr,GetModuleHandleW(nullptr),nullptr);
    SetWindowPos(laterPage,HWND_BOTTOM,0,0,0,0,SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE);Refresh();
    check(GetWindow(hidden,GW_CHILD)&&GetWindow(g_canvas,GW_HWNDNEXT)==nullptr,"new pages stay above the decorative canvas after refresh");
    DestroyWindow(hidden);
    std::filesystem::remove(exe);std::filesystem::remove(task);
    std::cout<<pass<<"/"<<pass<<" passed"<<std::endl;return 0;
}
