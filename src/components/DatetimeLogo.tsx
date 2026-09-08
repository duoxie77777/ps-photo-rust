import { Fragment, useState } from "react";
import dingwei3Url from "../assets/dingwei3.png";
import { NUMBER_GLYPH_SRC } from "./numberGlyphs";
import type { DatetimeLogoValues } from "./types";

interface DatetimeLogoProps {
  location?: string;
  size?: "small" | "large";
  /** 时间（"HH:mm"），缺省取当前时间 */
  time?: string;
  /** 日期（"YYYY-MM-DD"），缺省取当前日期 */
  date?: string;
  /** 星期（"星期六"），缺省按当前日期计算 */
  week?: string;
}

const WEEK_CN = ["日", "一", "二", "三", "四", "五", "六"];

const pad = (n: number) => String(n).padStart(2, "0");

/** 校验时间地点 LOGO 编辑值，返回错误信息对象（空对象表示通过） */
export function validateDatetimeValues(
  values: DatetimeLogoValues,
): Partial<Record<keyof DatetimeLogoValues, string>> {
  const errors: Partial<Record<keyof DatetimeLogoValues, string>> = {};
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
  } else if (!timeRe.test(values.time.trim())) {
    errors.time = "格式：HH:mm，如 09:30";
  }
  const dateRe = /^\d{4}-\d{1,2}-\d{1,2}$/;
  if (values.dateMode === "sequence") {
    if (!values.dateStart || !dateRe.test(values.dateStart.trim())) {
      errors.date = "起始日期格式：YYYY-MM-DD，如 2026-05-01";
    }
  } else if (!dateRe.test(values.date.trim())) {
    errors.date = "格式：YYYY-MM-DD，如 2026-08-29";
  }
  // 顺序递增模式下星期自动按日期计算，无需手动输入
  if (values.dateMode !== "sequence" && values.week.trim().length === 0) {
    errors.week = "请输入星期";
  }
  if (values.location.trim().length === 0) {
    errors.location = "请输入地点";
  }
  return errors;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 简单字符串 hash（作为随机种子） */
function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * 按种子在 [start, end] 时间区间内生成确定性随机时间（HH:mm）。
 * 同一图片（种子相同）结果稳定，不同图片结果不同。
 */
export function randomTimeInRange(
  seed: string,
  start: string,
  end: string,
): string {
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const startMin = toMin(start);
  const endMin = toMin(end);
  const span = Math.max(endMin - startMin + 1, 1);
  const min = startMin + (hashSeed(seed) % span);
  return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
}

/**
 * 解析时间地点 LOGO 最终显示的时间：
 * 固定模式直接用 time（缺省返回 undefined，由组件回退当前时间）；
 * 区间模式按种子随机生成
 */
export function resolveDatetimeTime(
  values: Pick<DatetimeLogoValues, "timeMode" | "timeStart" | "timeEnd"> & {
    time?: string;
  },
  seed?: string,
): string | undefined {
  if (values.timeMode === "range" && values.timeStart && values.timeEnd) {
    return randomTimeInRange(
      seed ?? "watermark",
      values.timeStart,
      values.timeEnd,
    );
  }
  return values.time;
}

/**
 * 从起始日期（YYYY-MM-DD）起，按天数偏移（0 = 起始日期本身）计算日期。
 * 用于顺序递增模式：第 1 张图 = 起始日期，第 2 张 = 起始日期 + 1 天……
 */
export function dateFromStart(start: string, offsetDays: number): string {
  const [y, m, d] = start.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d);
  const result = new Date(base + Math.max(0, offsetDays) * 86400000);
  return `${result.getUTCFullYear()}-${pad2(result.getUTCMonth() + 1)}-${pad2(result.getUTCDate())}`;
}

/** 根据日期（YYYY-MM-DD）计算对应星期（如「星期六」） */
export function weekOfDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `星期${WEEK_CN[new Date(y, m - 1, d).getDay()]}`;
}

/**
 * 解析时间地点 LOGO 最终显示的日期：
 * 固定模式直接用 date（缺省返回 undefined，由组件回退当前日期）；
 * 顺序递增模式返回 起始日期 + index 天（第 1 张图 index=0）
 */
export function resolveDatetimeDate(
  values: Pick<DatetimeLogoValues, "dateMode" | "dateStart"> & {
    date?: string;
  },
  index = 0,
): string | undefined {
  if (values.dateMode === "sequence" && values.dateStart) {
    return dateFromStart(values.dateStart, index);
  }
  return values.date;
}

/**
 * 解析最终显示的星期：
 * 顺序递增模式下自动按生成的日期计算（忽略手动输入）；
 * 固定模式直接用 week
 */
export function resolveDatetimeWeek(
  values: Pick<DatetimeLogoValues, "dateMode" | "dateStart"> & {
    week?: string;
  },
  index = 0,
): string | undefined {
  if (values.dateMode === "sequence" && values.dateStart) {
    return weekOfDate(dateFromStart(values.dateStart, index));
  }
  return values.week;
}

/**
 * 时间地点 LOGO：黑底白字，上方时间，下方日期 + 星期 + 地点
 * 完全受控：展示内容直接来自 props
 * 时间与日期的数字用 0-9 字形图替代（与 canvas 合成同一资源），
 * 冒号、分隔短横线仍由 CSS/文本绘制
 */
function NumRow({ text }: { text: string }) {
  return (
    <>
      {Array.from(text).map((ch, i) =>
        NUMBER_GLYPH_SRC[ch] ? (
          <img
            key={i}
            src={NUMBER_GLYPH_SRC[ch]}
            alt=""
            draggable={false}
            className="datetime-num"
          />
        ) : (
          <span key={i}>{ch}</span>
        )
      )}
    </>
  );
}

function DatetimeLogo({
  location,
  size = "large",
  time,
  date,
  week,
}: DatetimeLogoProps) {
  const [now] = useState(() => new Date());
  const timeValue = time ?? `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const dateValue =
    date ??
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const weekValue = week ?? `星期${WEEK_CN[now.getDay()]}`;
  // 地点中的「·」点两边加间距，避免紧贴文字
  const locValue = (location ?? "厦门市·厦门华澄制药有限公司").replace(
    /·/g,
    " · ",
  );
  // 拆出「·」单独渲染：点两侧在既有空格外再各加 1px（.datetime-dot 的左右 margin），
  // 不牵动整行 letter-spacing（预览与 canvas 导出同步）
  const locParts = locValue.split("·");

  const [hh, mm] = timeValue.split(":");
  const [y, m, d] = dateValue.split("-");

  return (
    <div
      className={`datetime-logo ${size === "small" ? "datetime-logo-small" : ""}`}
    >
      <div className="datetime-time">
        <NumRow text={hh} />
        <span className="datetime-colon" />
        <NumRow text={mm} />
      </div>
      <div className="datetime-info">
        <span className="datetime-date">
          <NumRow text={y} />-<NumRow text={m} />-<NumRow text={d} />
        </span>{" "}
        <span className="datetime-week">{weekValue}</span>{" "}
        <span className="datetime-loc">
          <img
            src={dingwei3Url}
            alt=""
            draggable={false}
            className="datetime-loc-icon"
          />
          <span style={{ letterSpacing: 2 }}>
            {locParts.map((part, i) => (
              <Fragment key={i}>
                {i > 0 && <span className="datetime-dot">·</span>}
                {part}
              </Fragment>
            ))}
          </span>
        </span>
      </div>
    </div>
  );
}

export default DatetimeLogo;
