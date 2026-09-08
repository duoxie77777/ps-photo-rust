import { invoke } from "@tauri-apps/api/core";

export interface ExportableImage {
  id: string;
  name: string;
  url: string;
}

export interface ExportOutcome {
  saved: number;
  cancelled: boolean;
  failed: string[];
}

/** 是否运行在 Tauri 环境（打包后的软件里） */
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** 浏览器模式：a[download] 触发下载 */
function downloadViaAnchor(item: ExportableImage, prefix?: number) {
  const a = document.createElement("a");
  a.href = item.url;
  a.download = prefix !== undefined ? `${prefix + 1}_${item.name}` : item.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** 把 objectURL 对应的二进制读成 base64（供 Rust 端写文件） */
async function blobToBase64(url: string): Promise<string> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("读取图片数据失败");
  const blob = await resp.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      // 去掉 "data:image/png;base64," 前缀
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("读取图片数据失败"));
    reader.readAsDataURL(blob);
  });
}

/** Tauri 模式：走原生保存对话框（Rust save_files 命令） */
async function exportViaTauri(files: { name: string; url: string }[]): Promise<ExportOutcome> {
  const list = await Promise.all(
    files.map(async (f) => ({ name: f.name, data: await blobToBase64(f.url) }))
  );
  return await invoke<ExportOutcome>("save_files", { files: list });
}

/** 单张导出 */
export async function exportSingle(item: ExportableImage): Promise<"ok" | "cancelled" | "error"> {
  try {
    if (isTauri()) {
      const r = await exportViaTauri([item]);
      if (r.cancelled) return "cancelled";
      return r.saved === 1 ? "ok" : "error";
    }
    downloadViaAnchor(item);
    return "ok";
  } catch {
    return "error";
  }
}

/** 批量导出 */
export async function exportAll(items: ExportableImage[]): Promise<ExportOutcome> {
  if (isTauri()) {
    return await exportViaTauri(items);
  }
  // 浏览器模式：逐张触发下载，间隔防浏览器拦截
  for (let i = 0; i < items.length; i++) {
    downloadViaAnchor(items[i], items.length > 1 ? i : undefined);
    if (i < items.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  return { saved: items.length, cancelled: false, failed: [] };
}
