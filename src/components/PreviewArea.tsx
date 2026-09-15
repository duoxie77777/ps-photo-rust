import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { App, Button, Input, Modal, Segmented, Select, Slider, TimePicker, Tooltip } from "antd";
import dayjs from "dayjs";
import {
  ZoomInOutlined,
  ZoomOutOutlined,
  ExportOutlined,
  PictureOutlined,
  CloseOutlined,
  EditOutlined,
  FieldTimeOutlined,
  ClockCircleOutlined,
  CalendarOutlined,
  ScheduleOutlined,
  EnvironmentOutlined,
  AimOutlined,
  ScissorOutlined,
} from "@ant-design/icons";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import DatetimeLogo, {
  resolveDatetimeDate,
  resolveDatetimeTime,
  resolveDatetimeWeek,
  validateDatetimeValues,
} from "./DatetimeLogo";
import GeoInfoLogo, {
  parseGeoInfoCombinedTime,
  resolveGeoInfoTimeText,
  validateGeoInfoValues,
} from "./GeoInfoLogo";
import {
  composeWatermark,
  WATERMARK_REF_WIDTH,
  WATERMARK_BLUR_PX_LOGO,
  WATERMARK_BLUR_PX_TEXT,
  LOGO_CAPTION_GAP,
  LOGO_CAPTION_DY,
  LOGO_IMG_DX,
  LOGO_IMG_DY,
} from "./composeWatermark";
import {
  resolveCaptionLetterSpacing,
  resolveWatermarkPosition,
  resolveWatermarkScale,
} from "./watermarkStore";
import CropView from "./CropView";
import type {
  DatetimeLogoValues,
  GeoInfoLogoValues,
  PhotoItem,
  WatermarkOrientation,
  WatermarkPosition,
  WatermarkPositionsMap,
  WatermarkPreset,
  WatermarkScalesMap,
} from "./types";

/** 兼容旧引用：从 types 重新导出 */
export type { WatermarkPosition } from "./types";

interface PreviewAreaProps {
  image: PhotoItem | null;
  /** 当前图片在原始列表中的序号（0 起）：日期顺序递增模式按此计算 */
  imageIndex?: number;
  onExport: () => void;
  /** 是否正在导出 */
  exporting?: boolean;
  /** 裁剪应用完成回调（EditorLayout 决定替换原图还是处理结果） */
  onCropApplied?: (result: { url: string; size: number; width: number; height: number }) => void;
  /** 选中的多个水印预设（多选叠加） */
  watermarkPresets: WatermarkPreset[];
  watermarkEnabled: boolean;
  /** 各预设按横/竖屏方向独立的水印位置（按预设 ID，受控，用于导出合成） */
  watermarkPositions: WatermarkPositionsMap;
  /** 当前水印布局方向（横屏 / 竖屏，位置两套各自独立） */
  watermarkOrientation: WatermarkOrientation;
  /** 切换当前水印布局方向 */
  onWatermarkOrientationChange: (orientation: WatermarkOrientation) => void;
  onWatermarkPositionChange: (
    id: string,
    orientation: WatermarkOrientation,
    pos: WatermarkPosition,
  ) => void;
  /** 各预设按横/竖屏方向独立的水印大小倍率（百分比，100 = 基准大小） */
  watermarkScales: WatermarkScalesMap;
  onWatermarkScaleChange: (
    id: string,
    orientation: WatermarkOrientation,
    scale: number,
  ) => void;
  /** 时间行大数字（0-9 字形）间距（基准 px；负值 = 往里缩） */
  timeDigitSpacing: number;
  onTimeDigitSpacingChange: (spacing: number) => void;
  /** 日期行小数字（0-9 字形）间距（基准 px；负值 = 往里缩） */
  dateDigitSpacing: number;
  onDateDigitSpacingChange: (spacing: number) => void;
  /** 移除单个水印（取消选中该预设） */
  onRemoveWatermark: (presetId: string) => void;
  /** 时间地点 LOGO 编辑值变化回调（按预设 ID） */
  onWatermarkDatetimeChange?: (id: string, values: DatetimeLogoValues) => void;
  /** 地理信息水印编辑值变化回调（按预设 ID） */
  onWatermarkGeoInfoChange?: (id: string, values: GeoInfoLogoValues) => void;
  /** 空态标题（image 为空时展示；null 表示不展示标题） */
  emptyTitle?: string | null;
  /** 空态描述（image 为空时展示；为 null 时用默认文案） */
  emptyText?: string | null;
}

/** 水印配置的读取与样式计算 */
function getWatermarkStyle(preset: WatermarkPreset) {
  const text =
    typeof preset.config?.text === "string" && preset.config.text.length > 0
      ? preset.config.text
      : preset.name;
  const color = typeof preset.config?.color === "string" ? preset.config.color : "#ffffff";
  const fontSize = typeof preset.config?.fontSize === "number" ? preset.config.fontSize : 40;
  const opacity = typeof preset.config?.opacity === "number" ? preset.config.opacity : 0.35;
  return { text, color, fontSize, opacity };
}

const clamp = (v: number, min = 0, max = 100) => Math.min(max, Math.max(min, v));

/**
 * 计算水印中心点在图片内的百分比范围（保证水印整体不超出图片）
 * 视觉尺寸来自 getBoundingClientRect，与图片处于同一坐标系
 */
function getBounds(imgRect: { width: number; height: number }, elRect: DOMRect) {
  const minX = Math.min((elRect.width / 2 / imgRect.width) * 100, 50);
  const minY = Math.min((elRect.height / 2 / imgRect.height) * 100, 50);
  return { minX, maxX: 100 - minX, minY, maxY: 100 - minY };
}

/** 边界 clamp，水印比图片大时保持居中 */
const clampTo = (v: number, min: number, max: number) =>
  max >= min ? clamp(v, min, max) : 50;

const pad2 = (n: number) => String(n).padStart(2, "0");
const WEEK_CN = ["日", "一", "二", "三", "四", "五", "六"];

/** 解析 "HH:mm" 为 { h, m }（非法或缺失返回 null） */
function parseHM(t?: string): { h: string; m: string } | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(t.trim());
  if (!m) return null;
  return { h: m[1].padStart(2, "0"), m: m[2].padStart(2, "0") };
}

/** 时+分合成一个控件的选择器（输出 "HH:mm"，分钟每 5 分钟一档） */
function TimeSelect({
  value,
  onChange,
  status,
}: {
  value?: string;
  onChange: (v: string) => void;
  status?: "error";
}) {
  const hm = parseHM(value);
  return (
    <TimePicker
      format="HH:mm"
      minuteStep={5}
      allowClear={false}
      needConfirm={false}
      value={hm ? dayjs(`${hm.h}:${hm.m}`, "HH:mm") : null}
      onChange={(d) => onChange(d ? d.format("HH:mm") : "")}
      status={status}
      suffixIcon={<FieldTimeOutlined />}
      popupClassName="datetime-time-picker-dropdown"
      className="datetime-time-picker"
    />
  );
}

/** 日期下拉选项：年 2000-2045，月 01-12，日按年月动态生成（自动钳制到当月天数） */
const DATE_YEARS = Array.from({ length: 46 }, (_, i) => String(2000 + i));
const DATE_MONTHS = Array.from({ length: 12 }, (_, i) => pad2(i + 1));
const YEAR_OPTS = DATE_YEARS.map((y) => ({ label: y, value: y }));
const MONTH_OPTS = DATE_MONTHS.map((m) => ({ label: m, value: m }));
const WEEK_OPTS = WEEK_CN.map((w) => ({ label: `星期${w}`, value: `星期${w}` }));

/** 某年某月的天数（m 为 "01"~"12"） */
function daysInMonth(y: string, m: string) {
  return new Date(Number(y), Number(m), 0).getDate();
}

/** 解析 "YYYY-MM-DD" 为 { y, m, d }（非法或缺失返回 null） */
function parseYMD(v?: string): { y: string; m: string; d: string } | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v.trim());
  if (!m) return null;
  return { y: m[1], m: m[2].padStart(2, "0"), d: m[3].padStart(2, "0") };
}

/** 年/月/日 三下拉组合的日期选择器（输出 "YYYY-MM-DD"；切换月份时自动钳制日期） */
function DateSelect({
  value,
  onChange,
  status,
}: {
  value?: string;
  onChange: (v: string) => void;
  status?: "error";
}) {
  const p = parseYMD(value) ?? { y: "2026", m: "01", d: "01" };
  const y = YEAR_OPTS.some((o) => o.value === p.y) ? p.y : "2026";
  const m = /^(0[1-9]|1[0-2])$/.test(p.m) ? p.m : "01";
  const dim = daysInMonth(y, m);
  const d = /^\d{1,2}$/.test(p.d) ? pad2(Math.min(Number(p.d), dim)) : "01";
  const dayOpts = Array.from({ length: dim }, (_, i) => pad2(i + 1)).map((v) => ({
    label: v,
    value: v,
  }));
  return (
    <div
      className={`datetime-date-group${status === "error" ? " status-error" : ""}`}
    >
      <Select<string>
        className="datetime-date-select datetime-date-select-year"
        value={y}
        options={YEAR_OPTS}
        variant="borderless"
        popupMatchSelectWidth={false}
        popupClassName="datetime-time-select-dropdown"
        onChange={(ny) => onChange(`${ny}-${m}-${d}`)}
      />
      <span className="datetime-date-sep">-</span>
      <Select<string>
        className="datetime-date-select datetime-date-select-month"
        value={m}
        options={MONTH_OPTS}
        variant="borderless"
        popupMatchSelectWidth={false}
        popupClassName="datetime-time-select-dropdown"
        onChange={(nm) => {
          const nd = pad2(Math.min(Number(d), daysInMonth(y, nm)));
          onChange(`${y}-${nm}-${nd}`);
        }}
      />
      <span className="datetime-date-sep">-</span>
      <Select<string>
        className="datetime-date-select datetime-date-select-day"
        value={d}
        options={dayOpts}
        variant="borderless"
        popupMatchSelectWidth={false}
        popupClassName="datetime-time-select-dropdown"
        onChange={(nd) => onChange(`${y}-${m}-${nd}`)}
      />
    </div>
  );
}

/** 星期下拉（星期日 ~ 星期六） */
function WeekSelect({
  value,
  onChange,
  status,
}: {
  value?: string;
  onChange: (v: string) => void;
  status?: "error";
}) {
  const v = WEEK_OPTS.some((o) => o.value === value) ? value : WEEK_OPTS[6].value;
  return (
    <Select<string>
      className="datetime-week-select"
      value={v}
      options={WEEK_OPTS}
      popupClassName="datetime-time-select-dropdown"
      status={status}
      onChange={onChange}
    />
  );
}

/** 当前时刻的默认时间地点值 */
function defaultDatetimeValues() {
  const n = new Date();
  return {
    time: `${pad2(n.getHours())}:${pad2(n.getMinutes())}`,
    date: `${n.getFullYear()}-${pad2(n.getMonth() + 1)}-${pad2(n.getDate())}`,
    week: `星期${WEEK_CN[n.getDay()]}`,
    location: "厦门市·厦门华澄制药有限公司",
  };
}

/** 地理信息水印默认值（时间/日期缺省跟随当前时刻；备注留空 = 不显示该行） */
function defaultGeoInfoValues(): GeoInfoLogoValues {
  const n = new Date();
  return {
    time: `${pad2(n.getHours())}:${pad2(n.getMinutes())}`,
    date: `${n.getFullYear()}-${pad2(n.getMonth() + 1)}-${pad2(n.getDate())}`,
    longitude: "118.1598",
    latitude: "24.5270",
    location: "厦门市·万寿路",
    remark: "",
  };
}

/** 时间地点 LOGO 编辑弹窗（受控 Input + 手动校验，支持固定/区间时间） */
function DatetimeEditModal({
  open,
  initial,
  onCancel,
  onSave,
}: {
  open: boolean;
  initial: DatetimeLogoValues;
  onCancel: () => void;
  onSave: (values: DatetimeLogoValues) => void;
}) {
  const [values, setValues] = useState<DatetimeLogoValues>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof DatetimeLogoValues, string>>>(
    {}
  );
  const [locating, setLocating] = useState(false);
  const { message } = App.useApp();

  /** 打开时重置为初始值 */
  useLayoutEffect(() => {
    if (open) {
      setValues(initial);
      setErrors({});
    }
  }, [open, initial]);

  const setField = (field: keyof DatetimeLogoValues, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    // 输入变化时清除该字段的错误提示
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  const setMode = (mode: "fixed" | "range") => {
    setValues((prev) => ({ ...prev, timeMode: mode }));
    setErrors((prev) => (prev.time ? { ...prev, time: undefined } : prev));
  };

  /** 浏览器定位：获取当前经纬度填入地点 */
  const locate = () => {
    if (!navigator.geolocation) {
      message.warning("当前环境不支持定位");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const loc = `${longitude.toFixed(6)}, ${latitude.toFixed(6)}`;
        setField("location", loc);
        setLocating(false);
        message.success("已获取当前位置");
      },
      (err) => {
        setLocating(false);
        switch (err.code) {
          case err.PERMISSION_DENIED:
            message.warning("定位权限被拒绝，请在浏览器设置中允许后重试");
            break;
          case err.POSITION_UNAVAILABLE:
            message.warning("暂时无法获取位置信号");
            break;
          case err.TIMEOUT:
            message.warning("定位超时，请重试");
            break;
          default:
            message.warning("定位失败，请重试");
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  const setDateMode = (mode: "fixed" | "sequence") => {
    setValues((prev) => ({ ...prev, dateMode: mode }));
    setErrors((prev) => (prev.date ? { ...prev, date: undefined } : prev));
  };

  const handleOk = () => {
    const errs = validateDatetimeValues(values);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    onSave(values);
  };

  const timeError = errors.time ?? undefined;
  const dateError = errors.date ?? undefined;

  return (
    <Modal
      className="datetime-edit-modal"
      title={
        <div className="datetime-edit-header">
          <span className="datetime-edit-header-icon">
            <FieldTimeOutlined />
          </span>
          <span className="datetime-edit-header-text">
            <span className="datetime-edit-title">编辑时间地点 LOGO</span>
            <span className="datetime-edit-subtitle">双击水印可随时再次编辑</span>
          </span>
        </div>
      }
      open={open}
      onCancel={onCancel}
      onOk={handleOk}
      okText="保存"
      cancelText="取消"
      forceRender
      width={760}
    >
      <div className="datetime-edit-form">
        <div className="datetime-edit-field">
          <span className="datetime-edit-label">
            <ClockCircleOutlined /> 时间
          </span>
          <div className="datetime-mode-toggle">
            <button
              type="button"
              className={`datetime-mode-btn ${values.timeMode !== "range" ? "active" : ""}`}
              onClick={() => setMode("fixed")}
            >
              固定时间
            </button>
            <button
              type="button"
              className={`datetime-mode-btn ${values.timeMode === "range" ? "active" : ""}`}
              onClick={() => setMode("range")}
            >
              区间随机
            </button>
          </div>
          {values.timeMode === "range" ? (
            <div className="datetime-range-inputs">
              <TimeSelect
                value={values.timeStart}
                status={timeError ? "error" : undefined}
                onChange={(v) => setField("timeStart", v)}
              />
              <span className="datetime-to">至</span>
              <TimeSelect
                value={values.timeEnd}
                status={timeError ? "error" : undefined}
                onChange={(v) => setField("timeEnd", v)}
              />
            </div>
          ) : (
            <TimeSelect
              value={values.time}
              status={timeError ? "error" : undefined}
              onChange={(v) => setField("time", v)}
            />
          )}
          {timeError && <span className="datetime-edit-error">{timeError}</span>}
          {values.timeMode === "range" && !timeError && (
            <span className="datetime-edit-hint">
              每张图片将随机生成区间内的一个时间
            </span>
          )}
        </div>
        <div className="datetime-edit-field">
          <span className="datetime-edit-label">
            <CalendarOutlined /> 日期
          </span>
          <div className="datetime-mode-toggle">
            <button
              type="button"
              className={`datetime-mode-btn ${values.dateMode !== "sequence" ? "active" : ""}`}
              onClick={() => setDateMode("fixed")}
            >
              固定日期
            </button>
            <button
              type="button"
              className={`datetime-mode-btn ${values.dateMode === "sequence" ? "active" : ""}`}
              onClick={() => setDateMode("sequence")}
            >
              起始日期递增
            </button>
          </div>
          {values.dateMode === "sequence" ? (
            <DateSelect
              value={values.dateStart}
              status={dateError ? "error" : undefined}
              onChange={(v) => setField("dateStart", v)}
            />
          ) : (
            <DateSelect
              value={values.date}
              status={dateError ? "error" : undefined}
              onChange={(v) => setField("date", v)}
            />
          )}
          {dateError && <span className="datetime-edit-error">{dateError}</span>}
          {values.dateMode === "sequence" && !dateError && (
            <span className="datetime-edit-hint">
              第 1 张 = 起始日期，此后每张每天 +1，星期自动对应
            </span>
          )}
        </div>
        <div className="datetime-edit-field">
          <span className="datetime-edit-label">
            <ScheduleOutlined /> 星期
          </span>
          {values.dateMode === "sequence" ? (
            <span className="datetime-edit-hint" style={{ paddingTop: 4 }}>
              顺序模式下自动随日期生成
            </span>
          ) : (
            <>
              <WeekSelect
                value={values.week}
                status={errors.week ? "error" : undefined}
                onChange={(v) => setField("week", v)}
              />
              {errors.week && <span className="datetime-edit-error">{errors.week}</span>}
            </>
          )}
        </div>
        <label className="datetime-edit-field">
          <span className="datetime-edit-label">
            <EnvironmentOutlined /> 地点
          </span>
          <Input
            value={values.location}
            placeholder="厦门市·厦门华澄制药有限公司"
            maxLength={40}
            status={errors.location ? "error" : undefined}
            onChange={(e) => setField("location", e.target.value)}
            onPressEnter={handleOk}
            suffix={
              <Tooltip title={locating ? "正在定位…" : "获取当前位置"}>
                <AimOutlined
                  className={`datetime-locate-icon${locating ? " locating" : ""}`}
                  onClick={locate}
                />
              </Tooltip>
            }
          />
          {errors.location && (
            <span className="datetime-edit-error">{errors.location}</span>
          )}
        </label>
      </div>
    </Modal>
  );
}

/** 地理信息水印编辑弹窗 */
function GeoInfoEditModal({
  open,
  initial,
  onCancel,
  onSave,
}: {
  open: boolean;
  initial: GeoInfoLogoValues;
  onCancel: () => void;
  onSave: (values: GeoInfoLogoValues) => void;
}) {
  const [values, setValues] = useState<GeoInfoLogoValues>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof GeoInfoLogoValues, string>>>({});
  const [locating, setLocating] = useState(false);
  const { message } = App.useApp();

  useLayoutEffect(() => {
    if (open) {
      setValues(initial);
      setErrors({});
    }
  }, [open, initial]);

  const setField = (field: keyof GeoInfoLogoValues, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  const setTimeMode = (mode: "fixed" | "range") => {
    setValues((prev) => ({ ...prev, timeMode: mode }));
    setErrors((prev) => (prev.time ? { ...prev, time: undefined } : prev));
  };

  const setDateMode = (mode: "fixed" | "sequence") => {
    setValues((prev) => ({ ...prev, dateMode: mode }));
    setErrors((prev) => (prev.date ? { ...prev, date: undefined } : prev));
  };

  /** 浏览器定位：获取当前经纬度，分别填入经度、纬度，并把原始坐标同步到地点 */
  const locate = () => {
    if (!navigator.geolocation) {
      message.warning("当前环境不支持定位");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setField("longitude", longitude.toFixed(6));
        setField("latitude", latitude.toFixed(6));
        setField("location", `${longitude.toFixed(6)}, ${latitude.toFixed(6)}`);
        setLocating(false);
        message.success("已获取当前位置");
      },
      (err) => {
        setLocating(false);
        switch (err.code) {
          case err.PERMISSION_DENIED:
            message.warning("定位权限被拒绝，请在浏览器设置中允许后重试");
            break;
          case err.POSITION_UNAVAILABLE:
            message.warning("暂时无法获取位置信号");
            break;
          case err.TIMEOUT:
            message.warning("定位超时，请重试");
            break;
          default:
            message.warning("定位失败，请重试");
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  const handleOk = () => {
    const errs = validateGeoInfoValues(values);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    onSave(values);
  };

  const suffixLocate = (
    <Tooltip title={locating ? "正在定位…" : "获取当前位置"}>
      <AimOutlined
        className={`datetime-locate-icon${locating ? " locating" : ""}`}
        onClick={locate}
      />
    </Tooltip>
  );

  return (
    <Modal
      className="datetime-edit-modal"
      title={
        <div className="datetime-edit-header">
          <span className="datetime-edit-header-icon">
            <EnvironmentOutlined />
          </span>
          <span className="datetime-edit-header-text">
            <span className="datetime-edit-title">编辑地理信息水印</span>
            <span className="datetime-edit-subtitle">双击水印可随时再次编辑</span>
          </span>
        </div>
      }
      open={open}
      onCancel={onCancel}
      onOk={handleOk}
      okText="保存"
      cancelText="取消"
      forceRender
      width={760}
    >
      <div className="datetime-edit-form">
        <div className="datetime-locate-bar">
          <Button
            size="small"
            icon={<AimOutlined />}
            loading={locating}
            onClick={locate}
            className="datetime-locate-btn"
          >
            {locating ? "正在定位…" : "一键定位"}
          </Button>
          <span className="datetime-locate-tip">
            获取当前位置，自动填入经度、纬度、地点
          </span>
        </div>
        <div className="datetime-edit-field">
          <span className="datetime-edit-label">
            <CalendarOutlined /> 日期
          </span>
          <div className="datetime-mode-toggle">
            <button
              type="button"
              className={`datetime-mode-btn ${values.dateMode !== "sequence" ? "active" : ""}`}
              onClick={() => setDateMode("fixed")}
            >
              固定日期
            </button>
            <button
              type="button"
              className={`datetime-mode-btn ${values.dateMode === "sequence" ? "active" : ""}`}
              onClick={() => setDateMode("sequence")}
            >
              起始日期递增
            </button>
          </div>
          {values.dateMode === "sequence" ? (
            <DateSelect
              value={values.dateStart}
              status={errors.date ? "error" : undefined}
              onChange={(v) => setField("dateStart", v)}
            />
          ) : (
            <DateSelect
              value={values.date}
              status={errors.date ? "error" : undefined}
              onChange={(v) => setField("date", v)}
            />
          )}
          {errors.date && <span className="datetime-edit-error">{errors.date}</span>}
          {values.dateMode === "sequence" && !errors.date && (
            <span className="datetime-edit-hint">
              批量添加照片后，第 1 张 = 起始日期，此后每张每天 +1
            </span>
          )}
        </div>
        <div className="datetime-edit-field">
          <span className="datetime-edit-label">
            <ClockCircleOutlined /> 时间
          </span>
          <div className="datetime-mode-toggle">
            <button
              type="button"
              className={`datetime-mode-btn ${values.timeMode !== "range" ? "active" : ""}`}
              onClick={() => setTimeMode("fixed")}
            >
              固定时间
            </button>
            <button
              type="button"
              className={`datetime-mode-btn ${values.timeMode === "range" ? "active" : ""}`}
              onClick={() => setTimeMode("range")}
            >
              区间随机
            </button>
          </div>
          {values.timeMode === "range" ? (
            <div className="datetime-range-inputs">
              <TimeSelect
                value={values.timeStart}
                status={errors.time ? "error" : undefined}
                onChange={(v) => setField("timeStart", v)}
              />
              <span className="datetime-to">至</span>
              <TimeSelect
                value={values.timeEnd}
                status={errors.time ? "error" : undefined}
                onChange={(v) => setField("timeEnd", v)}
              />
            </div>
          ) : (
            <TimeSelect
              value={values.time}
              status={errors.time ? "error" : undefined}
              onChange={(v) => setField("time", v)}
            />
          )}
          {errors.time && <span className="datetime-edit-error">{errors.time}</span>}
          {values.timeMode === "range" && !errors.time && (
            <span className="datetime-edit-hint">
              每张图片将随机生成区间内的一个时间
            </span>
          )}
        </div>
        <label className="datetime-edit-field">
          <span className="datetime-edit-label">
            <EnvironmentOutlined /> 经度
          </span>
          <Input
            value={values.longitude}
            placeholder="118.1598"
            suffix="°E"
            status={errors.longitude ? "error" : undefined}
            onChange={(e) => setField("longitude", e.target.value)}
            onPressEnter={handleOk}
          />
          {errors.longitude && <span className="datetime-edit-error">{errors.longitude}</span>}
        </label>
        <label className="datetime-edit-field">
          <span className="datetime-edit-label">
            <EnvironmentOutlined /> 纬度
          </span>
          <Input
            value={values.latitude}
            placeholder="24.5270"
            suffix="°N"
            status={errors.latitude ? "error" : undefined}
            onChange={(e) => setField("latitude", e.target.value)}
            onPressEnter={handleOk}
          />
          {errors.latitude && <span className="datetime-edit-error">{errors.latitude}</span>}
        </label>
        <label className="datetime-edit-field">
          <span className="datetime-edit-label">
            <EnvironmentOutlined /> 地点
          </span>
          <Input
            value={values.location}
            placeholder="厦门市·万寿路"
            maxLength={40}
            status={errors.location ? "error" : undefined}
            onChange={(e) => setField("location", e.target.value)}
            onPressEnter={handleOk}
            suffix={suffixLocate}
          />
          {errors.location && <span className="datetime-edit-error">{errors.location}</span>}
        </label>
        <label className="datetime-edit-field">
          <span className="datetime-edit-label">
            <EditOutlined /> 备注
          </span>
          <Input
            value={values.remark ?? ""}
            placeholder="选填：如「公司团建 · 厦门」等补充说明，留空则不显示该行"
            maxLength={60}
            showCount={false}
            onChange={(e) => setField("remark", e.target.value)}
            onPressEnter={handleOk}
          />
          <span className="datetime-edit-hint">备注会显示在信息卡最底部，用于批量照片补充说明</span>
        </label>
      </div>
    </Modal>
  );
}

interface WatermarkOverlayProps {
  preset: WatermarkPreset;
  zoom: number;
  position: WatermarkPosition;
  onPositionChange: (pos: WatermarkPosition) => void;
  /** 水印大小倍率（百分比） */
  scale: number;
  /** 当前水印方向（横屏 / 竖屏）：LOGO 右侧文字字间距按方向取值 */
  orientation: WatermarkOrientation;
  onRemove: () => void;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  imgRef: React.RefObject<HTMLImageElement | null>;
  onWatermarkDatetimeChange?: (values: DatetimeLogoValues) => void;
  onWatermarkGeoInfoChange?: (values: GeoInfoLogoValues) => void;
  /** 当前图片 ID（区间随机时间的水印种子） */
  seed?: string;
  /** 图片序号（0 起）：日期顺序递增模式按此计算 */
  dateIndex?: number;
  /** 交互（按下/点击）时触发，用于标记当前活跃水印（控制滑块与状态栏） */
  onFocus?: () => void;
  /** 合成预览模式：底图已含真实水印，编辑层为纯透明交互层（任何状态都不渲染视觉） */
  synthetic?: boolean;
  /** 交互（按下/拖拽/松开）状态变化，用于合成预览时缩短重绘防抖（拖动实时跟随） */
  onInteractingChange?: (v: boolean) => void;
  /** 进入"跟手窗口"（显示水印 DOM、隐藏合成图）；不改变 interacting，合成防抖照常运行。
      用于键盘微调等非指针交互：按一下立即看到水印移动，停止后自动合成回成品图 */
  onComposeWindow?: (v: boolean) => void;
}

/** 可拖拽的水印叠加层：与图片同层，测量图片实际显示区域后按百分比定位 */
function WatermarkOverlay({
  preset,
  zoom,
  position,
  onPositionChange,
  scale,
  orientation,
  onRemove,
  canvasRef,
  imgRef,
  onWatermarkDatetimeChange,
  onWatermarkGeoInfoChange,
  seed,
  dateIndex = 0,
  onFocus,
  synthetic,
  onInteractingChange,
  onComposeWindow,
}: WatermarkOverlayProps) {
  const { text, color, fontSize, opacity } = getWatermarkStyle(preset);
  const src = typeof preset.config?.src === "string" ? preset.config.src : "";
  const imgWidth = typeof preset.config?.width === "number" ? preset.config.width : 120;
  // 图片透明度与文字透明度分开控制：logoOpacity（图片专属）→ 缺省沿用 opacity
  const imgOpacity =
    typeof preset.config?.logoOpacity === "number" ? preset.config.logoOpacity : opacity;
  const isDatetime = preset.config?.variant === "datetime";
  const isGeoInfo = preset.config?.variant === "geo-info";
  /** datetime / 地理信息 LOGO 都以 transform: scale(factor) 放大预览 DOM，
   *  与导出 canvas（字号 × factor）等比一致，否则操作按钮会钉在“小预览卡”
   *  的右上角，视觉上落在放大后的水印中部 */
  const scaleLogo = isDatetime || isGeoInfo;
  /** 地理信息水印整体透明度（0~1，1 全不透明） */
  const geoOpacity =
    typeof preset.config?.opacity === "number" ? preset.config.opacity : 1;
  /** LOGO 图片右侧的文字说明（如「水印相机」） */
  const caption = typeof preset.config?.caption === "string" ? preset.config.caption : "";
  const captionFontSize =
    typeof preset.config?.captionFontSize === "number" ? preset.config.captionFontSize : 28;
  const captionFontWeight =
    typeof preset.config?.captionFontWeight === "string" ||
    typeof preset.config?.captionFontWeight === "number"
      ? preset.config.captionFontWeight
      : "normal";
  /** 右侧文字（如「水印相机」）字间距：按方向取值（竖屏可单独配），与导出共用同一解析函数 */
  const captionLetterSpacing = resolveCaptionLetterSpacing(preset, orientation);
  const captionStrokeWidth =
    typeof preset.config?.captionStrokeWidth === "number" ? preset.config.captionStrokeWidth : 0;
  const captionStrokeColor =
    typeof preset.config?.captionStrokeColor === "string" ? preset.config.captionStrokeColor : "#000";
  /** LOGO 与右侧文字的间距（按预设可配置，缺省用全局常量） */
  const captionGap =
    typeof preset.config?.captionGap === "number" ? preset.config.captionGap : LOGO_CAPTION_GAP;
  /** 文字垂直偏移（按预设可配置，缺省用全局常量） */
  const captionDy =
    typeof preset.config?.captionDy === "number" ? preset.config.captionDy : LOGO_CAPTION_DY;
  /** 图片自身偏移（按预设可配置，缺省用全局常量） */
  const imgDx = typeof preset.config?.imgDx === "number" ? preset.config.imgDx : LOGO_IMG_DX;
  const imgDy = typeof preset.config?.imgDy === "number" ? preset.config.imgDy : LOGO_IMG_DY;
  const cfg = (preset.config ?? {}) as Partial<DatetimeLogoValues>;
  const geoCfg = (preset.config ?? {}) as Partial<GeoInfoLogoValues>;
  /** 最终显示的时间/日期/星期：时间区间按图片 ID 随机，日期顺序模式按图片序号递增 */
  const displayTime = resolveDatetimeTime(cfg, seed);
  const displayDate = resolveDatetimeDate(cfg, dateIndex);
  const displayWeek = resolveDatetimeWeek(cfg, dateIndex);
  /** 地理信息水印「时间」行（含日期与时刻）：批量时日期逐日 +1，时刻固定或按图片随机 */
  const geoTimeText = resolveGeoInfoTimeText(geoCfg, dateIndex, seed);
  const overlayRef = useRef<HTMLDivElement>(null);
  /** 水印内容容器（datetime 用 transform scale，需按视觉尺寸计算拖拽边界） */
  const contentRef = useRef<HTMLDivElement>(null);
  /** 图片 LOGO 右侧说明文字的 span（用于实测文字宽/高，把操作按钮钉在“图片+文字”整体右上角） */
  const captionRef = useRef<HTMLSpanElement | null>(null);
  /** 实测到的文字渲染尺寸（宽 + 相对内容盒顶部的可视顶边）；无 caption 时为 null */
  const [captionExtent, setCaptionExtent] = useState<{ w: number; top: number } | null>(
    null
  );
  /** 拖拽期间的跟手位置：直写 DOM 实时跟随（零 React 渲染），松手时一次性提交父组件 */
  const dragPosRef = useRef<WatermarkPosition | null>(null);
  const dragRef = useRef<{
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    bounds: { minX: number; maxX: number; minY: number; maxY: number };
    baseLeft: number;
    baseTop: number;
    baseWidth: number;
    baseHeight: number;
  } | null>(null);
  /** 自实现双击检测（时间地点 LOGO 双击打开编辑弹窗） */
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null);
  /**
   * pointerdown 记录：按下时不立即启动拖拽，移动超过阈值才进入拖拽，
   * 彻底隔离单击 / 双击（打开弹窗）/ 拖拽三种交互
   */
  const downRef = useRef<{ x: number; y: number; t: number; started: boolean } | null>(
    null
  );

  /** 时间地点编辑弹窗 */
  const [editOpen, setEditOpen] = useState(false);
  const [editInit, setEditInit] = useState<DatetimeLogoValues>(() => defaultDatetimeValues());
  /** 地理信息编辑弹窗 */
  const [geoEditOpen, setGeoEditOpen] = useState(false);
  const [geoEditInit, setGeoEditInit] = useState<GeoInfoLogoValues>(() => defaultGeoInfoValues());
  /** 编辑/删除按钮悬停桥接：鼠标离开水印进入按钮热区时保持按钮可见（否则永远点不到） */
  const [actionsHover, setActionsHover] = useState(false);
  /** 打开编辑弹窗那一刻的默认值（保存时据此判断哪些字段等于默认值、无需固化） */
  const editDefaultRef = useRef(defaultDatetimeValues());
  const geoEditDefaultRef = useRef(defaultGeoInfoValues());

  const openEdit = () => {
    if (!isDatetime && !isGeoInfo) return;
    // 清理所有待定拖拽 / 双击状态，避免与弹窗交互串扰
    downRef.current = null;
    dragRef.current = null;
    dragPosRef.current = null;
    lastTapRef.current = null;
    const c = preset.config ?? {};

    if (isDatetime) {
      const def = defaultDatetimeValues();
      editDefaultRef.current = def;
      setEditInit({
        time: typeof c.time === "string" ? c.time : def.time,
        date: typeof c.date === "string" ? c.date : def.date,
        week: typeof c.week === "string" ? c.week : def.week,
        location: typeof c.location === "string" ? c.location : def.location,
        timeMode: c.timeMode === "range" ? "range" : "fixed",
        timeStart: typeof c.timeStart === "string" ? c.timeStart : "06:00",
        timeEnd: typeof c.timeEnd === "string" ? c.timeEnd : "06:10",
        dateMode: c.dateMode === "sequence" ? "sequence" : "fixed",
        dateStart: typeof c.dateStart === "string" ? c.dateStart : "2026-05-01",
      });
      setEditOpen(true);
      return;
    }

    if (isGeoInfo) {
      const def = defaultGeoInfoValues();
      geoEditDefaultRef.current = def;
      // 旧版兼容：早前「时间」存的是「日期 时刻」整串（如 2026.08.31 10:16），
      // 打开编辑时自动拆成独立的 date / time，避免升级后内容错乱
      const legacy = parseGeoInfoCombinedTime(
        typeof c.time === "string" ? c.time : undefined
      );
      const rawTime = typeof c.time === "string" ? c.time.trim() : "";
      const time =
        /^\d{1,2}:\d{1,2}$/.test(rawTime) ? rawTime : (legacy?.time ?? def.time);
      const date =
        typeof c.date === "string" && c.date.trim()
          ? c.date.trim()
          : (legacy?.date ?? def.date);
      setGeoEditInit({
        time,
        date,
        longitude: typeof c.longitude === "string" ? c.longitude : def.longitude,
        latitude: typeof c.latitude === "string" ? c.latitude : def.latitude,
        location: typeof c.location === "string" ? c.location : def.location,
        timeMode: c.timeMode === "range" ? "range" : "fixed",
        timeStart: typeof c.timeStart === "string" ? c.timeStart : "06:00",
        timeEnd: typeof c.timeEnd === "string" ? c.timeEnd : "06:10",
        dateMode: c.dateMode === "sequence" ? "sequence" : "fixed",
        dateStart: typeof c.dateStart === "string" ? c.dateStart : "2026-05-01",
        remark: typeof c.remark === "string" ? c.remark : "",
      });
      setGeoEditOpen(true);
    }
  };

  const handleEditSave = (values: DatetimeLogoValues) => {
    setEditOpen(false);
    // 等于默认值的字段不固化：日期/星期/时间默认跟随今天/当前时间，
    // 只有用户真正修改过的字段才持久化（否则双击弹窗点确定会把默认值固化，日期永远停在当天）
    const def = editDefaultRef.current;
    const cleaned: Record<string, unknown> = { ...values };
    if (values.timeMode !== "range" && cleaned.time === def.time) delete cleaned.time;
    if (values.timeMode !== "range") delete cleaned.timeMode; // fixed 是默认模式，无需记录
    if (values.dateMode === "sequence") {
      // 顺序模式下日期/星期自动按图片序号生成，不固化固定值
      delete cleaned.date;
      delete cleaned.week;
    } else {
      if (cleaned.date === def.date) delete cleaned.date;
      if (cleaned.week === def.week) delete cleaned.week;
      delete cleaned.dateMode; // fixed 是默认模式，无需记录
      delete cleaned.dateStart; // fixed 模式无需记录起始日期
    }
    onWatermarkDatetimeChange?.(cleaned as unknown as DatetimeLogoValues);
  };

  const handleGeoEditSave = (values: GeoInfoLogoValues) => {
    setGeoEditOpen(false);
    // 只固化真正改动过的字段：日期/时间固定且等于默认（跟随今天/当前时刻）时不记录，
    // 备注留空不记录；区间随机 / 起始日期递增则记录对应模式与参数
    const def = geoEditDefaultRef.current;
    const cleaned: Record<string, unknown> = {};
    if (values.longitude !== def.longitude) cleaned.longitude = values.longitude;
    if (values.latitude !== def.latitude) cleaned.latitude = values.latitude;
    if (values.location !== def.location) cleaned.location = values.location;
    if (values.remark) cleaned.remark = values.remark.trim();
    if (values.timeMode === "range") {
      cleaned.timeMode = "range";
      cleaned.timeStart = values.timeStart;
      cleaned.timeEnd = values.timeEnd;
    } else if (values.time !== def.time) {
      cleaned.time = values.time;
    }
    if (values.dateMode === "sequence") {
      cleaned.dateMode = "sequence";
      cleaned.dateStart = values.dateStart;
    } else if (values.date !== def.date) {
      cleaned.date = values.date;
    }
    onWatermarkGeoInfoChange?.(cleaned as unknown as GeoInfoLogoValues);
  };

  /** 图片相对画布的视觉矩形（含 transform 缩放后的实际显示区域） */
  const [rect, setRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  /** rect 的 ref 副本：拖拽期间不触发 React 渲染，直接读取最新测量值 */
  const rectRef = useRef(rect);
  rectRef.current = rect;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const update = () => {
      const c = canvas.getBoundingClientRect();
      const r = img.getBoundingClientRect();
      let left = r.left - c.left;
      let top = r.top - c.top;
      let width = r.width;
      let height = r.height;
      // object-fit: contain 时 img 盒子内可能有留白（图片比例与盒子比例不一致时），
      // 修正为图片实际显示区域，保证水印百分比与导出（基于真实像素）一致
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      if (nw > 0 && nh > 0) {
        const imgRatio = nw / nh;
        const boxRatio = r.width / r.height;
        if (imgRatio > boxRatio) {
          // 图片更宽：上下留白
          height = r.width / imgRatio;
          top += (r.height - height) / 2;
        } else if (imgRatio < boxRatio) {
          // 图片更高：左右留白
          width = r.height * imgRatio;
          left += (r.width - width) / 2;
        }
      }
      setRect({ left, top, width, height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(canvas);
    ro.observe(img);
    /** 缩放动画（transition: transform 0.15s）结束后校正一次 */
    const onTransitionEnd = (e: TransitionEvent) => {
      if (e.propertyName === "transform") update();
    };
    img.addEventListener("transitionend", onTransitionEnd);
    return () => {
      ro.disconnect();
      img.removeEventListener("transitionend", onTransitionEnd);
    };
  }, [zoom, canvasRef, imgRef]);

  /** 跟手位置：拖拽中取直写 DOM 前的暂存值（防意外重渲染跳位）；其余用受控位置 */
  const effectivePos = dragPosRef.current ?? position;
  const style: CSSProperties = rect
    ? {
        position: "absolute",
        left: rect.left + (rect.width * effectivePos.x) / 100,
        top: rect.top + (rect.height * effectivePos.y) / 100,
        transform: "translate(-50%, -50%)",
      }
    : { display: "none" };

  // 水印比例系数：图片显示宽 / 参考宽 × 倍率（与导出 canvas 的算法一致）
  const factor = ((rect?.width ?? WATERMARK_REF_WIDTH) / WATERMARK_REF_WIDTH) * (scale / 100);

  /** 水印视觉矩形：datetime / 地理信息 LOGO 用 transform 缩放，取内容视觉尺寸；其余取 overlay 自身 */
  const visualRect = () => {
    const content = contentRef.current;
    return content && scaleLogo
      ? content.getBoundingClientRect()
      : overlayRef.current!.getBoundingClientRect();
  };

  // 图片 LOGO 的说明文字是绝对定位（越出内容盒），内容盒宽度只有图片本身；
  // 这里实测文字真实渲染宽高，供操作按钮对齐“图片+文字”整体的右上角。
  // offsetTop 不含 translateY(-50%)，可视顶边需再减去自身高度的一半。
  useLayoutEffect(() => {
    const el = captionRef.current;
    if (!el) {
      setCaptionExtent(null);
      return;
    }
    const top = el.offsetTop - el.offsetHeight / 2;
    const w = el.offsetWidth;
    setCaptionExtent((prev) =>
      prev && prev.w === w && prev.top === top ? prev : { w, top }
    );
  }, [caption, captionFontSize, captionFontWeight, captionLetterSpacing, factor]);

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const img = imgRef.current;
    const overlay = overlayRef.current;
    if (!img || !overlay) return;
    // 弹窗打开期间不处理水印交互（mask 已遮挡，双保险）
    if (editOpen || geoEditOpen) return;

    // 标记为当前活跃水印（大小滑块与状态栏跟随它）
    onFocus?.();

    // 仅记录按下位置与时间，不立即启动拖拽（延迟启动，避免与双击冲突）
    downRef.current = { x: e.clientX, y: e.clientY, t: Date.now(), started: false };

    if (isDatetime || isGeoInfo) {
      const last = lastTapRef.current;
      const dist =
        last === null ? Infinity : Math.hypot(e.clientX - last.x, e.clientY - last.y);
      lastTapRef.current = { t: downRef.current.t, x: e.clientX, y: e.clientY };
      if (last !== null && downRef.current.t - last.t < 350 && dist < 6) {
        lastTapRef.current = null;
        openEdit();
        return;
      }
    }
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const down = downRef.current;
    const img = imgRef.current;
    const overlay = overlayRef.current;
    if (!down || !img || !overlay) return;

    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;

    // 未超过拖拽阈值：视为单击 / 双击，不启动拖拽
    if (!down.started) {
      if (Math.hypot(dx, dy) < 3) return;
      down.started = true;
      overlay.setPointerCapture(e.pointerId);
      // 进入"跟手窗口"：显示水印 DOM 实时跟随（单击/双击不经过这里，完全无感）
      onInteractingChange?.(true);
      // 百分比基准统一为图片实际显示区域（rect），与 overlay 定位、导出一致；
      // 把基准矩形缓存在 dragRef：move 阶段不再做任何 getBoundingClientRect 等
      // 布局读取，纯数值换算 + 一次 style 写，避免拖动时触发同步布局抖动。
      const base = rectRef.current ?? img.getBoundingClientRect();
      dragRef.current = {
        startClientX: down.x,
        startClientY: down.y,
        startX: position.x,
        startY: position.y,
        bounds: getBounds(base, visualRect()),
        baseLeft: base.left,
        baseTop: base.top,
        baseWidth: base.width,
        baseHeight: base.height,
      };
      return;
    }

    const drag = dragRef.current;
    if (!drag) return;
    const { baseLeft, baseTop, baseWidth, baseHeight } = drag;
    const dxPct = ((e.clientX - drag.startClientX) / baseWidth) * 100;
    const dyPct = ((e.clientY - drag.startClientY) / baseHeight) * 100;
    const next = {
      x: clampTo(drag.startX + dxPct, drag.bounds.minX, drag.bounds.maxX),
      y: clampTo(drag.startY + dyPct, drag.bounds.minY, drag.bounds.maxY),
    };
    // 拖拽全程零 React 渲染：位置直写 DOM 实时跟手（60fps 无卡顿），
    // 暂存 ref，松手时一次性提交父组件（整场拖拽只触发一次最终合成）
    dragPosRef.current = next;
    overlay.style.left = `${baseLeft + (baseWidth * next.x) / 100}px`;
    overlay.style.top = `${baseTop + (baseHeight * next.y) / 100}px`;
  };

  const handlePointerUp = () => {
    // 拖拽结束：把跟手位置一次性提交（未真正拖拽过则无值，单击不会误触发合成）
    if (dragPosRef.current) {
      onPositionChange(dragPosRef.current);
    }
    downRef.current = null;
    dragRef.current = null;
    dragPosRef.current = null;
    onInteractingChange?.(false);
  };

  /** 键盘方向键微调（Shift 加速） */
  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // 编辑弹窗打开期间不响应（焦点可能停留在水印 overlay 上，避免影响弹窗内键盘操作）
    if (editOpen) return;
    // 仅当焦点就在水印 overlay 本体时响应；焦点在子元素（如编辑/删除按钮）上时忽略，
    // 避免弹窗关闭后焦点回到 overlay、或点击按钮后按方向键误触微调
    if (e.target !== e.currentTarget) return;
    const img = imgRef.current;
    const overlay = overlayRef.current;
    if (!img || !overlay) return;
    const stepPx = e.shiftKey ? 10 : 1;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-stepPx, 0],
      ArrowRight: [stepPx, 0],
      ArrowUp: [0, -stepPx],
      ArrowDown: [0, stepPx],
    };
    const [dx, dy] = delta[e.key] ?? [0, 0];
    if (dx === 0 && dy === 0) return;
    e.preventDefault();
    // 进入"跟手窗口"：立即显示水印 DOM（按一下就动，零延迟），
    // 停止按键后由合成 effect 的防抖（120ms）自动合成回成品图
    onComposeWindow?.(true);
    const base = rectRef.current ?? img.getBoundingClientRect();
    const bounds = getBounds(base, visualRect());
    onPositionChange({
      x: clampTo(position.x + (dx / base.width) * 100, bounds.minX, bounds.maxX),
      y: clampTo(position.y + (dy / base.height) * 100, bounds.minY, bounds.maxY),
    });
  };

  return (
    <div
      ref={overlayRef}
      className={`preview-watermark ${
        isDatetime || preset.type === "image" ? "preview-watermark-plain" : ""
      } ${synthetic ? "wm-synthetic" : ""} ${actionsHover ? "wm-actions-visible" : ""}`}
      style={style}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => setActionsHover(true)}
      onMouseLeave={() => setActionsHover(false)}
      title={
        isDatetime
          ? "拖拽移动水印 · 双击或点 ✏️ 编辑时间/日期/星期/地点"
          : "拖拽移动水印 · 方向键微调（Shift 加速）"
      }
    >
      <div
        ref={contentRef}
        className="watermark-content"
        style={
          {
            position: "relative",
            // 水印本体模糊（与合成管线同一常量、同一缩放，所见即所得）；
            // 图片 LOGO 与文字/日期 LOGO 使用各自独立的模糊值；图片水印可用 config.blur 单独覆盖
            "--wm-blur": `${
              (preset.type === "image"
                ? typeof preset.config?.blur === "number"
                  ? preset.config.blur
                  : WATERMARK_BLUR_PX_LOGO
                : WATERMARK_BLUR_PX_TEXT) * factor
            }px`,
            ...(scaleLogo
              ? { transform: `scale(${factor})`, transformOrigin: "center" }
              : null),
          } as CSSProperties
        }
      >
        {isDatetime ? (
          <DatetimeLogo
            time={displayTime}
            date={displayDate}
            week={displayWeek}
            location={cfg.location}
          />
        ) : isGeoInfo ? (
          <GeoInfoLogo
            time={geoTimeText}
            longitude={geoCfg.longitude}
            latitude={geoCfg.latitude}
            location={geoCfg.location}
            remark={geoCfg.remark}
            opacity={geoOpacity}
          />
        ) : preset.type === "image" && src ? (
          /* 锚点 = 图片中心（与导出的 drawImage cx/cy 一致）；文字绝对定位挂在图片右侧 */
          <div
            className="watermark-logo-block"
            style={{
              position: "relative",
              display: "inline-flex",
              alignItems: "center",
              whiteSpace: "nowrap",
            }}
          >
            <img
              src={src}
              alt={preset.name}
              className="watermark-img"
              draggable={false}
              style={{
                width: imgWidth * factor,
                opacity: imgOpacity,
                display: "block",
                // 图片偏移按预设可配置（imgDx/imgDy），缺省用全局常量 LOGO_IMG_DX/DY；
                // 预览与成品读取同一份配置，永远同步（基准像素，随水印缩放）
                transform: `translate(${imgDx * factor}px, ${imgDy * factor}px)`,
              }}
            />
            {caption && (
              <span
                ref={captionRef}
                className="watermark-logo-caption"
                style={{
                  position: "absolute",
                  // 间距按预设可配置（captionGap），缺省用全局常量 LOGO_CAPTION_GAP；
                  // 预览与成品读取同一份配置，永远同步（基准像素，随水印缩放）
                  left: `calc(100% + ${captionGap * factor}px)`,
                  top: `calc(50% + ${captionDy * factor}px)`,
                  transform: "translateY(-50%)",
                  color: "#fff",
                  fontFamily: '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
                  fontSize: captionFontSize * factor,
                  fontWeight: captionFontWeight,
                  letterSpacing: captionLetterSpacing * factor,
                  WebkitTextStroke:
                    captionStrokeWidth > 0
                      ? `${captionStrokeWidth * factor}px ${captionStrokeColor}`
                      : undefined,
                  opacity,
                  textShadow: "0 1px 1px rgba(0,0,0,0.4)",
                }}
              >
                {caption}
              </span>
            )}
          </div>
        ) : preset.type === "image" ? (
          <PictureOutlined style={{ fontSize: fontSize * factor, color, opacity }} />
        ) : (
          <span className="watermark-text" style={{ color, fontSize: fontSize * factor, opacity }}>
            {text}
          </span>
        )}
        {/* 操作按钮：放进内容容器内跟随缩放，反缩放后始终钉在视觉右上角 */}
        <div
          className="watermark-actions"
          style={
            {
              "--wm-factor": scaleLogo ? factor : 1,
              // 按钮跟随 LOGO 图片偏移（imgDx/imgDy），避免图片移动后按钮跑偏
              "--wm-actions-dx": `${
                preset.type === "image" ? imgDx * factor : 0
              }px`,
              "--wm-actions-dy": `${
                preset.type === "image" ? imgDy * factor : 0
              }px`,
              // 图片 LOGO 带右侧文字时：内容盒宽度只有图片，若按盒子右上角，
              // 按钮会落在图片右上而非“图片+文字”整体右上角；
              // 这里按实测的文字宽/顶边把按钮推到整块视觉的右上（略外扩几像素）
              ...(preset.type === "image" && src && caption && captionExtent
                ? {
                    top: `${Math.min(0, captionExtent.top) - 8}px`,
                    right: `${-(captionGap * factor + captionExtent.w + 6)}px`,
                    transform: "none",
                  }
                : {}),
            } as CSSProperties
          }
          onMouseEnter={(e) => {
            e.stopPropagation();
            setActionsHover(true);
          }}
          onMouseLeave={(e) => {
            e.stopPropagation();
            setActionsHover(false);
          }}
        >
          {(isDatetime || isGeoInfo) && (
            <button
              className="watermark-edit"
              title={isGeoInfo ? "编辑日期/时间/经纬度/地点/备注" : "编辑时间/日期/星期/地点"}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                openEdit();
              }}
            >
              <EditOutlined />
            </button>
          )}
          <button
            className="watermark-remove"
            title="删除水印"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            <CloseOutlined />
          </button>
        </div>
      </div>
      <DatetimeEditModal
        open={editOpen}
        initial={editInit}
        onCancel={() => setEditOpen(false)}
        onSave={handleEditSave}
      />
      <GeoInfoEditModal
        open={geoEditOpen}
        initial={geoEditInit}
        onCancel={() => setGeoEditOpen(false)}
        onSave={handleGeoEditSave}
      />
    </div>
  );
}

function PreviewArea({
  image,
  imageIndex = 0,
  onExport,
  exporting,
  onCropApplied,
  watermarkPresets,
  watermarkEnabled,
  watermarkPositions,
  watermarkOrientation,
  onWatermarkOrientationChange,
  onWatermarkPositionChange,
  watermarkScales,
  onWatermarkScaleChange,
  timeDigitSpacing,
  dateDigitSpacing,
  onRemoveWatermark,
  onWatermarkDatetimeChange,
  onWatermarkGeoInfoChange,
  emptyTitle,
  emptyText,
}: PreviewAreaProps) {
  const [zoom, setZoom] = useState(100);
  /** 裁剪模式：激活时预览画布进入裁剪交互（拖拽框选 / 旋转 / 翻转 / 比例） */
  const [cropActive, setCropActive] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  /** 当前图片原始像素尺寸（用于把水印百分比位置换算成像素坐标） */
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  /** 当前活跃水印 ID（大小滑块与状态栏跟随它；点选水印后切换） */
  const [activeId, setActiveId] = useState<string | null>(null);

  /**
   * 合成预览：叠加水印时，预览底图直接显示与「处理」完全一致的合成结果
   * （同一 composeWatermark 管线、同一位置/大小/种子），真正做到所见即所得，
   * 彻底消除预览与导出之间的任何像素偏差。位置/大小/水印变化后防抖 200ms 重新合成。
   */
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  /** 当前合成图对应的原图 URL（用于判断"切图"与"仅参数变化"） */
  const composedForUrlRef = useRef<string | null>(null);
  const composeSeqRef = useRef(0);
  /** 拖拽交互中：缩短合成防抖，让合成成品图实时跟随水印位置（所见即所得） */
  const [interacting, setInteracting] = useState(false);

  const applyPreviewUrl = (url: string | null) => {
    if (previewUrlRef.current && previewUrlRef.current !== url) {
      URL.revokeObjectURL(previewUrlRef.current);
    }
    previewUrlRef.current = url;
    setPreviewUrl(url);
  };

  // 合成预览：预览区永远只显示最终成品图（所见即所得），
  // 编辑层退化为透明交互层；合成失败时 previewUrl 为空、自动降级为普通编辑层。
  // 注意：拖拽进行中（interacting）强制关闭合成模式 —— 否则拖一下就要重编码一张
  // PNG，叠加多个水印 + 大图时主线程会被编码卡死。拖拽期间改由 DOM 水印跟手
  // 显示，松手后再做唯一一次最终合成。
  const syntheticPreview =
    watermarkEnabled && watermarkPresets.length > 0 && !interacting;

  useEffect(() => {
    composeSeqRef.current += 1;
    // 未开启水印：立即回到原图
    if (!image || !syntheticPreview) {
      if (previewUrlRef.current) {
        applyPreviewUrl(null);
        composedForUrlRef.current = null;
      }
      return;
    }
    // 切换图片：清空旧合成图（不同图片的合成结果无意义）
    if (image.url !== composedForUrlRef.current) {
      applyPreviewUrl(null);
      composedForUrlRef.current = image.url;
    }
    // 拖拽过程中 syntheticPreview=false 会直接走上面的清理分支返回，不会进到这里；
    // 因此到达此处的一定是"停顿后的最终合成"，统一用一次长防抖合并高频变更。
    const delay = 160;
    // 按预览区实际显示尺寸 + 设备像素比计算合成边长，而不是固定 1600：
    // 屏幕只显示几百~一千 CSS 像素，固定 1600 会让每次合成白白多做 ~2.5× 的
    // canvas + PNG 编码，大图上很容易把主线程压满造成"卡死"感。
    const el = canvasRef.current;
    const cssMax = el ? Math.max(el.clientWidth, el.clientHeight) : 1000;
    const maxDim = Math.min(
      1600,
      Math.max(640, Math.ceil(cssMax * (window.devicePixelRatio || 1))),
    );
    const seq = composeSeqRef.current;
    const timer = setTimeout(async () => {
      try {
        // 预览合成同样从降采样大图起步：视觉与导出一致（百分比定位、同比例），
        // 但解码/绘制成本显著低于全尺寸原图，避免大图上反复合成造成卡死
        let url = image.displayUrl ?? image.url;
        let composed = false;
        // 与 handleProcess 相同的链式合成（多水印按选中顺序叠加）
        for (const preset of watermarkPresets) {
          const result = await composeWatermark(
            { ...image, url, size: 0 },
            preset,
            {
              position: resolveWatermarkPosition(
                preset,
                watermarkOrientation,
                watermarkPositions
              ),
              seed: image.id,
              dateIndex: imageIndex,
              scale: resolveWatermarkScale(preset, watermarkOrientation, watermarkScales),
              timeDigitSpacing,
              dateDigitSpacing,
              orientation: watermarkOrientation,
              // 预览用无损 PNG：颜色与原图逐像素一致（无二次压缩）；
              // 位置/大小是百分比，与全尺寸导出一致（所见即所得）
              format: "png",
              maxDim,
            }
          );
          if (seq !== composeSeqRef.current) {
            // 已被更新的合成取代，丢弃本次结果
            URL.revokeObjectURL(result.url);
            return;
          }
          if (composed) URL.revokeObjectURL(url);
          composed = true;
          url = result.url;
        }
        if (seq !== composeSeqRef.current) {
          URL.revokeObjectURL(url);
          return;
        }
        applyPreviewUrl(url);
      } catch {
        // 合成失败：保留原图预览，编辑层仍可操作
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [image, syntheticPreview, watermarkPresets, watermarkPositions, watermarkOrientation, watermarkScales, timeDigitSpacing, dateDigitSpacing, interacting]);

  // 卸载时释放合成结果
  useEffect(
    () => () => {
      composeSeqRef.current += 1;
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    },
    []
  );

  /** 活跃水印：找不到时回退到第一个选中预设 */
  const activePreset =
    watermarkPresets.find((p) => p.id === activeId) ?? watermarkPresets[0] ?? null;
  const activePosition = activePreset
    ? resolveWatermarkPosition(activePreset, watermarkOrientation, watermarkPositions)
    : null;

  const handleOpenCrop = () => {
    if (!image) return;
    setCropActive(true);
  };
  const handleCloseCrop = () => setCropActive(false);
  const handleCommitCrop = (result: {
    url: string;
    size: number;
    width: number;
    height: number;
  }) => {
    setCropActive(false);
    onCropApplied?.(result);
  };

  return (
    <main className="preview-area">
      <div className="preview-toolbar">
        <span className="preview-name" title={image?.name}>
          {image ? image.name : "未选择图片"}
        </span>
        <div className="preview-actions">
          {watermarkEnabled && !cropActive && activePreset && (
            <div className="watermark-orientation-control">
              <span className="watermark-size-label">水印方向</span>
              <Segmented<WatermarkOrientation>
                size="small"
                value={watermarkOrientation}
                options={[
                  { label: "横屏", value: "landscape" },
                  { label: "竖屏", value: "portrait" },
                ]}
                onChange={(v) => onWatermarkOrientationChange(v)}
              />
            </div>
          )}
          {watermarkEnabled && !cropActive && activePreset && (
            <div className="watermark-size-control">
              <span className="watermark-size-label" title={activePreset.name}>
                {watermarkPresets.length > 1 ? `${activePreset.name} 大小` : "水印大小"}
              </span>
              <Slider
                min={25}
                max={400}
                step={5}
                value={resolveWatermarkScale(
                  activePreset,
                  watermarkOrientation,
                  watermarkScales
                )}
                onChange={(v) =>
                  onWatermarkScaleChange(activePreset.id, watermarkOrientation, v)
                }
                tooltip={{ formatter: (v) => (v == null ? null : `${v}%`) }}
                style={{ width: 110 }}
              />
            </div>
          )}
          <Tooltip title={cropActive ? "退出裁剪（不保存）" : "裁剪图片"}>
            <Button
              size="small"
              type={cropActive ? "primary" : "text"}
              icon={<ScissorOutlined />}
              disabled={!image}
              onClick={cropActive ? handleCloseCrop : handleOpenCrop}
            >
              裁剪
            </Button>
          </Tooltip>
          <Tooltip title="缩小">
            <Button
              size="small"
              type="text"
              icon={<ZoomOutOutlined />}
              onClick={() => setZoom((z) => Math.max(10, z - 10))}
            />
          </Tooltip>
          <span className="zoom-value">{zoom}%</span>
          <Tooltip title="放大">
            <Button
              size="small"
              type="text"
              icon={<ZoomInOutlined />}
              onClick={() => setZoom((z) => Math.min(300, z + 10))}
            />
          </Tooltip>
          <Button size="small" onClick={() => setZoom(100)}>
            1:1
          </Button>
          <Button
            size="small"
            icon={<ExportOutlined />}
            loading={exporting}
            disabled={!image || cropActive || exporting}
            onClick={onExport}
          >
            导出
          </Button>
        </div>
      </div>

      <div
        className={`preview-canvas checkerboard${cropActive ? " cropping" : ""}`}
        ref={canvasRef}
      >
        {image ? (
          cropActive ? (
            <CropView
              key={`${image.id}-${image.url}`}
              image={image}
              zoom={zoom}
              onCancel={handleCloseCrop}
              onCommit={handleCommitCrop}
            />
          ) : (
            <>
              {/* 底层：原图（始终显示，仅作为合成成品图的占位骨架）。
                优先用导入时生成的降采样大图，避免切图时反复解码全尺寸原图导致卡死 */}
            <img
              ref={imgRef}
              src={image.displayUrl ?? image.url}
              alt={image.name}
              className="wm-base"
              draggable={false}
              onLoad={(e) => {
                const el = e.currentTarget;
                // 显示层是降采样图，但尺寸统计要按原图真实像素
                const w = image.width ?? el.naturalWidth;
                const h = image.height ?? el.naturalHeight;
                if (w > 0 && h > 0) setNaturalSize({ w, h });
              }}
              style={{ transform: `scale(${zoom / 100})` }}
            />
            {/* 上层：合成成品图（与导出同一管线；与底层重叠，逐像素对齐）。
                任何状态下都保持显示 —— 预览永远就是最终成品；编辑层完全透明，只负责拖拽交互 */}
            {previewUrl && (
              <img
                src={previewUrl}
                alt=""
                className="wm-composed"
                draggable={false}
                // 缩放交给 CSS 变量 --wm-zoom 驱动，位置偏移在 App.css 的
                // --wm-composed-dx / --wm-composed-dy 调整（px）
                style={{ "--wm-zoom": zoom / 100 } as CSSProperties}
              />
            )}
            {watermarkEnabled &&
              watermarkPresets.map((preset) => (
                <WatermarkOverlay
                  key={preset.id}
                  preset={preset}
                  zoom={zoom}
                  position={resolveWatermarkPosition(
                    preset,
                    watermarkOrientation,
                    watermarkPositions
                  )}
                  onPositionChange={(pos) =>
                    onWatermarkPositionChange(preset.id, watermarkOrientation, pos)
                  }
                  scale={resolveWatermarkScale(
                    preset,
                    watermarkOrientation,
                    watermarkScales
                  )}
                  orientation={watermarkOrientation}
                  onRemove={() => onRemoveWatermark(preset.id)}
                  canvasRef={canvasRef}
                  imgRef={imgRef}
                  onWatermarkDatetimeChange={(values) =>
                    onWatermarkDatetimeChange?.(preset.id, values)
                  }
                  onWatermarkGeoInfoChange={(values) =>
                    onWatermarkGeoInfoChange?.(preset.id, values)
                  }
                  seed={image.id}
                  dateIndex={imageIndex}
                  onFocus={() => setActiveId(preset.id)}
                  synthetic={syntheticPreview}
                  onInteractingChange={(v) => {
                    // 合成预览模式：拖拽全程只显示合成成品图（所见即所得），
                    // 不进入"跟手窗口"，合成 effect 以短防抖实时重绘跟随
                    setInteracting(v);
                  }}
                  onComposeWindow={() => {
                    // 键盘微调等非指针交互：同样保持合成成品图，由合成 effect 防抖重绘
                  }}
                />
              ))}
            </>
          )
        ) : (
          <div className="preview-empty">
            <div className="preview-empty-icon">
              <PictureOutlined />
            </div>
            {emptyTitle && <div className="preview-empty-title">{emptyTitle}</div>}
            <div className="preview-empty-desc">
              {emptyText ?? "上传图片后，点击右侧缩略图在此预览"}
            </div>
          </div>
        )}
      </div>

      <div className="preview-statusbar">
        {cropActive && (
          <span className="crop-status-hint">
            拖拽 / 手柄调整选区 · Ctrl+Z 撤销 · Enter 应用 · Esc 取消
          </span>
        )}
        {!cropActive && watermarkEnabled && activePreset && activePosition && (
          <span className="watermark-pos" style={{ flex: 1 }}>
            {`已叠加 ${watermarkPresets.length} 个 · `}
            <span
              className={`watermark-pos-orient ${
                watermarkOrientation === "portrait"
                  ? "is-portrait"
                  : "is-landscape"
              }`}
            >
              {watermarkOrientation === "portrait" ? "竖屏" : "横屏"}
            </span>
            {` · ${activePreset.name} X ${Math.round(activePosition.x)}% · Y ${Math.round(activePosition.y)}%`}
            {naturalSize && (
              <span>
                {`（中心点 ${Math.round((naturalSize.w * activePosition.x) / 100)} × ${Math.round((naturalSize.h * activePosition.y) / 100)} px）`}
              </span>
            )}
            {` · 大小 ${Math.round(resolveWatermarkScale(activePreset, watermarkOrientation, watermarkScales) * 100)}%`}
            {` · ${activePreset.name}水印logo的位置`}
          </span>
        )}
        {!cropActive && (
          <span>{image ? `${image.size ? (image.size / 1024).toFixed(0) : 0} KB` : ""}</span>
        )}
      </div>
    </main>
  );
}

/** memo：EditorLayout 顶层的“无关状态”（处理进度、导入 loading 等）不再连带到本面板重渲染 */
export default memo(PreviewArea);
