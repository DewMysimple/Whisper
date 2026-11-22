fn main() {
    println!("cargo:rerun-if-env-changed=WHISPER_SUBTITLE_BUILD_REVISION");
    println!("cargo:rerun-if-env-changed=WHISPER_SUBTITLE_BUILD_TIME");
    tauri_build::build()
}
