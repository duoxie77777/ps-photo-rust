import {
  resolveDatetimeDate,
  resolveDatetimeTime,
  resolveDatetimeWeek,
} from "./DatetimeLogo";
import { resolveGeoInfoTimeText } from "./GeoInfoLogo";
import { digitCharsOf, loadNumberGlyph } from "./numberGlyphs";
import dingwei3Url from "../assets/dingwei3.png";
import { resolveCaptionLetterSpacing } from "./watermarkStore";
import type {
  DatetimeLogoValues,
  GeoInfoLogoValues,
  PhotoItem,
  WatermarkOrientation,
  WatermarkPreset,
} from "./types";

/** 合成结果：带水印新图的 objectURL（由调用方负责 revoke） */
export interface ComposeResult {
  url: string;
  blob: Blob;
  width: number;
  height: number;
}

/**
 * 水印基准尺寸的参考宽度（px）。
 * 预设里的 fontSize / width 等按「800px 宽图片」设计，
 * 合成与预览都按 图片宽度 / 此值 等比缩放，保证水印相对图片的比例一致。
 */
export const WATERMARK_REF_WIDTH = 800;

/**
 * ===== LOGO 图片与右侧文字的相对位置微调入口 =====
 * 预览（DOM）与成品（canvas）读取同一组常量，改这里两边同步生效，永远不会对不上。
 * 单位：基准像素（按 800px 参考宽度设计），实际偏移 = 常量 × 图片缩放比例。
 */
export const LOGO_CAPTION_GAP = 48;
export const LOGO_CAPTION_DY = 10;
export const LOGO_IMG_DX = -10;
export const LOGO_IMG_DY = -10;

/**
 * 水印整体的一丢丢微弱模糊（柔化边缘），按水印类型独立配置：
 * - 图片 LOGO 水印：WATERMARK_BLUR_PX_LOGO
 * - 文字 / 日期 LOGO 水印：WATERMARK_BLUR_PX_TEXT
 * 与预览 .watermark-content 的 CSS `filter: blur(var(--wm-blur))` 对应；
 * 单位：基准像素（按 800px 参考宽度设计），实际模糊 = 常量 × factor，与字体等比缩放。
 */
export const WATERMARK_BLUR_PX_LOGO = 0.8;
export const WATERMARK_BLUR_PX_TEXT = 0.05;

export interface ComposeOptions {
  /** 水印块中心点相对图片的百分比（0-100），与预览拖拽值一致 */
  position: { x: number; y: number };
  /** 区间随机时间种子（传图片 ID，保证每张图结果与预览一致） */
  seed: string;
  /** 图片序号（0 起）：顺序递增日期模式用，第 1 张 = 起始日期，之后每天 +1 */
  dateIndex?: number;
  /** 水印大小倍率（百分比，100 = 基准大小） */
  scale?: number;
  /** 水印方向（横屏 / 竖屏）：LOGO 右侧文字字间距等按方向取值；不传按横屏 */
  orientation?: WatermarkOrientation;
  /** 时间行大数字（0-9 字形）间距（基准 px，随水印大小缩放；负值 = 往里缩），仅时间地点 LOGO 生效 */
  timeDigitSpacing?: number;
  /** 日期行小数字（0-9 字形）间距（基准 px，随水印大小缩放；负值 = 往里缩），仅时间地点 LOGO 生效 */
  dateDigitSpacing?: number;
  /** JPEG 编码质量（0-1），默认 0.92；导出用 */
  quality?: number;
  /** 输出格式：'auto' 按文件名（png 保留透明，其余 jpeg）；'png' 强制无损 PNG（预览用，避免二次压缩色偏） */
  format?: "auto" | "png";
  /** 最大边长（px）：预览用小尺寸合成，编码更快且足够屏幕清晰；省略 = 原图尺寸 */
  maxDim?: number;
}

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

/** 已解码图片缓存（按 URL）：预览合成/导出对同一张图反复解码是主要耗时，
    这里把解码后的元素缓存起来；FIFO 限量淘汰，避免长期运行内存膨胀。
    注意：删除图片会 revoke objectURL，旧键此后不会再被请求，残留项随淘汰清出。 */
const imgCache = new Map<string, HTMLImageElement>();
const imgCacheOrder: string[] = [];
const IMG_CACHE_MAX = 3;

function loadImage(url: string): Promise<HTMLImageElement> {
  const hit = imgCache.get(url);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      imgCache.set(url, img);
      imgCacheOrder.push(url);
      if (imgCacheOrder.length > IMG_CACHE_MAX) {
        const oldest = imgCacheOrder.shift();
        if (oldest) imgCache.delete(oldest);
      }
      resolve(img);
    };
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = url;
  });
}

/** 地点图标（dingwei3.png）加载缓存：批量导出时只 decode 一次，避免每张图重复加载 */
const locIconCache = new Map<string, Promise<HTMLImageElement>>();
function loadLocIcon(url: string): Promise<HTMLImageElement> {
  let p = locIconCache.get(url);
  if (!p) {
    p = loadImage(url);
    locIconCache.set(url, p);
  }
  return p;
}

/** 解析颜色（#rgb / #rrggbb / rgb() / rgba()）为 [r,g,b,a] */
function parseColor(color: string): [number, number, number, number] {
  let str = color.trim();
  if (str.startsWith("#")) {
    const hex = str.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return [r, g, b, 255];
    }
    if (hex.length >= 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return [r, g, b, 255];
    }
  }
  const m = str.match(/[\d.]+/g);
  if (m && m.length >= 3) {
    const r = Number(m[0]);
    const g = Number(m[1]);
    const b = Number(m[2]);
    const a = m.length >= 4 ? Number(m[3]) : 255;
    return [r, g, b, a * 255];
  }
  // 兜底白色
  return [255, 255, 255, 255];
}

function rgba(
  [r, g, b, a]: [number, number, number, number],
  opacity: number,
): string {
  const alpha = clamp((a / 255) * opacity, 0, 1);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** 文字水印样式读取（与预览一致） */
function getWatermarkStyle(preset: WatermarkPreset) {
  const text =
    typeof preset.config?.text === "string" && preset.config.text.length > 0
      ? preset.config.text
      : preset.name;
  const color =
    typeof preset.config?.color === "string" ? preset.config.color : "#ffffff";
  const fontSize =
    typeof preset.config?.fontSize === "number" ? preset.config.fontSize : 40;
  const opacity =
    typeof preset.config?.opacity === "number" ? preset.config.opacity : 0.35;
  return { text, color, fontSize, opacity };
}

/**
 * 手动绘制带字间距的文本。
 * canvas ctx.letterSpacing 属性兼容性差（Chrome 99+ 才支持，Firefox 不支持），
 * 直接赋值会静默失效导致成品图与预览（CSS letter-spacing）不一致。
 * 这里逐字符绘制、自行累加间距，所有浏览器行为一致。
 */
function fillTextWithSpacing(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  letterSpacing: number,
  align: "left" | "center" | "right" = "left",
  stroke?: { width: number; color: string },
) {
  if (text.length === 0) return;
  const paintChar = (ch: string, px: number, py: number) => {
    // 先描边后填充，与 CSS -webkit-text-stroke 视觉一致
    if (stroke && stroke.width > 0) {
      ctx.lineWidth = stroke.width;
      ctx.lineJoin = "round";
      ctx.miterLimit = 2;
      ctx.strokeStyle = stroke.color;
      ctx.strokeText(ch, px, py);
    }
    ctx.fillText(ch, px, py);
  };
  if (letterSpacing === 0) {
    paintChar(text, x, y);
    return;
  }
  // 逐码点测量（中英文混排、单个 emoji 都正确）
  const chars = Array.from(text);
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const totalW =
    widths.reduce((s, w) => s + w + letterSpacing, 0) - letterSpacing;
  let sx = x;
  if (align === "center") sx = x - totalW / 2;
  else if (align === "right") sx = x - totalW;
  for (let i = 0; i < chars.length; i++) {
    paintChar(chars[i], sx, y);
    sx += widths[i] + letterSpacing;
  }
}

/**
 * 以「字形视觉中心」为基准绘制文本（textBaseline 需为默认 alphabetic）。
 * 不同字体/字号的 em-box 中线（textBaseline: "middle"）并不等于字形视觉中心，
 * 尤其 cursive（如 Comic Sans）与系统字体度量差异大 —— 这就是日期与星期「行高对不上」的根源。
 * 用 actualBoundingBox 计算每个文本的真实中心，保证日期/星期/地点真正水平对齐。
 */
function drawCenteredText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  centerY: number,
  align: "left" | "center" | "right" = "left",
) {
  const m = ctx.measureText(text);
  let ascent = m.actualBoundingBoxAscent || 0;
  let descent = m.actualBoundingBoxDescent || 0;
  if (ascent + descent === 0) {
    // 度量缺失（个别 emoji 字体）：退化为 em-box 中线
    const size = parseFloat(ctx.font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? "10");
    ascent = size * 0.8;
    descent = size * 0.2;
  }
  const dy = (ascent - descent) / 2;
  ctx.textAlign = align;
  ctx.fillText(text, x, centerY + dy);
}

/** 绘制文字水印（单行文本，居中锚点），样式与预览 .watermark-text 完全一致 */
function drawTextWatermark(
  ctx: CanvasRenderingContext2D,
  text: string,
  color: string,
  fontSize: number,
  opacity: number,
  cx: number,
  cy: number,
) {
  // 与预览一致：粗体 + 斜体 + 字间距 4px + 深色投影
  ctx.font = `italic 700 ${fontSize}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = rgba(parseColor(color), opacity);
  // CSS text-shadow: 0 2px 6px → canvas blur ≈ 2 倍（12）
  ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 2;
  fillTextWithSpacing(ctx, text, cx, cy, 4, "center");
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

/** 绘制图片水印（按预设宽度等比缩放，居中锚点；可在右侧附文字说明） */
async function drawImageWatermark(
  ctx: CanvasRenderingContext2D,
  src: string,
  width: number,
  opacity: number,
  cx: number,
  cy: number,
  caption?: {
    text: string;
    fontSize: number;
    gap: number;
    dy: number;
    fontWeight?: string | number;
    letterSpacing?: number;
    strokeWidth?: number;
    strokeColor?: string;
    /** 文字专属透明度（不传则与图片透明度一致） */
    opacity?: number;
  },
  offset?: { dx: number; dy: number },
) {
  const img = await loadImage(src);
  if (img.naturalWidth === 0) return;
  const w = width;
  const h = (img.naturalHeight / img.naturalWidth) * w;
  ctx.globalAlpha = clamp(opacity, 0, 1);
  ctx.drawImage(
    img,
    cx - w / 2 + (offset?.dx ?? 0),
    cy - h / 2 + (offset?.dy ?? 0),
    w,
    h,
  );
  // 图片右侧的文字说明（如「水印相机」），与预览 .watermark-logo-caption 一致
  if (caption?.text) {
    // 文字透明度与图片分开控制（默认沿用图片透明度）
    ctx.globalAlpha = clamp(caption.opacity ?? opacity, 0, 1);
    const fs = caption.fontSize;
    ctx.font = `${caption.fontWeight ?? "normal"} ${fs}px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
    ctx.shadowBlur = 2;
    ctx.shadowOffsetY = 1;
    ctx.fillStyle = "#fff";
    // 字间距与预览一致（默认 1px，可按预设覆盖），手动逐字符绘制保证所有浏览器一致
    fillTextWithSpacing(
      ctx,
      caption.text,
      cx + w / 2 + caption.gap,
      cy + caption.dy,
      caption.letterSpacing ?? 1,
      "left",
      caption.strokeWidth && caption.strokeWidth > 0
        ? { width: caption.strokeWidth, color: caption.strokeColor ?? "#000" }
        : undefined,
    );
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }
  ctx.globalAlpha = 1;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const WEEK_CN = ["日", "一", "二", "三", "四", "五", "六"];

function todayParts() {
  const n = new Date();
  return {
    date: `${n.getFullYear()}-${pad2(n.getMonth() + 1)}-${pad2(n.getDate())}`,
    week: `星期${WEEK_CN[n.getDay()]}`,
  };
}

/** 单个数字字形在指定高度下的绘制宽度（字形图等宽 240×280，等比缩放） */
function digitGlyphWidth(img: HTMLImageElement, h: number): number {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const ratio = nw > 0 && nh > 0 ? nw / nh : 6 / 7;
  return h * ratio;
}

/** 一串数字（如 "10"、"2026"）按字形图的总宽度；gap 为相邻字形间距（最后不追加） */
function digitsWidth(
  imgs: Record<string, HTMLImageElement>,
  text: string,
  h: number,
  gap: number,
): number {
  let total = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    total += digitGlyphWidth(imgs[ch], h);
    if (i < text.length - 1) total += gap;
  }
  return total;
}

/** 从 x 起水平绘制一串数字字形图（高 h、垂直中心 yC、相邻间距 gap），返回末端 x */
function drawDigits(
  ctx: CanvasRenderingContext2D,
  imgs: Record<string, HTMLImageElement>,
  text: string,
  x: number,
  yC: number,
  h: number,
  gap: number,
): number {
  let cur = x;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const w = digitGlyphWidth(imgs[ch], h);
    ctx.drawImage(imgs[ch], cur, yC - h / 2, w, h);
    cur += w;
    if (i < text.length - 1) cur += gap;
  }
  return cur;
}

/** 绘制时间地点 LOGO（黑底白字），与预览 `.datetime-logo` 样式一致 */
async function drawDatetimeLogo(
  ctx: CanvasRenderingContext2D,
  cfg: Partial<DatetimeLogoValues>,
  seed: string,
  dateIndex: number,
  cx: number,
  cy: number,
  scale: number,
  /** 时间行大数字（0-9 字形图）间距（基准 px；随整体水印同比例缩放） */
  timeDigitSpacing: number,
  /** 日期行小数字（0-9 字形图）间距（基准 px；随整体水印同比例缩放） */
  dateDigitSpacing: number,
) {
  const def = todayParts();
  const now = new Date();
  const time =
    resolveDatetimeTime(cfg, seed) ??
    `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  const date = resolveDatetimeDate(cfg, dateIndex) ?? def.date;
  const week = resolveDatetimeWeek(cfg, dateIndex) ?? def.week;
  const location = cfg.location ?? "厦门市·厦门华澄制药有限公司";

  const [hh, mm] = time.split(":");
  const [y, m, d] = date.split("-");

  // 时间/日期数字改用 0-9 字形图（240×280 等宽，按目标高度等比缩放）；
  // 只加载本次出现的字符（模块级缓存，批量导出不重复 decode）
  const needDigits = digitCharsOf(`${hh}${mm}${y}${m}${d}`);
  const digitImgs = Object.fromEntries(
    await Promise.all(
      needDigits.map(async (ch) => [ch, await loadNumberGlyph(ch)] as const),
    ),
  ) as Record<string, HTMLImageElement>;

  // 地点图标（dingwei3.png 替换原 📍 emoji）：async 预载（模块级缓存，只 decode 一次）；
  // 高度基准 11px（与预览 DOM .datetime-loc-icon 一致），宽度按原图宽高比缩放
  const locIconImg = await loadLocIcon(dingwei3Url);
  const locIconH = 11 * scale;
  const locIconW =
    locIconImg.naturalWidth > 0 && locIconImg.naturalHeight > 0
      ? locIconH * (locIconImg.naturalWidth / locIconImg.naturalHeight)
      : locIconH;
  // 图标右侧间距（与预览 DOM .datetime-loc-icon 的 margin-right:3px 一致，需计入行宽；
  // margin-left 为 0，图标紧贴前方内容）
  const locIconTrail = 3 * scale;

  const infoFont = `${9 * scale}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`;
  // 数字字形高度 = 当前字号基准（时间 32px / 日期 8px），宽度按字形图 240×280 等比
  const timeDigitH = 32 * scale;
  const dateDigitH = 8 * scale;
  // 大/小数字各自独立间距（随整体水印缩放）
  const timeDigitGap = timeDigitSpacing * scale;
  const dateDigitGap = dateDigitSpacing * scale;

  // 时间行宽度：hh + 冒号盒(左右各 3px margin + 6px 宽) + mm
  const hhW = digitsWidth(digitImgs, hh, timeDigitH, timeDigitGap);
  const mmW = digitsWidth(digitImgs, mm, timeDigitH, timeDigitGap);
  const colonW = 6 * scale;
  const colonMargin = 2 * scale;
  const timeW = hhW + colonMargin + colonW + colonMargin + mmW;

  // 信息行宽度：日期 + 空格 + 星期 + 空格 + 地点（「·」点两边加间距，与预览一致）
  ctx.font = infoFont;
  const weekW = ctx.measureText(week).width;
  // 地点：定位图标（替换原 📍）按图标宽占位，文本按预览 letter-spacing 逐字符加间距
  const locText = location.replace(/·/g, "·");
  const locSpacing = 1 * scale;
  // 点两侧额外间距（对应预览 DOM .datetime-dot 的左右 margin 各 2px；每点前后各加 dotPad）
  const dotPad = 2 * scale;
  const locChars = Array.from(locText);
  const locWs = locChars.map((ch) => ctx.measureText(ch).width);
  const locDotN = locChars.filter((ch) => ch === "·").length;
  const locTextW =
    locWs.reduce((s, w) => s + w, 0) +
    locSpacing * (locChars.length - 1) +
    locDotN * dotPad * 2;
  const locW = locIconW + locIconTrail + locTextW;
  const spaceW = ctx.measureText(" ").width;

  const sepW = 4 * scale;
  const sepGap = 0.5 * scale;
  const yW = digitsWidth(digitImgs, y, dateDigitH, dateDigitGap);
  const mW = digitsWidth(digitImgs, m, dateDigitH, dateDigitGap);
  const dW = digitsWidth(digitImgs, d, dateDigitH, dateDigitGap);
  const dateW = yW + sepW + mW + sepW + dW + sepGap * 4;

  const infoW = dateW + spaceW + weekW + spaceW + locW;

  // 与预览 .datetime-logo 一致：无背景、透明底、每行各自水平居中
  const padH = 6 * scale;
  // 时间行占位高度 = font-size 42 * line-height 1.3 - margin-bottom 6
  const timeH = (42 * 1.3 - 6) * scale;
  const infoH = 9 * 1.3 * scale;
  const blockH = padH + timeH + infoH + padH;
  const top = cy - blockH / 2;

  // 时间行：整体以 cx 居中，内部 hh / 冒号 / mm 按测量宽度顺序排布
  // 一丢丢文字阴影，与预览 .datetime-logo 的 text-shadow 一致
  ctx.shadowColor = "rgba(0, 0, 0, 0.2)";
  ctx.shadowBlur = 0.75 * scale;
  ctx.shadowOffsetY = 0.75 * scale;
  const timeLeft = cx - timeW / 2;
  const timeY = top + padH + timeH / 2;
  ctx.fillStyle = "#fff";
  ctx.textAlign = "left";
  // 时间行：hh / 冒号 / mm 数字字形图，垂直中心对齐 timeY
  drawDigits(ctx, digitImgs, hh, timeLeft, timeY, timeDigitH, timeDigitGap);
  // 冒号：两个圆点（直径 5px，两点间距 12px），垂直居中对齐
  const colonLeft = timeLeft + hhW + colonMargin;
  const colonCx = colonLeft + colonW / 2;
  const dotR = (5 * scale) / 2;
  const dotGap = 16 * scale;
  ctx.beginPath();
  ctx.arc(colonCx, timeY + 2 - dotGap / 2, dotR, 0, Math.PI * 2);
  ctx.arc(colonCx, timeY + 2 + dotGap / 2, dotR, 0, Math.PI * 2);
  ctx.fill();
  drawDigits(
    ctx,
    digitImgs,
    mm,
    colonLeft + colonW + colonMargin,
    timeY,
    timeDigitH,
    timeDigitGap,
  );

  // 信息行：整体以 cx 居中（日期 + 空格 + 星期 + 空格 + 地点）；
  // 日期/星期/📍/地点均按字形视觉中心对齐 infoY，
  // 避免 cursive（日期）与系统字体（星期）基线/em-box 差异导致行高错位
  const infoLeft = cx - infoW / 2;
  const infoY = top + padH + timeH + infoH / 2;
  // 日期段：仅其数字左移 dateShift（对应预览 DOM .datetime-date 的 left:-3px，
  // 视觉微调，不推动后方星期/地点），用独立游标 xd 绘制，结束后从流位置 infoLeft+dateW 继续
  const dateShift = -3 * scale;
  let xd = infoLeft + dateShift;
  drawDigits(ctx, digitImgs, y, xd, infoY, dateDigitH, dateDigitGap);
  xd += yW + sepGap;
  ctx.fillRect(xd, infoY - 0.5 * scale, sepW, 1 * scale);
  xd += sepW + sepGap;
  drawDigits(ctx, digitImgs, m, xd, infoY, dateDigitH, dateDigitGap);
  xd += mW + sepGap;
  ctx.fillRect(xd, infoY - 0.5 * scale, sepW, 1 * scale);
  xd += sepW + sepGap;
  drawDigits(ctx, digitImgs, d, xd, infoY, dateDigitH, dateDigitGap);
  let x = infoLeft + dateW;

  ctx.font = infoFont;
  x += spaceW;
  // 星期文字单独左移 weekShift（对应预览 DOM .datetime-week 的 left:-2px，
  // 视觉微调，不推动后方地点/图标），x 游标保持原值继续
  const weekShift = 2 * scale;
  drawCenteredText(ctx, week, x - weekShift, infoY);
  x += weekW + spaceW;
  // 定位图标：紧贴前方内容（与预览 DOM .datetime-loc-icon margin-left:0 一致），
  // 以信息行视觉中心 infoY 垂直居中绘制；整体再右移 locShift（对应预览 DOM
  // .datetime-loc 的 left:2px，视觉微调，不影响行宽/后方无内容）
  const locShift = 2 * scale;
  // 图标自身再上移 1px、右移 1px（对应预览 DOM .datetime-loc-icon 的 top:-1px / left:1px；
  // 右移只移动图标视觉位置，文本起点不联动，间距随之少 1px）
  const locIconDx = 1 * scale;
  const locIconDy = 1 * scale;
  ctx.drawImage(
    locIconImg,
    x + locShift + locIconDx,
    infoY - locIconH / 2 - locIconDy,
    locIconW,
    locIconH,
  );
  // 文本起点：图标右侧空出 locIconTrail（与预览 DOM .datetime-loc-icon margin-right:3px 一致）。
  // 逐字绘制：遇「·」前后各补 dotPad，其余按 locSpacing 加字距（canvas 无 CSS margin，手动补齐）
  const locM = ctx.measureText(locText);
  const locDy =
    ((locM.actualBoundingBoxAscent || 0) -
      (locM.actualBoundingBoxDescent || 0)) /
    2;
  let locX = x + locShift + locIconW + locIconTrail;
  locChars.forEach((ch, i) => {
    if (ch === "·") locX += dotPad;
    ctx.fillText(ch, locX, infoY + locDy);
    locX += locWs[i];
    if (ch === "·") locX += dotPad;
    if (i < locChars.length - 1) locX += locSpacing;
  });

  // 重置阴影，避免影响后续绘制
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

/** 绘制地理信息水印（日期时间/经度/纬度/地点/备注），与预览 .geo-info-logo 样式一致 */
function drawGeoInfoLogo(
  ctx: CanvasRenderingContext2D,
  cfg: Partial<GeoInfoLogoValues>,
  cx: number,
  cy: number,
  scale: number,
  seed = "watermark",
  dateIndex = 0,
) {
  // 主体固定四行（时间/经度/纬度/地点）。备注单独绘制并挂在四行下方，
  // 不参与 blockW / blockH / top 计算：加不加备注，上面四行与中心锚点都不位移（与预览一致）
  const rows = [
    { label: "时间", value: resolveGeoInfoTimeText(cfg, dateIndex, seed) },
    { label: "经度", value: `${cfg.longitude ?? "118.1598"}°E` },
    { label: "纬度", value: `${cfg.latitude ?? "24.5270"}°N` },
    { label: "地点", value: cfg.location ?? "厦门市·万寿路" },
  ];
  const remarkText = (cfg.remark ?? "").trim();

  // ==================== 排版参数（改这里） ====================
  // ① 字重：字符串第一个数字即字体粗细（100 极细 / 300 细 / 400 常规 / 500 中 / 700 加粗）
  // ② 字号：10 * scale 里的 10 是基准字号（按 800px 宽图片设计），改 10 即可整体放大/缩小
  //    注意：不要动 scale，它由「水印大小」滑块控制；只改 10 那个数字
  const labelFont = `500 ${10 * scale}px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`; // 标签（时间/经度/纬度…）：字重 500、字号 10
  const valueFont = `500 ${10 * scale}px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`; // 值（右侧具体内容）：与标签一致，字重 500、字号 10
  // ③ 颜色：下面的 ctx.fillStyle = "#fff" 即文字颜色（白色），想改色直接换这里或改 fillStyle
  const labelSpacing = 3 * scale; // ← label 字间距（1 即可，改大拉得更开，0 关闭）
  const gap = 9 * scale; // 标签和值之间
  const lineH = 17 * scale; // 行高（行间距，改大行更稀疏）

  ctx.textBaseline = "middle";
  ctx.fillStyle = "#f1f1f1"; // ← 文字颜色在这里改（如 "#ff0000" 红色、"rgba(255,255,255,0.8)" 半透明白）

  // 先测宽度（label 宽度需计入字间距）
  ctx.font = labelFont;
  const labelW = Math.max(
    ...rows.map((r) => {
      const chars = Array.from(r.label);
      return (
        chars.reduce((s, ch) => s + ctx.measureText(ch).width, 0) +
        labelSpacing * Math.max(0, chars.length - 1)
      );
    }),
  );
  ctx.font = valueFont;
  const valueW = Math.max(...rows.map((r) => ctx.measureText(r.value).width));

  const blockW = labelW + gap + valueW;
  const blockH = rows.length * lineH; // 只按主体四行算高度：备注不撑高卡片
  const left = cx - blockW / 2;
  const top = cy - blockH / 2;

  rows.forEach((row, i) => {
    const y = top + lineH * i + lineH / 2;
    ctx.font = labelFont;
    ctx.textAlign = "left";
    fillTextWithSpacing(ctx, row.label, left, y, labelSpacing); // ← label 逐字绘制，支持字间距

    ctx.font = valueFont;
    // 与预览一致：连续 2+ 个半角空格 → NBSP，任何环境都不会折叠
    ctx.fillText(
      row.value.replace(/ {2,}/g, (m) => "\u00A0".repeat(m.length)),
      left + labelW + gap,
      y,
    );
  });

  // 备注行：画在主体四行下方一个行距处（视觉上就是"普通第 5 行"的位置，不抬高主体）
  if (remarkText) {
    const y = top + lineH * rows.length + lineH / 2;
    ctx.font = labelFont;
    fillTextWithSpacing(ctx, "备注", left, y, labelSpacing);
    ctx.font = valueFont;
    ctx.fillText(
      remarkText.replace(/ {2,}/g, (m) => "\u00A0".repeat(m.length)),
      left + labelW + gap,
      y,
    );
  }
}

/** 判断导出格式：PNG 保留透明，其余转 JPEG */
function pickMime(name: string): "image/png" | "image/jpeg" {
  return /\.png$/i.test(name) ? "image/png" : "image/jpeg";
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("图片编码失败"))),
      type,
      quality ?? 0.92,
    );
  });
}

/**
 * 将水印合成到图片上，返回带水印的新图。
 * 位置：opts.position 为水印块中心相对图片的百分比（与预览拖拽值一致）；
 * 大小：按 图片宽度 / WATERMARK_REF_WIDTH 等比缩放，再乘 opts.scale 倍率，
 * 与预览（图片显示宽 / WATERMARK_REF_WIDTH）比例一致，所见即所得。
 */
export async function composeWatermark(
  image: PhotoItem,
  preset: WatermarkPreset,
  opts: ComposeOptions,
): Promise<ComposeResult> {
  const img = await loadImage(image.url);
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  if (W === 0 || H === 0) throw new Error("图片尺寸无效");

  // 超大图保护：最长边超过 8192 时等比缩小；预览可传 maxDim 用小尺寸加速编码
  let canvasW = W;
  let canvasH = H;
  const MAX = 8192;
  const limit = Math.min(
    MAX,
    opts.maxDim && opts.maxDim > 0 ? opts.maxDim : MAX,
  );
  if (Math.max(W, H) > limit) {
    const shrink = limit / Math.max(W, H);
    canvasW = Math.round(W * shrink);
    canvasH = Math.round(H * shrink);
  }

  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布");
  ctx.drawImage(img, 0, 0, canvasW, canvasH);

  // 水印比例系数：图片宽度 / 参考宽度 × 倍率
  const factor = (canvasW / WATERMARK_REF_WIDTH) * ((opts.scale ?? 100) / 100);

  const cx = (canvasW * opts.position.x) / 100;
  const cy = (canvasH * opts.position.y) / 100;
  // 一丢丢非常微弱的模糊（柔化水印边缘），与预览 .watermark-content 的 filter: blur() 一致；
  // 图片 LOGO 与文字/日期 LOGO 使用各自独立的模糊值
  const isDatetime = preset.config?.variant === "datetime";
  const isGeoInfo = preset.config?.variant === "geo-info";
  // 图片水印允许 config.blur 单独覆盖（如现场拍照 LOGO blur: 0 关闭模糊）
  const blurPx =
    preset.type === "image"
      ? typeof preset.config?.blur === "number"
        ? preset.config.blur
        : WATERMARK_BLUR_PX_LOGO
      : WATERMARK_BLUR_PX_TEXT;
  ctx.filter = `blur(${blurPx * factor}px)`;
  const cfg = (preset.config ?? {}) as Partial<DatetimeLogoValues>;
  const geoCfg = (preset.config ?? {}) as Partial<GeoInfoLogoValues>;

  if (isDatetime) {
    await drawDatetimeLogo(
      ctx,
      cfg,
      opts.seed,
      opts.dateIndex ?? 0,
      cx,
      cy,
      factor,
      opts.timeDigitSpacing ?? 0,
      opts.dateDigitSpacing ?? 0,
    );
  } else if (isGeoInfo) {
    // 地理信息水印整体透明度（0~1，1 全不透明；预览与导出同步）
    const geoOpacity =
      typeof preset.config?.opacity === "number" ? preset.config.opacity : 1;
    ctx.globalAlpha = clamp(geoOpacity, 0, 1);
    drawGeoInfoLogo(
      ctx,
      geoCfg,
      cx,
      cy,
      factor,
      opts.seed,
      opts.dateIndex ?? 0,
    );
    ctx.globalAlpha = 1;
  } else if (preset.type === "image") {
    const src = typeof preset.config?.src === "string" ? preset.config.src : "";
    const width =
      typeof preset.config?.width === "number" ? preset.config.width : 120;
    const opacity =
      typeof preset.config?.opacity === "number" ? preset.config.opacity : 1;
    if (src) {
      // LOGO 图片右侧的文字说明（与预览一致，随水印等比缩放）
      const captionText =
        typeof preset.config?.caption === "string" ? preset.config.caption : "";
      const captionFontSize =
        typeof preset.config?.captionFontSize === "number"
          ? preset.config.captionFontSize
          : 28;
      const captionFontWeight =
        typeof preset.config?.captionFontWeight === "string" ||
        typeof preset.config?.captionFontWeight === "number"
          ? preset.config.captionFontWeight
          : "normal";
      // 右侧文字字间距：按方向取值（预览 DOM 走同一函数，保证一致）
      const captionLetterSpacing = resolveCaptionLetterSpacing(
        preset,
        opts.orientation ?? "landscape",
      );
      const captionStrokeWidth =
        typeof preset.config?.captionStrokeWidth === "number"
          ? preset.config.captionStrokeWidth
          : 0;
      const captionStrokeColor =
        typeof preset.config?.captionStrokeColor === "string"
          ? preset.config.captionStrokeColor
          : "#000";
      // 图片透明度与文字透明度分开控制：logoOpacity（图片专属）→ 缺省沿用 opacity
      const imgOpacity =
        typeof preset.config?.logoOpacity === "number"
          ? preset.config.logoOpacity
          : opacity;
      // LOGO 与右侧文字的间距（按预设可配置，缺省用全局常量）
      const captionGap =
        typeof preset.config?.captionGap === "number"
          ? preset.config.captionGap
          : LOGO_CAPTION_GAP;
      // 文字垂直偏移（按预设可配置，缺省用全局常量）
      const captionDy =
        typeof preset.config?.captionDy === "number"
          ? preset.config.captionDy
          : LOGO_CAPTION_DY;
      // 图片自身偏移（按预设可配置，缺省用全局常量）
      const imgDx =
        typeof preset.config?.imgDx === "number"
          ? preset.config.imgDx
          : LOGO_IMG_DX;
      const imgDy =
        typeof preset.config?.imgDy === "number"
          ? preset.config.imgDy
          : LOGO_IMG_DY;
      await drawImageWatermark(
        ctx,
        src,
        width * factor,
        imgOpacity,
        cx,
        cy,
        {
          text: captionText,
          fontSize: captionFontSize * factor,
          fontWeight: captionFontWeight,
          letterSpacing: captionLetterSpacing * factor,
          strokeWidth: captionStrokeWidth * factor,
          strokeColor: captionStrokeColor,
          opacity,
          gap: captionGap * factor,
          dy: captionDy * factor,
        },
        {
          dx: imgDx * factor,
          dy: imgDy * factor,
        },
      );
    } else {
      // 无图片源时退化为文字（与预览占位图标对应）
      const style = getWatermarkStyle(preset);
      drawTextWatermark(
        ctx,
        style.text,
        style.color,
        style.fontSize * factor,
        style.opacity,
        cx,
        cy,
      );
    }
  } else {
    const style = getWatermarkStyle(preset);
    drawTextWatermark(
      ctx,
      style.text,
      style.color,
      style.fontSize * factor,
      style.opacity,
      cx,
      cy,
    );
  }

  // 恢复无滤镜，避免影响后续绘制
  ctx.filter = "none";

  // PNG 无损：预览合成用，避免 JPEG 二次压缩导致半透明水印区域色偏/发灰
  const mime = opts.format === "png" ? "image/png" : pickMime(image.name);
  const blob = await canvasToBlob(canvas, mime, opts.quality);
  const url = URL.createObjectURL(blob);
  return { url, blob, width: canvasW, height: canvasH };
}
