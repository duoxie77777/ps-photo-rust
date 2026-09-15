import type {
  DatetimeLogoValues,
  GeoInfoLogoValues,
  WatermarkOrientation,
  WatermarkPosition,
  WatermarkPositionsMap,
  WatermarkPreset,
  WatermarkScalesMap,
} from "./types";
import logo1Url from "../assets/logo1.png";
import logo2Url from "../assets/logo2.svg";

/** 用户自定义水印预设的 localStorage 存储键 */
export const WATERMARK_PRESETS_KEY = "ps-photo:watermark-presets";

/**
 * 各预设的默认位置（未拖拽记录时使用），横屏 / 竖屏各一套独立取值。
 * 竖屏默认按竖屏基准图（约 1288×1699 px）反算：
 * - 时间地点 LOGO 中心点落于 644 × 1453 px → X 50% · Y 85.5%
 * - LOGO 水印（水印相机）中心点落于 1038 × 1657 px → X 80.59% · Y 97.53%
 */
export const DEFAULT_WATERMARK_POSITIONS: Record<
  WatermarkOrientation,
  Record<string, WatermarkPosition>
> = {
  landscape: {
    // 时间地点 LOGO：X 50% · Y 81%（中心点；按 1629×1979 基准图为 815 × 1603 px）
    "builtin-datetime-logo": { x: 50, y: 81 },
    // 地理信息水印：左下角，X 15% · Y 77%（中心点）
    "builtin-geo-info-logo": { x: 15, y: 77 },
    // 内置 LOGO 水印默认在右下角：X 80.59% · Y 95.84%（较 81% · 96% 左移 7px、上移 2px；
    // 按编辑原图约 1699×1277 px 反算：1% ≈ 16.99 × 12.77 px，中心点落于 1369 × 1224 px）
    "builtin-logo1": { x: 80.59, y: 95.84 },
    // 现场拍照 LOGO（logo2）：X 33% · Y 51%（中心点 235 × 270 px）
    "builtin-logo2": { x: 33, y: 51 },
  },
  portrait: {
    // 时间地点 LOGO：X 50% · Y 85.5%（中心点 644 × 1453 px，按约 1288×1699 竖屏基准图反算；比 86% 共上移约 8px）
    "builtin-datetime-logo": { x: 50, y: 85.5 },
    // 地理信息水印：竖屏固定默认 X 20% · Y 82%（中心点 478 × 2674 px）
    "builtin-geo-info-logo": { x: 20, y: 82 },
    // LOGO 水印（水印相机）：右下角，X 80.59% · Y 97.53%（中心点 1038 × 1657 px，按 1288×1699 竖屏基准图反算；较 98% 上移约 8px、较 81% 左移约 5px）
    "builtin-logo1": { x: 80.59, y: 97.53 },
    // 现场拍照 LOGO（logo2）：竖屏默认 X 27% · Y 50%（中心点 661 × 1640 px）
    "builtin-logo2": { x: 27, y: 50 },
  },
};

/**
 * 各预设的默认大小倍率（百分比），横屏 / 竖屏各一套独立取值。
 * 未单独列出的预设（如时间地点 LOGO）横屏默认回退 215%；竖屏时间地点 LOGO 默认 290%。
 */
export const DEFAULT_WATERMARK_SCALES: Record<
  WatermarkOrientation,
  Record<string, number>
> = {
  landscape: {
    "builtin-logo1": 35,
    // 地理信息水印默认 180%，左下角信息卡片与图片比例协调
    "builtin-geo-info-logo": 180,
    // 现场拍照 LOGO（logo2）默认 37%
    "builtin-logo2": 37,
  },
  portrait: {
    // 时间地点 LOGO：竖屏默认 290%
    "builtin-datetime-logo": 290,
    "builtin-logo1": 35,
    // 地理信息水印：竖屏固定默认 225%
    "builtin-geo-info-logo": 225,
    // 现场拍照 LOGO（logo2）竖屏默认 50%
    "builtin-logo2": 50,
  },
};

/** 读取预设的默认位置（按预设 ID + 方向区分；未知 ID 的地理信息水印统一回退到左下角 X 15% · Y 77%） */
export function defaultWatermarkPosition(
  preset: Pick<WatermarkPreset, "id" | "config">,
  orientation: WatermarkOrientation,
): WatermarkPosition {
  const presetId = preset.id;
  const def = DEFAULT_WATERMARK_POSITIONS[orientation]?.[presetId];
  if (def) return def;
  if (preset.config?.variant === "geo-info") return { x: 15, y: 77 };
  return { x: 50, y: 81 };
}

/**
 * 读取指定方向的最终水印位置：
 * 先查该预设在该方向下拖拽记录的位置，未记录时回退该方向的默认位置。
 * 横屏与竖屏两套各自独立。
 */
export function resolveWatermarkPosition(
  preset: Pick<WatermarkPreset, "id" | "config">,
  orientation: WatermarkOrientation,
  map?: WatermarkPositionsMap,
): WatermarkPosition {
  return (
    map?.[preset.id]?.[orientation] ??
    defaultWatermarkPosition(preset, orientation)
  );
}

/** 读取预设的默认大小倍率（按预设 ID + 方向区分） */
export function defaultWatermarkScale(
  presetId: string,
  orientation: WatermarkOrientation,
): number {
  const perOrientation = DEFAULT_WATERMARK_SCALES[orientation]?.[presetId];
  if (perOrientation != null) return perOrientation;
  const landscape = DEFAULT_WATERMARK_SCALES.landscape[presetId];
  return landscape ?? 215;
}

/**
 * 读取指定方向的最终水印大小倍率：
 * 先查该预设在该方向下的滑块记录值，未记录时回退该方向的默认大小。
 * 横屏与竖屏两套各自独立。
 */
export function resolveWatermarkScale(
  preset: Pick<WatermarkPreset, "id">,
  orientation: WatermarkOrientation,
  map?: WatermarkScalesMap,
): number {
  const recorded = map?.[preset.id]?.[orientation];
  return recorded ?? defaultWatermarkScale(preset.id, orientation);
}

/**
 * 读取 LOGO 右侧文字（caption，如「水印相机」）的字间距（基准像素，随水印缩放）。
 * 支持按横/竖屏分别配置，优先级从高到低：
 *   1. config.captionLetterSpacingByOrientation[orientation]（只影响该方向）
 *   2. config.captionLetterSpacing（两个方向共用）
 *   3. fallback（默认 1）
 * 预览 DOM 与成品 canvas 都走这里，保证所见即所得。
 */
export function resolveCaptionLetterSpacing(
  preset: Pick<WatermarkPreset, "config">,
  orientation: WatermarkOrientation,
  fallback = 1,
): number {
  const byOrientation = preset.config?.captionLetterSpacingByOrientation as
    | Partial<Record<WatermarkOrientation, number>>
    | undefined;
  const oriented = byOrientation?.[orientation];
  if (typeof oriented === "number") return oriented;
  const base = preset.config?.captionLetterSpacing;
  return typeof base === "number" ? base : fallback;
}

/** 时间地点 LOGO 编辑值覆盖（按预设 ID 存储）的 localStorage 存储键 */
export const WATERMARK_DATETIME_OVERRIDES_KEY = "ps-photo:datetime-overrides";

/** 地理信息水印编辑值覆盖（按预设 ID 存储）的 localStorage 存储键 */
export const WATERMARK_GEO_INFO_OVERRIDES_KEY = "ps-photo:geo-info-overrides";

/** 覆盖数据格式版本（v2：date/week/time 不再固化，默认跟随今天/当前时间） */
const DATETIME_OVERRIDES_VERSION_KEY = "ps-photo:datetime-overrides-v2";

/** 读取时间地点 LOGO 的编辑值覆盖（按预设 ID） */
export function loadDatetimeOverrides(): Record<string, DatetimeLogoValues> {
  try {
    const raw = localStorage.getItem(WATERMARK_DATETIME_OVERRIDES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    // v2 迁移：日期/星期/时间默认跟随今天/当前时间，
    // 清除旧版固化的 date/week/time（保留 location / timeMode / timeStart / timeEnd 等自定义项）
    if (localStorage.getItem(DATETIME_OVERRIDES_VERSION_KEY) !== "2") {
      const migrated: Record<string, DatetimeLogoValues> = {};
      for (const [id, v] of Object.entries(
        parsed as Record<string, DatetimeLogoValues>,
      )) {
        const entry: Record<string, unknown> = { ...v };
        delete entry.time;
        delete entry.date;
        delete entry.week;
        if (Object.keys(entry).length > 0)
          migrated[id] = entry as unknown as DatetimeLogoValues;
      }
      try {
        localStorage.setItem(DATETIME_OVERRIDES_VERSION_KEY, "2");
        saveDatetimeOverrides(migrated);
      } catch {
        // 迁移存储失败时静默忽略
      }
      return migrated;
    }
    return parsed as Record<string, DatetimeLogoValues>;
  } catch {
    return {};
  }
}

/** 保存时间地点 LOGO 的编辑值覆盖（按预设 ID） */
export function saveDatetimeOverrides(
  overrides: Record<string, DatetimeLogoValues>,
): void {
  try {
    localStorage.setItem(
      WATERMARK_DATETIME_OVERRIDES_KEY,
      JSON.stringify(overrides),
    );
  } catch {
    // 存储失败时静默忽略
  }
}

/** 读取地理信息水印的编辑值覆盖（按预设 ID） */
export function loadGeoInfoOverrides(): Record<string, GeoInfoLogoValues> {
  try {
    const raw = localStorage.getItem(WATERMARK_GEO_INFO_OVERRIDES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, GeoInfoLogoValues>)
      : {};
  } catch {
    return {};
  }
}

/** 保存地理信息水印的编辑值覆盖（按预设 ID） */
export function saveGeoInfoOverrides(
  overrides: Record<string, GeoInfoLogoValues>,
): void {
  try {
    localStorage.setItem(
      WATERMARK_GEO_INFO_OVERRIDES_KEY,
      JSON.stringify(overrides),
    );
  } catch {
    // 存储失败时静默忽略
  }
}

/**
 * 内置水印预设（不允许删除和修改）
 * 通过 div 元素叠加实现水印效果
 */
export const BUILTIN_WATERMARK_PRESETS: WatermarkPreset[] = [
  {
    id: "builtin-datetime-logo",
    name: "时间地点 LOGO",
    type: "text",
    builtin: true,
    createdAt: 0,
    config: {
      variant: "datetime",
      location: "厦门市·厦门华澄制药有限公司",
    },
  },
  {
    id: "builtin-logo1",
    name: "LOGO 水印",
    type: "image",
    builtin: true,
    createdAt: 0,
    config: {
      src: logo1Url,
      width: 120,
      opacity: 0.8,
      /** LOGO 右侧的文字说明 */
      caption: "水印相机",
      // 基准字号：默认 35% 倍率下预览视觉 ≈ 20px，与导出同比例放大（所见即所得）
      captionFontSize: 77,
      /**
       * 「水印相机」四个字的字间距（基准像素，随水印缩放；实际字距 = 该值 × 缩放比例）。
       * 横屏 / 竖屏各配一套，互不影响：改 landscape 只动横屏，改 portrait 只动竖屏。
       * 只写一侧时，另一侧回退 captionLetterSpacing（未设 → 1）。
       */
      captionLetterSpacingByOrientation: { landscape: 10, portrait: 10 },
      /** LOGO 与右侧文字的间距（按预设分开控制，不设则用全局 LOGO_CAPTION_GAP） */
      captionGap: 12,
      /** 文字垂直偏移（按预设分开控制，不设则用全局 LOGO_CAPTION_DY） */
      captionDy: 0,
      /** 图片自身偏移（按预设分开控制，不设则用全局 LOGO_IMG_DX） */
      imgDx: -10,
      /** 图片自身偏移（按预设分开控制，不设则用全局 LOGO_IMG_DY） */
      imgDy: -10,
    },
  },
  {
    id: "builtin-geo-info-logo",
    name: "地理信息水印",
    type: "text",
    builtin: true,
    createdAt: 0,
    config: {
      variant: "geo-info",
      location: "厦门市·万寿路",
      /** 地理信息水印整体透明度（0~1，1 全不透明，改小变淡；预览与导出同步） */
      opacity: 0.9,
    },
  },
  {
    id: "builtin-logo2",
    name: "现场拍照 LOGO",
    type: "image",
    builtin: true,
    createdAt: 0,
    config: {
      src: logo2Url,
      width: 140,
      /** 文字「现场拍照」透明度（与图片透明度分开控制） */
      opacity: 0.55,
      /** 图片 logo2 专属透明度（预览与导出同步） */
      logoOpacity: 0.5,
      /** 现场拍照 LOGO 模糊度（预览与导出同一取值） */
      blur: 1,
      /** LOGO 右侧的文字说明 */
      caption: "现场拍照",
      /** 现场拍照字体的基准字号（越大字越大，预览与导出同步缩放） */
      captionFontSize: 145,
      /** 现场拍照字体加粗（预览与导出同步） */
      captionFontWeight: 600,
      /** 现场拍照字符间距（基准像素，随水印缩放；预览与导出同步） */
      captionLetterSpacing: 20,
      /** LOGO 与右侧文字的间距（按预设分开控制，不设则用全局 LOGO_CAPTION_GAP） */
      captionGap: 54,
      /** 现场拍照字体描边粗细（0 = 无描边，基准像素随水印缩放；预览与导出同步） */
      captionStrokeWidth: 3,
      /** 现场拍照字体描边颜色 */
      captionStrokeColor: "#000000a1",
      /** 文字垂直偏移（按预设分开控制，不设则用全局 LOGO_CAPTION_DY） */
      captionDy: 10,
      /** 图片自身偏移（按预设分开控制，不设则用全局 LOGO_IMG_DX） */
      imgDx: -10,
      /** 图片自身偏移（按预设分开控制，不设则用全局 LOGO_IMG_DY） */
      imgDy: -10,
    },
  },
];

/** 从本地存储读取用户自定义水印预设列表 */
function loadUserWatermarkPresets(): WatermarkPreset[] {
  try {
    const raw = localStorage.getItem(WATERMARK_PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as WatermarkPreset[]) : [];
  } catch {
    return [];
  }
}

/** 加载全部水印预设：内置预设始终在前，用户预设按存储顺序在后 */
export function loadWatermarkPresets(): WatermarkPreset[] {
  const builtin = BUILTIN_WATERMARK_PRESETS;
  const user = loadUserWatermarkPresets();
  const builtinIds = new Set(builtin.map((p) => p.id));
  return [...builtin, ...user.filter((p) => !builtinIds.has(p.id))];
}

/** 删除用户自定义水印预设（内置预设不允许删除），返回删除后的完整列表 */
export function deleteWatermarkPreset(id: string): WatermarkPreset[] {
  const user = loadUserWatermarkPresets().filter((p) => p.id !== id);
  saveWatermarkPresets(user);
  return loadWatermarkPresets();
}

/** 将用户自定义水印预设列表保存到本地存储 */
export function saveWatermarkPresets(presets: WatermarkPreset[]): void {
  try {
    localStorage.setItem(WATERMARK_PRESETS_KEY, JSON.stringify(presets));
  } catch {
    // 存储失败（如超出配额）时静默忽略
  }
}
