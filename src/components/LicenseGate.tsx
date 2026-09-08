import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { App as AntdApp, Button, Input, Spin } from "antd";
import { KeyOutlined, LockOutlined } from "@ant-design/icons";
import { invoke } from "@tauri-apps/api/core";

/** 试用锁状态（对应 Rust check_license 的返回值） */
interface LicenseStatus {
  status: "ok" | "locked";
  firstRunAt: number;
  unlocked: boolean;
  remainingMs: number;
}

/** 试用时长：2 天（毫秒），与 Rust 端 TRIAL_MS 保持一致（仅用于非 Tauri 环境兜底） */
const TRIAL_MS = 2 * 24 * 60 * 60 * 1000;
/** 运行期间每 60 秒复查一次，确保长时间不关闭也能准时上锁 */
const RECHECK_INTERVAL_MS = 60 * 1000;

/** 是否运行在 Tauri 环境（打包后的软件 / tauri dev 窗口里） */
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** 校验失败或非 Tauri 环境时的兜底状态：直接放行，避免把用户锁死 */
function makeFallbackLicense(): LicenseStatus {
  return {
    status: "ok",
    firstRunAt: Date.now(),
    unlocked: true,
    remainingMs: TRIAL_MS,
  };
}

/** 锁定界面：试用到期后全屏展示，输入正确密码才可继续使用 */
function LockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const { message } = AntdApp.useApp();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleUnlock = async () => {
    const trimmed = password.trim();
    if (!trimmed) {
      message.warning("请输入解锁密码");
      return;
    }
    setSubmitting(true);
    try {
      const ok = await invoke<boolean>("unlock_license", { password: trimmed });
      if (ok) {
        message.success("解锁成功，欢迎使用");
        onUnlocked();
      } else {
        message.error("解锁密码错误，请重试");
        setPassword("");
      }
    } catch {
      message.error("解锁失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="license-lock">
      <div className="license-card">
        <div className="license-card-icon">
          <LockOutlined />
        </div>
        <div className="license-card-title">软件已锁定</div>
        <div className="license-card-desc">
          本软件为限时试用，试用期（2 天）已结束。
          <br />
          请输入授权解锁密码以继续使用。
        </div>
        <Input.Password
          className="license-input"
          placeholder="请输入解锁密码"
          prefix={<KeyOutlined />}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onPressEnter={() => void handleUnlock()}
          autoFocus
          autoComplete="off"
        />
        <Button
          type="primary"
          block
          loading={submitting}
          onClick={() => void handleUnlock()}
        >
          解锁
        </Button>
        <div className="license-card-foot">如遗忘密码，请联系软件提供方</div>
      </div>
    </div>
  );
}

/**
 * 授权门：包在应用最外层。
 * - 启动时校验试用状态：首次运行自动开始计时；到期则显示锁定界面。
 * - 解锁成功后正常渲染业务内容；运行期间定时复查，防止跨过期限仍继续使用。
 */
export default function LicenseGate({ children }: { children: ReactNode }) {
  const [license, setLicense] = useState<LicenseStatus | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;

    const check = async () => {
      try {
        if (!isTauri()) {
          // 纯浏览器（vite）开发预览：不启用试用锁
          if (alive) setLicense(makeFallbackLicense());
          return;
        }
        const result = await invoke<LicenseStatus>("check_license");
        if (alive) setLicense(result);
      } catch {
        // 命令异常时放行，避免授权问题导致软件无法打开
        if (alive) setLicense(makeFallbackLicense());
      }
    };

    void check();
    timer = window.setInterval(() => void check(), RECHECK_INTERVAL_MS);
    return () => {
      alive = false;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, []);

  if (!license) {
    return (
      <div className="license-loading">
        <Spin size="large" />
        <div className="license-loading-text">正在校验授权状态…</div>
      </div>
    );
  }

  if (license.status === "locked") {
    return (
      <LockScreen
        onUnlocked={() =>
          setLicense((prev) =>
            prev ? { ...prev, status: "ok", unlocked: true } : prev,
          )
        }
      />
    );
  }

  return <>{children}</>;
}
