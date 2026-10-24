#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![forbid(unsafe_code)]

use sha2::{Digest, Sha256};
use std::{
    io::{BufRead, BufReader, Read},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{mpsc, Mutex},
    time::Duration,
};
use tauri::{
    window::{Color, Effect, EffectsBuilder},
    Manager, WebviewUrl, WebviewWindowBuilder,
};

fn verify_release(root: &PathBuf, node: &PathBuf) -> Result<(), Box<dyn std::error::Error>> {
    if cfg!(debug_assertions) && !root.join("BUILD-INFO.json").is_file() {
        return Ok(());
    }
    let pin: serde_json::Value =
        serde_json::from_str(include_str!("../../../scripts/packaging/node-runtime.json"))?;
    let mut file = std::fs::File::open(node)?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    if format!("{:x}", hash.finalize()) != pin["sha256"].as_str().ok_or("运行时校验配置无效")?
    {
        return Err("随包运行时校验失败，请重新安装".into());
    }
    // The publisher key is embedded in this signed executable, rather than trusted from disk.
    let check = r#"const fs=require('node:fs'),p=require('node:path'),c=require('node:crypto');try{const root=process.argv[1],pub=JSON.parse(process.argv[2].replace(/^\uFEFF/,'')),raw=fs.readFileSync(p.join(root,'BUILD-INFO.json')),sig=Buffer.from(fs.readFileSync(p.join(root,'BUILD-INFO.json.sig'),'ascii').trim(),'base64'),key=c.createPublicKey({format:'jwk',key:{kty:'RSA',n:Buffer.from(pub.modulus,'base64').toString('base64url'),e:Buffer.from(pub.exponent,'base64').toString('base64url')}});if(!c.verify('sha256',raw,key,sig))throw Error();const info=JSON.parse(raw.toString().replace(/^\uFEFF/,''));if(info.publisher!=='HOSHINO TEAM')throw Error();for(const [name,hash]of Object.entries(info.hashes)){const file=p.resolve(root,name);if(!file.startsWith(p.resolve(root)+p.sep)||c.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==hash)throw Error();}}catch{process.exit(1)}"#;
    let mut command = Command::new(node);
    command
        .args(["-e", check])
        .arg(root)
        .arg(include_str!("../../../scripts/packaging/publisher.json"))
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_PATH")
        .env_remove("OPENSSL_CONF")
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    if !command.status()?.success() {
        return Err("程序文件或发布签名校验失败，请重新安装；个人数据不会被删除".into());
    }
    Ok(())
}

struct Service(Mutex<Option<Child>>);
impl Drop for Service {
    fn drop(&mut self) {
        if let Ok(mut child) = self.0.lock() {
            if let Some(child) = child.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

fn root_directory() -> Result<PathBuf, Box<dyn std::error::Error>> {
    let exe_dir = std::env::current_exe()?
        .parent()
        .ok_or("应用目录无效")?
        .to_owned();
    if exe_dir.join("server.mjs").is_file() {
        return Ok(exe_dir);
    }
    if cfg!(debug_assertions) {
        return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()?);
    }
    Err("没有找到应用文件，请完整解压安装包".into())
}

fn open_external(url: &tauri::Url) {
    let allowed = url.host_str() == Some("uri.amap.com")
        || url.host_str() == Some("teach.dlut.edu.cn")
        || (url.host_str() == Some("platform.deepseek.com") && url.path() == "/api_keys");
    if url.scheme() != "https" || !allowed || !url.username().is_empty() || url.password().is_some()
    {
        return;
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let explorer = PathBuf::from(std::env::var_os("WINDIR").unwrap_or("C:\\Windows".into()))
            .join("explorer.exe");
        let _ = Command::new(explorer)
            .arg(url.as_str())
            .creation_flags(0x08000000)
            .spawn();
    }
}

fn start_service(root: &PathBuf) -> Result<(Service, u16), Box<dyn std::error::Error>> {
    let exe_dir = std::env::current_exe()?
        .parent()
        .ok_or("应用目录无效")?
        .to_owned();
    let bundled_node = root.join("runtime/node.exe");
    let node = if bundled_node.is_file() {
        bundled_node
    } else {
        if !cfg!(debug_assertions) {
            return Err("缺少随包 Node 兼容运行时".into());
        }
        std::env::var_os("XINGYE_NODE")
            .map(PathBuf::from)
            .ok_or("开发运行请设置 XINGYE_NODE 为 node.exe 的绝对路径")?
    };
    verify_release(root, &node)?;
    let helper = exe_dir.join(if cfg!(windows) {
        "xingye-vault.exe"
    } else {
        "xingye-vault"
    });
    if !helper.is_file() {
        return Err("缺少 Rust 加密引擎，请先构建 xingye-vault".into());
    }
    let log_directory = std::env::var_os("DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| root.join("data"));
    std::fs::create_dir_all(&log_directory)?;
    let log_path = log_directory.join("service-errors.log");
    if std::fs::metadata(&log_path)
        .map(|m| m.len() > 2 * 1024 * 1024)
        .unwrap_or(false)
    {
        let _ = std::fs::rename(&log_path, log_directory.join("service-errors.previous.log"));
    }
    let error_log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)?;
    let mut command = Command::new(node);
    command
        .arg(root.join("server.mjs"))
        .current_dir(root)
        .env("HOST", "127.0.0.1")
        .env("PORT", "0")
        .env("XINGYE_DESKTOP", "1")
        .env("XINGYE_VAULT_HELPER", helper)
        .env_remove("TLS_PFX_PATH")
        .env_remove("TLS_PFX_PASSWORD")
        .env_remove("TLS_CERT_PATH")
        .env_remove("TLS_KEY_PATH")
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_PATH")
        .stdout(Stdio::piped())
        .stderr(Stdio::from(error_log))
        .stdin(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let mut child = command.spawn()?;
    let stdout = child.stdout.take().ok_or("无法读取本机服务状态")?;
    let service = Service(Mutex::new(Some(child)));
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut line = String::new();
            match (&mut reader).take(4097).read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) if line.len() > 4096 => break,
                Ok(_) => {}
            }
            if let Some(raw) = line.strip_prefix("XINGYE_DESKTOP_READY ") {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) {
                    if let Some(port) = value["port"].as_u64().filter(|p| *p > 0 && *p <= 65535) {
                        let _ = tx.send(port as u16);
                    }
                }
            }
        }
    });
    let port = rx
        .recv_timeout(Duration::from_secs(20))
        .map_err(|_| "本机服务未能启动，未连接任何已有端口")?;
    Ok((service, port))
}

#[tauri::command]
fn window_action(window: tauri::WebviewWindow, action: &str) -> Result<(), String> {
    let result = match action {
        "drag" => window.start_dragging(),
        "minimize" => window.minimize(),
        "maximize" => window.is_maximized().and_then(|max| {
            if max {
                window.unmaximize()
            } else {
                window.maximize()
            }
        }),
        "close" => window.close(),
        "courses" => {
            if let Some(existing) = window.app_handle().get_webview_window("daily-courses") {
                return existing.set_focus().map_err(|e| e.to_string());
            }
            let mut url = window.url().map_err(|e| e.to_string())?;
            url.set_path("/");
            url.set_query(Some("view=courses"));
            let origin = url.origin();
            WebviewWindowBuilder::new(
                window.app_handle(),
                "daily-courses",
                WebviewUrl::External(url),
            )
            .title("每日课表 · 星野记")
            .inner_size(440.0, 720.0)
            .min_inner_size(340.0, 440.0)
            .on_navigation(move |url| url.origin() == origin)
            .build()
            .map(|_| ())
        }
        "theme-dark" | "theme-light" => {
            let dark = action == "theme-dark";
            let theme = if dark {
                tauri::Theme::Dark
            } else {
                tauri::Theme::Light
            };
            #[cfg(windows)]
            {
                let tint = if dark {
                    Color(20, 29, 43, 140)
                } else {
                    Color(225, 233, 248, 100)
                };
                let _ = window.set_effects(
                    EffectsBuilder::new()
                        .effect(Effect::Acrylic)
                        .color(tint)
                        .build(),
                );
            }
            window.set_theme(Some(theme))
        }
        _ => return Err("不支持的窗口操作".into()),
    };
    result.map_err(|e| e.to_string())
}

fn main() {
    if let Err(error) = run() {
        let message = format!("星野记启动失败：{error}");
        eprintln!("{message}");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let powershell =
                PathBuf::from(std::env::var_os("WINDIR").unwrap_or("C:\\Windows".into()))
                    .join("System32/WindowsPowerShell/v1.0/powershell.exe");
            // Error text is data in an environment variable, never interpolated as code.
            if !std::env::args().any(|arg| arg == "--check-window") {
                let _ = Command::new(powershell).args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command",
                "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show($env:XINGYE_STARTUP_ERROR, '星野记') | Out-Null"])
                .env("XINGYE_STARTUP_ERROR", message).creation_flags(0x08000000).spawn();
            }
        }
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let check_window = std::env::args().any(|arg| arg == "--check-window");
    if check_window && std::env::var_os("DATA_DIR").is_none() {
        return Err("窗口检查必须指定隔离的 DATA_DIR".into());
    }
    let root = root_directory()?;
    let (service, port) = start_service(&root)?;
    let address = format!("http://127.0.0.1:{port}/");
    let expected = address.parse::<tauri::Url>()?;
    let origin = expected.origin();
    tauri::Builder::default()
        .manage(service)
        .invoke_handler(tauri::generate_handler![window_action])
        .setup(move |app| {
            app.add_capability(
                tauri::ipc::CapabilityBuilder::new("instance-window")
                    .local(false)
                    .window("main")
                    .remote(address)
                    .permission("window-actions"),
            )?;
            // Remote pages can never use native capabilities or replace the app document.
            let mut builder =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::External(expected.clone()))
                    .title("星野记")
                    .inner_size(1280.0, 900.0)
                    .min_inner_size(720.0, 560.0)
                    .visible(!check_window)
                    .decorations(false)
                    .transparent(true)
                    .background_color(Color(0, 0, 0, 0))
                    .initialization_script("window.__XINGYE_NATIVE__ = true;")
                    .on_navigation(move |url| {
                        if url.origin() == origin {
                            true
                        } else {
                            open_external(url);
                            false
                        }
                    })
                    .on_new_window(|url, _features| {
                        open_external(&url);
                        tauri::webview::NewWindowResponse::Deny
                    });
            if check_window {
                builder = builder.data_directory(
                    PathBuf::from(std::env::var_os("DATA_DIR").ok_or("缺少隔离数据目录")?)
                        .join("webview-check"),
                );
            }
            let window = builder.build()?;
            if !check_window {
                let handle = app.handle().clone();
                std::thread::spawn(move || loop {
                    std::thread::sleep(Duration::from_secs(2));
                    let Some(window) = handle.get_webview_window("main") else {
                        break;
                    };
                    let stopped = {
                        let service = handle.state::<Service>();
                        let result = match service.0.lock() {
                            Ok(mut guard) => match guard.as_mut() {
                                Some(child) => child
                                    .try_wait()
                                    .map(|status| status.is_some())
                                    .unwrap_or(true),
                                None => true,
                            },
                            Err(_) => true,
                        };
                        result
                    };
                    if stopped {
                        let _ = window
                            .eval("window.dispatchEvent(new Event('xingye:service-stopped'))");
                        break;
                    }
                });
            }
            if check_window {
                let handle = app.handle().clone();
                // Exercise actual WebView2 window construction without showing test data.
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(3));
                    handle.exit(0);
                });
            }
            #[cfg(windows)]
            {
                // Native OS composition reflects content behind the actual window.
                // Unsupported OS / disabled transparency gracefully retains the web surface.
                let _ = window.set_effects(
                    EffectsBuilder::new()
                        .effect(Effect::Acrylic)
                        .color(Color(225, 233, 248, 100))
                        .build(),
                );
            }
            Ok(())
        })
        .run(tauri::generate_context!())?;
    Ok(())
}
