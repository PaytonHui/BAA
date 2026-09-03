//! Compile the on-device Apple Intelligence Swift FFI into a static library.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    tauri_build::build();

    if env::var("CARGO_CFG_TARGET_OS").unwrap_or_default() != "macos" {
        return;
    }

    let target = env::var("TARGET").unwrap_or_default();
    if !target.starts_with("aarch64-apple-") {
        println!(
            "cargo:warning=On-device Apple Intelligence requires Apple Silicon; skipping Swift FFI on {target}"
        );
        return;
    }

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let swift_src = manifest_dir.join("native/BaaAppleIntelligence.swift");
    println!("cargo:rerun-if-changed={}", swift_src.display());

    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    let module_name = "baa_ai";
    let lib_path = out_dir.join(format!("lib{module_name}.a"));

    let sdk_path = xcrun_str(&["--sdk", "macosx", "--show-sdk-path"]);
    if let Some(ref sdk) = sdk_path {
        write_swift_concurrency_link_stub(Path::new(sdk), &out_dir);
        println!(
            "cargo:rerun-if-changed={}",
            Path::new(sdk).join("SDKSettings.json").display()
        );
    }

    let mut args: Vec<String> = vec![
        "-emit-library".into(),
        "-static".into(),
        "-module-name".into(),
        "BaaAI".into(),
        "-swift-version".into(),
        "6".into(),
        "-target".into(),
        "arm64-apple-macosx26.0".into(),
        "-o".into(),
        lib_path.to_string_lossy().into_owned(),
    ];
    if matches!(
        env::var("OPT_LEVEL").ok().as_deref(),
        Some("1" | "2" | "3")
    ) {
        args.push("-O".into());
    } else if matches!(env::var("OPT_LEVEL").ok().as_deref(), Some("s" | "z")) {
        args.push("-Osize".into());
    }
    if let Some(sdk) = sdk_path.as_deref() {
        args.push("-sdk".into());
        args.push(sdk.to_string());
    }
    args.push(swift_src.to_string_lossy().into_owned());

    let swiftc = env::var("SWIFTC").unwrap_or_else(|_| "swiftc".into());
    let status = Command::new(&swiftc)
        .args(&args)
        .status()
        .expect("failed to spawn swiftc");
    if !status.success() {
        panic!("swiftc failed with {status}");
    }

    println!("cargo:rustc-link-search=native={}", out_dir.display());
    println!("cargo:rustc-link-lib=static={module_name}");
    println!("cargo:rustc-link-lib=framework=Foundation");
    println!("cargo:rustc-link-lib=framework=FoundationModels");
    println!("cargo:rustc-link-lib=framework=Vision");
    println!("cargo:rustc-link-lib=framework=CoreGraphics");
    println!("cargo:rustc-link-lib=framework=ImageIO");

    if let Some(swift_lib) = swift_lib_path() {
        println!("cargo:rustc-link-search=native={swift_lib}");
    }
}

fn xcrun_str(args: &[&str]) -> Option<String> {
    let out = Command::new("xcrun").args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

fn swift_lib_path() -> Option<String> {
    let swift = xcrun_str(&["--toolchain", "default", "--find", "swift"])?;
    let toolchain = Path::new(&swift).parent()?.parent()?;
    let lib = toolchain.join("lib/swift/macosx");
    if lib.exists() {
        Some(lib.to_string_lossy().into_owned())
    } else {
        None
    }
}

/// Same rpath workaround as fm-rs: Foundation Models needs the macOS 26
/// Swift Concurrency runtime from the dyld cache, not the older @rpath stub.
fn write_swift_concurrency_link_stub(sdk_path: &Path, out_dir: &Path) {
    const PREVIOUS_INSTALL_NAME: &str = "$ld$previous$@rpath/libswift_Concurrency.dylib";
    const DISABLED_INSTALL_NAME: &str =
        "__baa_disabled_previous_install_name$@rpath/libswift_Concurrency.dylib";
    let source = sdk_path.join("usr/lib/swift/libswift_Concurrency.tbd");
    if !source.exists() {
        return;
    }
    println!("cargo:rerun-if-changed={}", source.display());
    if let Ok(contents) = fs::read_to_string(&source) {
        let contents = contents.replace(PREVIOUS_INSTALL_NAME, DISABLED_INSTALL_NAME);
        let _ = fs::write(out_dir.join("libswift_Concurrency.tbd"), contents);
    }
}
