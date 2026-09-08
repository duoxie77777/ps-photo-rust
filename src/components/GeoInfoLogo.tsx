import { useState } from "react";
import { dateFromStart, randomTimeInRange } from "./DatetimeLogo";
import type { GeoInfoLogoValues } from "./types";

interface GeoInfoLogoProps {
  size?: "small" | "large";
  /** 「时间」行最终显示文本（含日期与时刻，已按图片解析好，缺省取当前日期时间） */
  time?: string;
  longitude?: string;
  latitude?: string;
  location?: string;
  /** 备注（留空则不显示该行） */
  remark?: string;
  /** 整体透明度（0~1，1 全不透明） */
  opacity?: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 纯 HH:mm 时刻 */
const HM_RE = /^\s*(\d{1,2}):(\d{1,2})\s*$/;

/** 旧版兼容：含日期与时刻的整串，如「2026.08.31 10:16」「2026-08-31 10:16」 */
const FULL_RE =
  /^\s*(\d{4})\s*[.年/-]\s*(\d{1,2})\s*[.月/-]\s*(\d{1,2})\s*[日号]?\s+(\d{1,2}):(\d{1,2})\s*$/;

/**
 * 旧数据迁移：从「日期 时刻」整串（如 2026.08.31 10:16）拆出 { date, time }；
 * 无法解析返回 null。
 */
export function parseGeoInfoCombinedTime(
  raw?: string,
): { date: string; time: string } | null {
  if (!raw) return null;
  const m = FULL_RE.exec(raw);
  if (!m) return null;
  const num = (s: string | undefined) => pad2(Number(s ?? 0));
  return {
    date: `${m[1]}-${num(m[2])}-${num(m[3])}`,
    time: `${num(m[4])}:${num(m[5])}`,
  };
}

/** 当前时刻（YYYY-MM-DD / HH:mm） */
function nowParts(): { date: string; time: string } {
  const n = new Date();
  return {
    date: `${n.getFullYear()}-${pad2(n.getMonth() + 1)}-${pad2(n.getDate())}`,
    time: `${pad2(n.getHours())}:${pad2(n.getMinutes())}`,
  };
}

/** YYYY-MM-DD → YYYY.MM.DD（地理信息水印时间行的显示格式） */
function toDot(date: string): string {
  return date.replace(/-/g, ".");
}

/**
 * 解析地理信息水印「时间」行最终显示文本（如「2026.08.31 10:16」）：
 * - 日期：fixed 用 date；sequence 用 dateStart + index（第 1 张 = 起始日期）；
 *   均缺失时回退到旧版整串里的日期或当前日期。
 * - 时刻：range 用 seed 在区间内确定性随机；fixed 用 time（HH:mm）；
 *   均缺失时回退到旧版整串里的时刻或当前时刻。
 */
export function resolveGeoInfoTimeText(
  values: Partial<GeoInfoLogoValues>,
  index = 0,
  seed = "watermark",
): string {
  const legacy = parseGeoInfoCombinedTime(values.time);
  const now = nowParts();

  // 日期
  let date: string;
  if (values.dateMode === "sequence" && values.dateStart) {
    date = dateFromStart(values.dateStart, Math.max(0, index));
  } else if (values.date) {
    date = values.date;
  } else if (legacy?.date) {
    date = legacy.date;
  } else {
    date = now.date;
  }

  // 时刻
  let time: string;
  if (values.timeMode === "range" && values.timeStart && values.timeEnd) {
    time = randomTimeInRange(seed, values.timeStart, values.timeEnd);
  } else if (values.time && HM_RE.test(values.time)) {
    time = values.time.trim();
  } else if (legacy?.time) {
    time = legacy.time;
  } else {
    time = now.time;
  }

  return `${toDot(date)}  ${time}`; // 日期与时刻之间留两个空格（视觉间隔更大）
}

/** 校验地理信息水印编辑值（日期/时间固定或区间模式下分别校验） */
export function validateGeoInfoValues(
  values: GeoInfoLogoValues,
): Partial<Record<keyof GeoInfoLogoValues, string>> {
  const errors: Partial<Record<keyof GeoInfoLogoValues, string>> = {};
  const timeRe = /^\d{1,2}:\d{1,2}$/;
  if (values.timeMode === "range") {
    if (!values.timeStart || !timeRe.test(values.timeStart.trim())) {
      errors.time = "区间开始时间格式：HH:mm，如 06:00";
    }
    if (!values.timeEnd || !timeRe.test(values.timeEnd.trim())) {
      errors.time = errors.time || "区间结束时间格式：HH:mm，如 06:10";
    }
    if (!errors.time) {
      const toMin = (t: string) => {
        const [h, m] = t.split(":").map(Number);
        return h * 60 + m;
      };
      if (toMin(values.timeStart!) >= toMin(values.timeEnd!)) {
        errors.time = "结束时间必须晚于开始时间";
      }
    }
  } else if (!values.time || !timeRe.test(values.time.trim())) {
    errors.time = "时间格式：HH:mm，如 10:16";
  }
  const dateRe = /^\d{4}-\d{1,2}-\d{1,2}$/;
  if (values.dateMode === "sequence") {
    if (!values.dateStart || !dateRe.test(values.dateStart.trim())) {
      errors.date = "起始日期格式：YYYY-MM-DD，如 2026-05-01";
    }
  } else if (!values.date || !dateRe.test(values.date.trim())) {
    errors.date = "日期格式：YYYY-MM-DD，如 2026-08-31";
  }
  if (!values.longitude.trim()) errors.longitude = "请输入经度";
  if (!values.latitude.trim()) errors.latitude = "请输入纬度";
  if (!values.location.trim()) errors.location = "请输入地点";
  return errors;
}

/** 连续 2+ 个半角空格 → 不换行空格（NBSP），确保任何 CSS 规则下都不会被折叠 */
function keepSpaces(s: string): string {
  return s.replace(/ {2,}/g, (m) => "\u00A0".repeat(m.length));
}

/** 解析定位字符串「经度, 纬度」并分别返回；解析失败返回 null */
export function parseLonLat(raw: string): { longitude: string; latitude: string } | null {
  const m = /\s*(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)\s*/.exec(raw);
  if (!m) return null;
  return { longitude: m[1], latitude: m[2] };
}

/** 地理信息水印：左下角信息卡片（日期时间 / 经度 / 纬度 / 地点 / 备注） */
function GeoInfoLogo({
  size = "large",
  time,
  longitude,
  latitude,
  location,
  remark,
  opacity = 1,
}: GeoInfoLogoProps) {
  const [now] = useState(() => new Date());
  const timeValue =
    time ??
    `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  // 主体固定四行（时间/经度/纬度/地点）。备注刻意不进 rows：
  // 卡片尺寸由这四行决定，定位锚点 = 四行块的中心，加不加备注上面四行都不位移。
  const rows = [
    { label: "时间", value: timeValue },
    { label: "经度", value: longitude ? `${longitude}°E` : "118.1598°E" },
    { label: "纬度", value: latitude ? `${latitude}°N` : "24.5270°N" },
    { label: "地点", value: location ?? "厦门市·万寿路" },
  ];
  const remarkText = (remark ?? "").trim();

  return (
    <div
      className={`geo-info-logo ${size === "small" ? "geo-info-logo-small" : ""}`}
      style={opacity !== 1 ? { opacity } : undefined}
    >
      {rows.map((row) => (
        <div key={row.label} className="geo-info-row">
          <span className="geo-info-label">{row.label}</span>
          <span className="geo-info-value">{keepSpaces(row.value)}</span>
        </div>
      ))}
      {/* 备注行：绝对定位挂在四行下方，不撑高卡片、不影响锚点位置 */}
      {remarkText && (
        <div className="geo-info-row geo-info-remark">
          <span className="geo-info-label">备注</span>
          <span className="geo-info-value">{keepSpaces(remarkText)}</span>
        </div>
      )}
    </div>
  );
}

export default GeoInfoLogo;
