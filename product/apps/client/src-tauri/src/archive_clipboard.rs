//! Windows file clipboard, never text interpreted as a filesystem path.
//! Copy accepts only an already validated own archive; paste reads the actual
//! clipboard while locked and validates every archive before returning any.
use std::path::{Path, PathBuf};
use serde_json::Value;

const MAX_FILES: usize = 20;
const MAX_CLIPBOARD_BYTES: usize = 1_048_576;
const DROP_HEADER: usize = 20;

fn file_drop_bytes(path: &Path) -> Result<Vec<u8>, String> {
    let text = path.to_str().ok_or("存档路径不是有效Unicode")?;
    if !path.is_absolute() || text.chars().any(char::is_control) {
        return Err("存档路径无效".into());
    }
    let mut bytes = vec![0; DROP_HEADER];
    bytes[..4].copy_from_slice(&(DROP_HEADER as u32).to_le_bytes());
    bytes[16..20].copy_from_slice(&1u32.to_le_bytes()); // DROPFILES.fWide
    for unit in text.encode_utf16().chain([0, 0]) { bytes.extend_from_slice(&unit.to_le_bytes()); }
    if bytes.len() > MAX_CLIPBOARD_BYTES { return Err("剪贴板文件路径过长".into()); }
    Ok(bytes)
}

fn drop_paths(bytes: &[u8]) -> Result<Vec<PathBuf>, String> {
    if bytes.len() < DROP_HEADER + 4 || bytes.len() > MAX_CLIPBOARD_BYTES {
        return Err("剪贴板文件列表大小无效".into());
    }
    let offset = u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize;
    let wide = u32::from_le_bytes(bytes[16..20].try_into().unwrap());
    // DROPFILES.fWide is a Win32 BOOL. .NET Framework writes TRUE as -1,
    // whereas Explorer and modern .NET commonly write 1. Both are Unicode.
    if wide == 0 || offset < DROP_HEADER || offset % 2 != 0 || offset > bytes.len()-4 || (bytes.len()-offset)%2 != 0 {
        return Err("剪贴板文件列表格式无效".into());
    }
    let words: Vec<u16> = bytes[offset..].chunks_exact(2).map(|s| u16::from_le_bytes([s[0],s[1]])).collect();
    let mut paths = Vec::new();
    let mut start = 0;
    for (at, &word) in words.iter().enumerate() {
        if word != 0 { continue; }
        if at == start {
            if paths.is_empty() { return Err("剪贴板中没有酒谱文件".into()); }
            return Ok(paths);
        }
        if paths.len() >= MAX_FILES || at-start >= 32768 { return Err("每次最多粘贴20个酒谱文件".into()); }
        let text = String::from_utf16(&words[start..at]).map_err(|_| "剪贴板路径不是有效Unicode")?;
        paths.push(PathBuf::from(text));
        start = at+1;
    }
    Err("剪贴板文件列表未完整结束".into())
}

#[cfg(windows)]
mod windows {
    use super::*;
    use windows_sys::Win32::{Foundation::{HWND,HGLOBAL,GlobalFree},System::{DataExchange::*,Memory::*}};
    const CF_HDROP: u32 = 15;
    struct Clipboard;
    impl Clipboard {
        fn open(owner: HWND) -> Result<Self,String> {
            for _ in 0..5 {
                if unsafe { OpenClipboard(owner) } != 0 { return Ok(Self); }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            Err("Windows剪贴板正在使用，请稍后重试".into())
        }
    }
    impl Drop for Clipboard { fn drop(&mut self) { unsafe { CloseClipboard(); } } }
    struct Memory(HGLOBAL);
    impl Memory {
        fn from_bytes(bytes:&[u8]) -> Result<Self,String> {
            let handle = unsafe { GlobalAlloc(GMEM_MOVEABLE,bytes.len()) };
            if handle.is_null() { return Err("无法分配剪贴板内存".into()); }
            let value=Self(handle);
            let pointer=unsafe { GlobalLock(handle) };
            if pointer.is_null() { return Err("无法锁定剪贴板内存".into()); }
            unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(),pointer.cast(),bytes.len());GlobalUnlock(handle); }
            Ok(value)
        }
        fn transfer(mut self, format:u32) -> Result<(),String> {
            if unsafe { SetClipboardData(format,self.0) }.is_null() { return Err("写入Windows剪贴板失败".into()); }
            self.0=std::ptr::null_mut(); // Windows now owns this memory, including after app exit.
            Ok(())
        }
    }
    impl Drop for Memory { fn drop(&mut self) { if !self.0.is_null() { unsafe { GlobalFree(self.0); } } } }
    pub fn copy(owner: HWND,path:&Path) -> Result<(),String> {
        let file = Memory::from_bytes(&file_drop_bytes(path)?)?;
        let effect = Memory::from_bytes(&1u32.to_le_bytes())?; // DROPEFFECT_COPY
        let name:Vec<u16>="Preferred DropEffect\0".encode_utf16().collect();
        let format=unsafe { RegisterClipboardFormatW(name.as_ptr()) };
        if format==0 { return Err("无法注册剪贴板文件复制格式".into()); }
        let _clipboard=Clipboard::open(owner)?;
        if unsafe { EmptyClipboard() } == 0 { return Err("无法更新Windows剪贴板".into()); }
        file.transfer(CF_HDROP)?;
        effect.transfer(format)?;
        Ok(())
    }
    pub fn paths(owner: HWND) -> Result<Vec<PathBuf>,String> {
        let _clipboard=Clipboard::open(owner)?;
        if unsafe { IsClipboardFormatAvailable(CF_HDROP) }==0 { return Err("剪贴板中没有.timermix酒谱文件".into()); }
        let handle=unsafe { GetClipboardData(CF_HDROP) };
        if handle.is_null() { return Err("无法读取剪贴板文件列表".into()); }
        let size=unsafe { GlobalSize(handle) };
        if size>MAX_CLIPBOARD_BYTES || size<DROP_HEADER+4 { return Err("剪贴板文件列表大小无效".into()); }
        let pointer=unsafe { GlobalLock(handle) };
        if pointer.is_null() { return Err("无法锁定剪贴板文件列表".into()); }
        let result=drop_paths(unsafe { std::slice::from_raw_parts(pointer.cast(),size) });
        unsafe { GlobalUnlock(handle); }
        result // Never DragFinish/GlobalFree: this is borrowed clipboard memory.
    }
}

pub fn copy(owner:isize,path:&Path) -> Result<(),String> {
    #[cfg(windows)] { windows::copy(owner as _,path) }
    #[cfg(not(windows))] { let _=(owner,path);Err("此平台尚未实现文件剪贴板".into()) }
}
pub fn paste(owner:isize) -> Result<Vec<Value>,String> {
    #[cfg(windows)] {
        let paths=windows::paths(owner as _)?;
        // Reading is authorized only by the live CF_HDROP; no path argument or
        // persistent read grant is exposed to JavaScript.
        paths.into_iter().map(|path| super::archive::read(&path)).collect()
    }
    #[cfg(not(windows))] { let _=owner;Err("此平台尚未实现文件剪贴板".into()) }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unicode_dropfiles_are_real_wide_double_null_terminated_paths() {
        let path=std::env::temp_dir().join("蓝色飓风_blue_hurricane.timermix");
        let bytes=file_drop_bytes(&path).unwrap();
        assert_eq!(drop_paths(&bytes).unwrap(),[path]);
        assert_eq!(&bytes[bytes.len()-4..],&[0,0,0,0]);
        assert!(file_drop_bytes(Path::new("relative.timermix")).is_err());
    }
    #[test]
    fn malformed_clipboards_are_bounded_and_never_treated_as_text_paths() {
        let path=std::env::temp_dir().join("one.timermix");
        let good=file_drop_bytes(&path).unwrap();
        for bytes in [vec![],b"C:\\one.timermix".to_vec(),good[..good.len()-2].to_vec(),vec![0;MAX_CLIPBOARD_BYTES+1]] { assert!(drop_paths(&bytes).is_err()); }
        for (at,value) in [(0,0),(0,255),(16,0)] { let mut bad=good.clone();bad[at]=value;assert!(drop_paths(&bad).is_err()); }
        let mut many=good[..DROP_HEADER].to_vec();
        for _ in 0..21 { many.extend_from_slice(&good[DROP_HEADER..good.len()-2]); }
        many.extend([0,0]);assert!(drop_paths(&many).is_err());
    }
    #[test]
    fn framework_true_accepts_multiple_unicode_files_with_global_memory_padding() {
        let paths=[std::env::temp_dir().join("蓝色飓风_blue_hurricane.timermix"),std::env::temp_dir().join("内格罗尼_negroni.timermix")];
        let mut bytes=file_drop_bytes(&paths[0]).unwrap();
        bytes.truncate(bytes.len()-2);
        bytes.extend_from_slice(&file_drop_bytes(&paths[1]).unwrap()[DROP_HEADER..]);
        bytes.extend_from_slice(&[0,0,0,0]);
        bytes[16..20].copy_from_slice(&u32::MAX.to_le_bytes());
        assert_eq!(drop_paths(&bytes).unwrap(),paths);
        bytes[16..20].copy_from_slice(&0u32.to_le_bytes());
        assert!(drop_paths(&bytes).is_err());
    }
}
