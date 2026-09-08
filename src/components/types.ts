export interface PhotoItem {
  id: string;
  name: string;
  /** 全尺寸图片（预览/导出用） */
  url: string;
  size: number;
  /** 列表缩略图（小图，避免右栏大量解码全尺寸原图导致卡顿）；未生成时列表展示占位 */
  thumbUrl?: string;
}

/** 处理结果条目的 id 前缀：处理结果与主原图通过该前缀一一对应 */
export const RESULT_PREFIX = "processed-";

/** 传入任意 id（原图或处理结果），一律返回其主原图 id */
export const toMainId = (id: string) =>
  id.startsWith(RESULT_PREFIX) ? id.slice(RESULT_PREFIX.length) : id;

/** 由主原图 id 生成对应处理结果条目的 id */
export const toResultId = (mainId: string) => `${RESULT_PREFIX}${mainId}`;

/** 水印预设类型：文字水印 / 图片水印 */
export type WatermarkPresetType = "text" | "image";

/** 时间地点 LOGO 的可编辑字段值 */
export interface DatetimeLogoValues {
  time: string;
  date: string;
  week: string;
  location: string;
  /** 时间模式：fixed 固定时间 / range 时间区间随机（每张图片不同） */
  timeMode?: "fixed" | "range";
  /** 时间区间模式下的开始时间（HH:mm） */
  timeStart?: string;
  /** 时间区间模式下的结束时间（HH:mm） */
  timeEnd?: string;
  /** 日期模式：fixed 固定日期 / sequence 从起始日期起按图片顺序逐日递增（第 1 张 = 起始日期，星期自动对应） */
  dateMode?: "fixed" | "sequence";
  /** 顺序递增模式下的起始日期（YYYY-MM-DD） */
  dateStart?: string;
}

/**
 * 地理信息水印（日期 / 时间 / 经度 / 纬度 / 地点 / 备注）的可编辑字段值。
 * 时间与日期支持与「时间地点 LOGO」相同的批量模式：
 * - 时间：fixed 固定 / range 区间随机（每张图片按图片 ID 确定性随机一个时刻）
 * - 日期：fixed 固定 / sequence 从起始日期起按图片顺序逐日递增
 */
export interface GeoInfoLogoValues {
  /** 时间模式：fixed 固定时间 / range 区间随机（每张图片不同） */
  timeMode?: "fixed" | "range";
  /** 固定时间（HH:mm，如 10:16） */
  time?: string;
  /** 区间模式下的开始时间（HH:mm） */
  timeStart?: string;
  /** 区间模式下的结束时间（HH:mm） */
  timeEnd?: string;
  /** 日期模式：fixed 固定日期 / sequence 从起始日期起按图片顺序逐日递增 */
  dateMode?: "fixed" | "sequence";
  /** 固定日期（YYYY-MM-DD） */
  date?: string;
  /** 顺序递增模式下的起始日期（YYYY-MM-DD） */
  dateStart?: string;
  longitude: string;
  latitude: string;
  location: string;
  /** 备注（可选；留空时水印不显示该行） */
  remark?: string;
}

/** 本机水印预设（存储在 localStorage） */
export interface WatermarkPreset {
  id: string;
  name: string;
  type: WatermarkPresetType;
  /** 预设具体配置（文字内容、样式、图片等），后续水印功能使用 */
  config: Record<string, unknown>;
  createdAt: number;
  /** 是否为内置预设（内置预设不允许删除和修改） */
  builtin?: boolean;
}

/** 水印相对图片的位置（百分比，预览中可拖拽调整，用于合成导出） */
export interface WatermarkPosition {
  x: number;
  y: number;
}

/** 水印布局对应的图片方向：横屏 / 竖屏（两套位置可分别调整，当前默认相同） */
export type WatermarkOrientation = "landscape" | "portrait";

/** 单个预设按方向分别记录的位置（某方向未拖动记录时回退默认位置） */
export type WatermarkPositionsByOrientation = Partial<
  Record<WatermarkOrientation, WatermarkPosition>
>;

/** 各预设的方向化位置表（按预设 ID） */
export type WatermarkPositionsMap = Record<string, WatermarkPositionsByOrientation>;

/** 单个预设按方向分别记录的大小倍率（百分比；某方向未调整记录时回退该方向默认大小） */
export type WatermarkScalesByOrientation = Partial<
  Record<WatermarkOrientation, number>
>;

/** 各预设的方向化大小倍率表（按预设 ID） */
export type WatermarkScalesMap = Record<string, WatermarkScalesByOrientation>;

/**
 * 水印方案（可用于全局默认方案，也可用于单张图片的独立覆盖）。
 * - presetIds 为空 = 该方案不叠加任何水印；
 * - positions / scales 各预设的可选位置大小，未单独记录的预设回落默认
 *   （导出与预览都走 resolveWatermarkPosition / resolveWatermarkScale）；
 * - overrides（时间/日期/地点内容）按预设 ID 全局共享，不属于图片覆盖。
 */
export interface WatermarkPlan {
  /** 选用的预设 ID 列表（多选叠加；为空 = 不加水印） */
  presetIds: string[];
  /** 各预设按方向记录的位置（未记录回落默认） */
  positions?: WatermarkPositionsMap;
  /** 各预设按方向记录的大小（未记录回落默认） */
  scales?: WatermarkScalesMap;
}

/** 单图覆盖表：主图 id → 该图独立的水印方案；不在此表中的图片跟随全局默认方案 */
export type ImageWatermarkPlansMap = Record<string, WatermarkPlan>;
