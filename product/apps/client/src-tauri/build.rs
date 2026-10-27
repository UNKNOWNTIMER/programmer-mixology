fn main() {
    println!("cargo:rerun-if-changed=native/icon_handler.cpp");
    println!("cargo:rerun-if-changed=native/icon_handler.def");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let out = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
        let compiler = std::env::var_os("CXX").unwrap_or_else(|| "cl.exe".into());
        let status = std::process::Command::new(compiler)
            .args([
                "/nologo",
                "/std:c++17",
                "/W4",
                "/WX",
                "/O2",
                "/MT",
                "/LD",
                "/EHsc",
                "/guard:cf",
                "/GS",
                "/sdl",
                "/DUNICODE",
                "/D_UNICODE",
            ])
            .arg("native/icon_handler.cpp")
            .arg(format!(
                "/Fo{}",
                out.join("pixelmix-icon-handler.obj").display()
            ))
            .arg(format!(
                "/Fe{}",
                out.join("pixelmix-icon-handler.dll").display()
            ))
            .args([
                "/link",
                "/DEF:native/icon_handler.def",
                "/DYNAMICBASE",
                "/NXCOMPAT",
                "/HIGHENTROPYVA",
                "/GUARD:CF",
                "/Brepro",
                "/INCREMENTAL:NO",
                "bcrypt.lib",
                "user32.lib",
                "gdi32.lib",
                "ole32.lib",
                "uuid.lib",
            ])
            .status()
            .expect("MSVC is required to build the Windows per-file icon handler");
        assert!(
            status.success(),
            "Windows per-file icon handler build failed"
        );
    }
    tauri_build::build()
}
