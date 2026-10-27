// TIMER's read-only, per-file Shell icon handler. No registration entry points,
// process creation, network, UI, write access, recipe execution or data import.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <shlobj.h>
#include <propsys.h>
#include <thumbcache.h>
#include <bcrypt.h>
#include <atomic>
#include <cstdint>
#include <cstring>
#include <cwchar>
#include <new>
#include <string>
#include <vector>
#include <algorithm>

// Contract v4 accepts TIMER's new suffix and existing archives. Explorer can
// retain a v3 factory that only accepts the old suffix, so use new identities.
// Previous classes remain registered for already-live objects; no cache purge.
// {81AB84EC-130C-4A8F-84B1-A9C11F10BCCA}
static constexpr CLSID kClsid = {0x81ab84ec,0x130c,0x4a8f,{0x84,0xb1,0xa9,0xc1,0x1f,0x10,0xbc,0xca}};
// {34AC24F9-FF06-4610-A459-A49A6E30535D}
static constexpr CLSID kThumbnailClsid = {0x34ac24f9,0xff06,0x4610,{0xa4,0x59,0xa4,0x9a,0x6e,0x30,0x53,0x5d}};
static std::atomic<long> g_objects{0}, g_locks{0};
static constexpr size_t kMaxBytes = 524288;
static constexpr char kSeparator[] = "\nPIXELMIX-ARCHIVE/2\n";
static constexpr char kFooter[] = "PMIX-END2";
static uint16_t u16(const BYTE* p) { return uint16_t(p[0]) | (uint16_t(p[1])<<8); }
static uint32_t u32(const BYTE* p) { return uint32_t(p[0]) | (uint32_t(p[1])<<8) | (uint32_t(p[2])<<16) | (uint32_t(p[3])<<24); }

static bool local_path(const wchar_t* p) {
    if (!p) return false;
    const size_t n = wcsnlen_s(p,32768);
    if (n < 13 || n >= 32768 || !((p[0]>=L'A'&&p[0]<=L'Z')||(p[0]>=L'a'&&p[0]<=L'z'))
        || p[1]!=L':' || (p[2]!=L'\\'&&p[2]!=L'/') || (_wcsicmp(p+n-9,L".timermix")!=0 && _wcsicmp(p+n-9,L".pixelmix")!=0)) return false;
    for (size_t i=2;i<n;++i) if (p[i]==L':' || p[i]<32) return false;
    if (wcsstr(p,L"\\..\\") || wcsstr(p,L"/../")) return false;
    wchar_t root[] = {p[0],L':',L'\\',0};
    const UINT drive = GetDriveTypeW(root);
    return drive==DRIVE_FIXED || drive==DRIVE_REMOVABLE || drive==DRIVE_RAMDISK;
}

struct Frame { unsigned side; size_t offset, length; };
static bool validate(const std::vector<BYTE>& bytes, std::vector<Frame>& frames) {
    if (bytes.size()<6+45+sizeof(kSeparator)-1 || bytes.size()>kMaxBytes || u32(bytes.data())!=0x00010000) return false;
    const size_t length_at=bytes.size()-45;
    if (memcmp(bytes.data()+bytes.size()-9,kFooter,9)!=0) return false;
    const size_t json_len=u32(bytes.data()+length_at);
    if (json_len>length_at || length_at-json_len<sizeof(kSeparator)-1) return false;
    const size_t icon_end=length_at-json_len-(sizeof(kSeparator)-1);
    if (memcmp(bytes.data()+icon_end,kSeparator,sizeof(kSeparator)-1)!=0) return false;
    BYTE hash[32]{};
    if (BCryptHash(BCRYPT_SHA256_ALG_HANDLE,nullptr,0,const_cast<BYTE*>(bytes.data()),static_cast<ULONG>(length_at+4),hash,32)<0
        || memcmp(hash,bytes.data()+length_at+4,32)!=0) return false;
    const unsigned count=u16(bytes.data()+4);
    if (count<1 || count>8 || 6+16*count>icon_end) return false;
    size_t expected=6+16*count;
    for (unsigned i=0;i<count;++i) {
        const BYTE* d=bytes.data()+6+i*16;
        const unsigned n=d[0]?d[0]:256;
        const size_t length=u32(d+8),offset=u32(d+12),mask_stride=((n+31)/32)*4;
        if (!(n==16||n==24||n==32||n==48||n==64||n==96||n==128||n==256)
            || d[1]!=d[0] || d[2] || d[3] || u16(d+4)!=1 || u16(d+6)!=32
            || offset!=expected || length!=40+n*n*4+mask_stride*n
            || offset>icon_end || length>icon_end-offset) return false;
        const BYTE* bitmap=bytes.data()+offset;
        if (u32(bitmap)!=40 || u32(bitmap+4)!=n || u32(bitmap+8)!=n*2
            || u16(bitmap+12)!=1 || u16(bitmap+14)!=32 || u32(bitmap+16)!=BI_RGB) return false;
        frames.push_back({n,offset,length}); expected+=length;
    }
    return expected==icon_end;
}

static HRESULT read_file(const std::wstring& path,std::vector<BYTE>& bytes,std::vector<Frame>& frames) {
    if (!local_path(path.c_str())) return E_ACCESSDENIED;
    // OPEN_REPARSE_POINT makes the final-component reparse check race-safe.
    HANDLE file=CreateFileW(path.c_str(),GENERIC_READ,FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,
        nullptr,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL|FILE_FLAG_OPEN_REPARSE_POINT|FILE_FLAG_SEQUENTIAL_SCAN,nullptr);
    if (file==INVALID_HANDLE_VALUE) return HRESULT_FROM_WIN32(GetLastError());
    BY_HANDLE_FILE_INFORMATION info{}; LARGE_INTEGER size{};
    const bool valid=GetFileInformationByHandle(file,&info) && GetFileSizeEx(file,&size)
        && !(info.dwFileAttributes&(FILE_ATTRIBUTE_DIRECTORY|FILE_ATTRIBUTE_REPARSE_POINT))
        && size.QuadPart>0 && size.QuadPart<=kMaxBytes;
    if (!valid) { CloseHandle(file); return E_ACCESSDENIED; }
    // Reject network targets reached via a parent reparse point as well.
    wchar_t resolved[32768];
    const DWORD count=GetFinalPathNameByHandleW(file,resolved,32768,FILE_NAME_NORMALIZED|VOLUME_NAME_DOS);
    if (count<7 || count>=32768 || wcsncmp(resolved,L"\\\\?\\",4)!=0 || !local_path(resolved+4)) {
        CloseHandle(file); return E_ACCESSDENIED;
    }
    bytes.resize(static_cast<size_t>(size.QuadPart)); DWORD got=0;
    const bool read=ReadFile(file,bytes.data(),static_cast<DWORD>(bytes.size()),&got,nullptr)!=FALSE;
    CloseHandle(file);
    return read && got==bytes.size() && validate(bytes,frames) ? S_OK : HRESULT_FROM_WIN32(ERROR_INVALID_DATA);
}

static HICON image(const std::vector<BYTE>& bytes,const std::vector<Frame>& frames,unsigned size) {
    size=std::max(16u,std::min(256u,size));
    // Prefer the smallest available frame at least as large_icon as the request;
    // this avoids blurry upscaling when the Shell asks for 48/64/128px icons.
    const Frame* best=&frames.back();
    for (const auto& frame:frames) if (frame.side>=size && (best->side<size || frame.side<best->side)) best=&frame;
    return CreateIconFromResourceEx(const_cast<BYTE*>(bytes.data()+best->offset),static_cast<DWORD>(best->length),
        TRUE,0x00030000,static_cast<int>(size),static_cast<int>(size),LR_DEFAULTCOLOR);
}

static HBITMAP thumbnail(const std::vector<BYTE>& bytes,const std::vector<Frame>& frames,unsigned requested) {
    const unsigned size=std::max(1u,std::min(256u,requested));
    const Frame* best=&frames.back();
    for (const auto& frame:frames) if(frame.side>=size&&(best->side<size||frame.side<best->side))best=&frame;
    BITMAPINFO info{};info.bmiHeader.biSize=sizeof(BITMAPINFOHEADER);
    info.bmiHeader.biWidth=static_cast<LONG>(size);info.bmiHeader.biHeight=-static_cast<LONG>(size);
    info.bmiHeader.biPlanes=1;info.bmiHeader.biBitCount=32;info.bmiHeader.biCompression=BI_RGB;
    void* output=nullptr;HBITMAP bitmap=CreateDIBSection(nullptr,&info,DIB_RGB_COLORS,&output,nullptr,0);
    if(!bitmap||!output){if(bitmap)DeleteObject(bitmap);return nullptr;}
    // Integer nearest-neighbour sampling keeps the designed pixel edges sharp.
    // All frames use straight BGRA with binary alpha, so the same pixels also
    // meet the thumbnail API's premultiplied ARGB convention.
    const BYTE* source=bytes.data()+best->offset+40;BYTE* dest=static_cast<BYTE*>(output);
    for(unsigned y=0;y<size;++y)for(unsigned x=0;x<size;++x){
        const unsigned sx=std::min(best->side-1,((2*x+1)*best->side)/(2*size));
        const unsigned sy=std::min(best->side-1,((2*y+1)*best->side)/(2*size));
        const BYTE* p=source+((best->side-1-sy)*best->side+sx)*4;
        BYTE* q=dest+(y*size+x)*4;
        const unsigned a=p[3];q[0]=static_cast<BYTE>((p[0]*a+127)/255);q[1]=static_cast<BYTE>((p[1]*a+127)/255);
        q[2]=static_cast<BYTE>((p[2]*a+127)/255);q[3]=p[3];
    }
    return bitmap;
}

class Icon final:public IPersistFile,public IExtractIconW,public IExtractIconA,
    public IInitializeWithFile,public IInitializeWithStream,public IThumbnailProvider {
    std::atomic<ULONG> refs_{1}; CLSID clsid_; std::wstring path_;std::vector<BYTE> stream_bytes_;
    HRESULT extract(HICON* large_icon,HICON* small_icon,UINT sizes) noexcept {
        if (large_icon) *large_icon=nullptr; if (small_icon) *small_icon=nullptr;
        if (!large_icon && !small_icon) return E_POINTER;
        try {
            std::vector<BYTE> bytes;std::vector<Frame> frames;
            HRESULT result=read_file(path_,bytes,frames);if (FAILED(result)) return result;
            if (large_icon) *large_icon=image(bytes,frames,LOWORD(sizes)?LOWORD(sizes):32);
            if (small_icon) *small_icon=image(bytes,frames,HIWORD(sizes)?HIWORD(sizes):16);
            if ((large_icon&&!*large_icon)||(small_icon&&!*small_icon)) {
                if (large_icon&&*large_icon) { DestroyIcon(*large_icon);*large_icon=nullptr; }
                if (small_icon&&*small_icon) { DestroyIcon(*small_icon);*small_icon=nullptr; }
                return E_FAIL;
            }
            return S_OK;
        } catch (...) { return E_OUTOFMEMORY; }
    }
    uint64_t identity() const noexcept {
        uint64_t hash=14695981039346656037ULL;
        for (wchar_t c:path_) {hash^=static_cast<uint16_t>(c);hash*=1099511628211ULL;}
        return hash;
    }
public:
    explicit Icon(REFCLSID clsid):clsid_(clsid) {++g_objects;} ~Icon() {--g_objects;}
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid,void** out) override {
        if (!out) return E_POINTER;*out=nullptr;
        // Shell chooses initialization by QueryInterface, not by the registry
        // handler name. Advertising IInitializeWithStream on the icon CLSID
        // lets GetUIObjectOf initialize only stream_bytes_, leaving path_ empty
        // and GetIconLocation failing E_UNEXPECTED. These are two COM classes
        // sharing an implementation, with intentionally separate contracts.
        const bool icon_class=clsid_==kClsid;
        if (iid==IID_IUnknown) *out=static_cast<IPersistFile*>(this);
        else if (icon_class&&(iid==IID_IPersist||iid==IID_IPersistFile)) *out=static_cast<IPersistFile*>(this);
        else if (icon_class&&iid==IID_IExtractIconW) *out=static_cast<IExtractIconW*>(this);
        else if (icon_class&&iid==IID_IExtractIconA) *out=static_cast<IExtractIconA*>(this);
        else if (!icon_class&&iid==__uuidof(IInitializeWithFile)) *out=static_cast<IInitializeWithFile*>(this);
        else if (!icon_class&&iid==__uuidof(IInitializeWithStream)) *out=static_cast<IInitializeWithStream*>(this);
        else if (!icon_class&&iid==__uuidof(IThumbnailProvider)) *out=static_cast<IThumbnailProvider*>(this);
        else return E_NOINTERFACE;AddRef();return S_OK;
    }
    ULONG STDMETHODCALLTYPE AddRef() override {return ++refs_;}
    ULONG STDMETHODCALLTYPE Release() override {const ULONG n=--refs_;if (!n) delete this;return n;}
    HRESULT STDMETHODCALLTYPE GetClassID(CLSID* out) override {if (!out)return E_POINTER;*out=clsid_;return S_OK;}
    HRESULT STDMETHODCALLTYPE IsDirty() override {return S_FALSE;}
    HRESULT STDMETHODCALLTYPE Load(LPCOLESTR path,DWORD mode) override {
        if ((mode&3)!=STGM_READ||!local_path(path))return E_ACCESSDENIED;
        try {path_=path;return S_OK;}catch(...){return E_OUTOFMEMORY;}
    }
    HRESULT STDMETHODCALLTYPE Save(LPCOLESTR,BOOL) override {return STG_E_ACCESSDENIED;}
    HRESULT STDMETHODCALLTYPE SaveCompleted(LPCOLESTR) override {return STG_E_ACCESSDENIED;}
    HRESULT STDMETHODCALLTYPE GetCurFile(LPOLESTR* out) override {
        if (!out)return E_POINTER;*out=nullptr;if(path_.empty())return S_FALSE;
        const size_t bytes=(path_.size()+1)*sizeof(wchar_t);
        *out=static_cast<wchar_t*>(CoTaskMemAlloc(bytes));if(!*out)return E_OUTOFMEMORY;
        memcpy(*out,path_.c_str(),bytes);return S_OK;
    }
    HRESULT STDMETHODCALLTYPE GetIconLocation(UINT,LPWSTR name,UINT cap,int* index,UINT* flags) override {
        if(!name||!index||!flags)return E_POINTER;if(path_.empty())return E_UNEXPECTED;
        wchar_t key[64];swprintf_s(key,L"pixelmix-portrait-v3:%016llx",identity());
        if(cap<=wcslen(key))return HRESULT_FROM_WIN32(ERROR_INSUFFICIENT_BUFFER);
        wcscpy_s(name,cap,key);*index=0;*flags=GIL_PERINSTANCE|GIL_NOTFILENAME|GIL_DONTCACHE;return S_OK;
    }
    HRESULT STDMETHODCALLTYPE GetIconLocation(UINT,LPSTR name,UINT cap,int* index,UINT* flags) override {
        if(!name||!index||!flags)return E_POINTER;if(path_.empty())return E_UNEXPECTED;
        char key[64];sprintf_s(key,"pixelmix-portrait-v3:%016llx",identity());
        if(cap<=strlen(key))return HRESULT_FROM_WIN32(ERROR_INSUFFICIENT_BUFFER);
        strcpy_s(name,cap,key);*index=0;*flags=GIL_PERINSTANCE|GIL_NOTFILENAME|GIL_DONTCACHE;return S_OK;
    }
    HRESULT STDMETHODCALLTYPE Extract(LPCWSTR,UINT,HICON* large_icon,HICON* small_icon,UINT sizes) override {return extract(large_icon,small_icon,sizes);}
    HRESULT STDMETHODCALLTYPE Extract(LPCSTR,UINT,HICON* large_icon,HICON* small_icon,UINT sizes) override {return extract(large_icon,small_icon,sizes);}
    HRESULT STDMETHODCALLTYPE Initialize(LPCWSTR path,DWORD mode) override {
        if(!path_.empty()||!stream_bytes_.empty())return HRESULT_FROM_WIN32(ERROR_ALREADY_INITIALIZED);
        return Load(path,mode);
    }
    HRESULT STDMETHODCALLTYPE Initialize(IStream* stream,DWORD mode) override {
        if(!stream)return E_POINTER;if((mode&3)!=STGM_READ)return E_ACCESSDENIED;
        if(!path_.empty()||!stream_bytes_.empty())return HRESULT_FROM_WIN32(ERROR_ALREADY_INITIALIZED);
        try{
            // Shell supplies the already-open read stream. We create no network
            // connection, retain no stream and require no isolation override.
            std::vector<BYTE> bytes(kMaxBytes+1);size_t offset=0;unsigned calls=0;
            while(offset<bytes.size()){
                if(++calls>4096)return HRESULT_FROM_WIN32(ERROR_INVALID_DATA);
                ULONG got=0;HRESULT hr=stream->Read(bytes.data()+offset,static_cast<ULONG>(bytes.size()-offset),&got);
                if(FAILED(hr)||got>bytes.size()-offset)return HRESULT_FROM_WIN32(ERROR_INVALID_DATA);
                offset+=got;if(hr==S_FALSE||got==0)break;
            }
            bytes.resize(offset);std::vector<Frame> frames;
            if(!validate(bytes,frames))return HRESULT_FROM_WIN32(ERROR_INVALID_DATA);
            stream_bytes_=std::move(bytes);return S_OK;
        }catch(...){return E_OUTOFMEMORY;}
    }
    HRESULT STDMETHODCALLTYPE GetThumbnail(UINT size,HBITMAP* out,WTS_ALPHATYPE* alpha) override {
        if(!out||!alpha)return E_POINTER;*out=nullptr;*alpha=WTSAT_UNKNOWN;if(!size)return E_INVALIDARG;
        try{
            std::vector<BYTE> bytes;std::vector<Frame> frames;
            if(stream_bytes_.empty()){
                HRESULT hr=read_file(path_,bytes,frames);if(FAILED(hr))return hr;
            }else{bytes=stream_bytes_;if(!validate(bytes,frames))return HRESULT_FROM_WIN32(ERROR_INVALID_DATA);}
            *out=thumbnail(bytes,frames,size);if(!*out)return E_OUTOFMEMORY;
            *alpha=WTSAT_ARGB;return S_OK;
        }catch(...){return E_OUTOFMEMORY;}
    }
};

class Factory final:public IClassFactory {
    std::atomic<ULONG> refs_{1};CLSID clsid_;
public:
    explicit Factory(REFCLSID clsid):clsid_(clsid){++g_objects;}~Factory(){--g_objects;}
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid,void** out) override {
        if(!out)return E_POINTER;*out=nullptr;
        if(iid!=IID_IUnknown&&iid!=IID_IClassFactory)return E_NOINTERFACE;
        *out=static_cast<IClassFactory*>(this);AddRef();return S_OK;
    }
    ULONG STDMETHODCALLTYPE AddRef() override {return ++refs_;}
    ULONG STDMETHODCALLTYPE Release() override {const ULONG n=--refs_;if(!n)delete this;return n;}
    HRESULT STDMETHODCALLTYPE CreateInstance(IUnknown* outer,REFIID iid,void** out) override {
        if(!out)return E_POINTER;*out=nullptr;if(outer)return CLASS_E_NOAGGREGATION;
        Icon* object=new(std::nothrow)Icon(clsid_);if(!object)return E_OUTOFMEMORY;
        HRESULT result=object->QueryInterface(iid,out);object->Release();return result;
    }
    HRESULT STDMETHODCALLTYPE LockServer(BOOL lock) override {if(lock)++g_locks;else --g_locks;return S_OK;}
};

extern "C" HRESULT __stdcall DllGetClassObject(REFCLSID clsid,REFIID iid,void** out) {
    if(!out)return E_POINTER;*out=nullptr;if(clsid!=kClsid&&clsid!=kThumbnailClsid)return CLASS_E_CLASSNOTAVAILABLE;
    Factory* factory=new(std::nothrow)Factory(clsid);if(!factory)return E_OUTOFMEMORY;
    HRESULT result=factory->QueryInterface(iid,out);factory->Release();return result;
}
extern "C" HRESULT __stdcall DllCanUnloadNow() {return g_objects==0&&g_locks==0?S_OK:S_FALSE;}
