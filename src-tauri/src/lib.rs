// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

/// ===== 软件试用锁（授权管理）=====
/// 试用时长：2 天（毫秒）。自“首次打开软件”起计时，到期后锁定。
const TRIAL_MS: u64 = 2 * 24 * 60 * 60 * 1000;
// const TRIAL_MS: u64 = 0;
/// 解锁密码（前端不可见，仅内置在二进制中；如需修改请改这里）
const UNLOCK_PASSWORD: &str = "Abc81030839";
/// 允许系统时间小幅回拨的容差（时区/校时误差），超过则视为篡改时间续期
const CLOCK_GRACE_MS: u64 = 60 * 60 * 1000;

/// 授权文件名（位于系统应用数据目录，删除即可重置试用期，便于测试）
const LICENSE_FILE_NAME: &str = "license.json";

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 落盘的本机授权记录
#[derive(Serialize, Deserialize)]
struct LicenseFile {
    /// 首次启动时间（毫秒时间戳）——试用从这里开始计时
    first_run_at: u64,
    /// 是否已被密码永久解锁
    unlocked: bool,
    /// 最近一次校验看到的时间（用于探测系统时间被回拨以续期）
    last_seen_at: u64,
}

/// 返回给前端的授权状态
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LicenseStatus {
    /// ok = 可正常使用；locked = 已锁定需输入密码
    status: &'static str,
    first_run_at: u64,
    unlocked: bool,
    /// 剩余试用毫秒数（已锁定 / 被判定篡改时间为 0）
    remaining_ms: u64,
}

fn license_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法获取应用数据目录：{e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建应用数据目录：{e}"))?;
    Ok(dir.join(LICENSE_FILE_NAME))
}

/// 读取授权文件；不存在则视为首次运行并写入初始记录（试用从此开始计时）。
fn load_license(app: &tauri::AppHandle) -> Result<LicenseFile, String> {
    let path = license_path(app)?;
    if !path.exists() {
        let now = now_ms();
        let init = LicenseFile {
            first_run_at: now,
            unlocked: false,
            last_seen_at: now,
        };
        save_license(app, &init)?;
        return Ok(init);
    }
    let raw =
        fs::read_to_string(&path).map_err(|e| format!("读取授权文件失败：{e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("授权文件解析失败：{e}"))
}

fn save_license(app: &tauri::AppHandle, license: &LicenseFile) -> Result<(), String> {
    let path = license_path(app)?;
    let json =
        serde_json::to_string(license).map_err(|e| format!("授权数据序列化失败：{e}"))?;
    fs::write(&path, json).map_err(|e| format!("写入授权文件失败：{e}"))
}

/// 校验授权状态（前端启动时调用；不存在授权文件会自动创建，即首次运行）
#[tauri::command]
fn check_license(app: tauri::AppHandle) -> LicenseStatus {
    let now = now_ms();
    // 读取 / 写入失败时放行（返回未锁定），避免授权文件异常把用户锁死
    let state = match load_license(&app) {
        Ok(s) => s,
        Err(_) => {
            return LicenseStatus {
                status: "ok",
                first_run_at: now,
                unlocked: true,
                remaining_ms: TRIAL_MS,
            }
        }
    };

    // 系统时间被明显回拨（想靠改时间续期）→ 一律按“已到期”处理，只能输密码解锁
    let rolled_back = now + CLOCK_GRACE_MS < state.first_run_at
        || now + CLOCK_GRACE_MS < state.last_seen_at;

    let elapsed = now.saturating_sub(state.first_run_at);
    let locked = !state.unlocked && (rolled_back || elapsed >= TRIAL_MS);

    // 记录本次看到的时间，供下次探测回拨
    let _ = save_license(
        &app,
        &LicenseFile {
            first_run_at: state.first_run_at,
            unlocked: state.unlocked,
            last_seen_at: state.last_seen_at.max(now),
        },
    );

    LicenseStatus {
        status: if locked { "locked" } else { "ok" },
        first_run_at: state.first_run_at,
        unlocked: state.unlocked,
        remaining_ms: if rolled_back {
            0
        } else {
            TRIAL_MS.saturating_sub(elapsed)
        },
    }
}

/// 输入密码解锁：密码正确则永久解锁（写盘），返回是否成功
#[tauri::command]
fn unlock_license(app: tauri::AppHandle, password: String) -> bool {
    if password != UNLOCK_PASSWORD {
        return false;
    }
    let now = now_ms();
    let base = load_license(&app).unwrap_or(LicenseFile {
        first_run_at: now,
        unlocked: false,
        last_seen_at: now,
    });
    save_license(
        &app,
        &LicenseFile {
            first_run_at: base.first_run_at,
            unlocked: true,
            last_seen_at: now,
        },
    )
    .is_ok()
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[derive(Deserialize)]
struct ExportFile {
    name: String,
    /// base64 编码的图片数据
    data: String,
}

#[derive(Serialize)]
struct ExportOutcome {
    saved: usize,
    cancelled: bool,
    failed: Vec<String>,
}

fn write_export_file(path: &std::path::Path, data: &str) -> Result<(), String> {
    let bytes = STANDARD
        .decode(data)
        .map_err(|e| format!("数据解码失败：{e}"))?;
    fs::write(path, bytes).map_err(|e| format!("写入失败：{e}"))
}

/// 导出图片：单张弹「另存为」对话框，多张弹「选择文件夹」后全部写入。
#[tauri::command]
fn save_files(files: Vec<ExportFile>) -> ExportOutcome {
    let mut outcome = ExportOutcome {
        saved: 0,
        cancelled: false,
        failed: Vec::new(),
    };

    if files.is_empty() {
        return outcome;
    }

    if files.len() == 1 {
        let f = &files[0];
        let Some(path) = rfd::FileDialog::new().set_file_name(&f.name).save_file() else {
            outcome.cancelled = true;
            return outcome;
        };
        match write_export_file(&path, &f.data) {
            Ok(_) => outcome.saved = 1,
            Err(e) => outcome.failed.push(format!("{}（{}）", f.name, e)),
        }
    } else {
        let Some(dir) = rfd::FileDialog::new().pick_folder() else {
            outcome.cancelled = true;
            return outcome;
        };
        for f in &files {
            let path = dir.join(&f.name);
            match write_export_file(&path, &f.data) {
                Ok(_) => outcome.saved += 1,
                Err(e) => outcome.failed.push(format!("{}（{}）", f.name, e)),
            }
        }
    }

    outcome
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            save_files,
            check_license,
            unlock_license
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
