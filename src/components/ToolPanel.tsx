import { memo } from "react";
import { App, Button, Empty, Tag, Tooltip } from "antd";
import {
  FontSizeOutlined,
  PictureOutlined,
  DeleteOutlined,
  EditOutlined,
  LinkOutlined,
  ScissorOutlined,
} from "@ant-design/icons";
import DatetimeLogo, {
  resolveDatetimeDate,
  resolveDatetimeTime,
  resolveDatetimeWeek,
} from "./DatetimeLogo";
import GeoInfoLogo, { resolveGeoInfoTimeText } from "./GeoInfoLogo";
import type { DatetimeLogoValues, GeoInfoLogoValues, WatermarkPreset } from "./types";

/** ToolPanel 顶部的作用范围信息 */
export interface ScopeInfo {
  /** 当前图片是否已被单独设置水印 */
  hasImagePlan: boolean;
  /** 描述当前设置作用于谁 */
  label: string;
}

interface ToolPanelProps {
  presets: WatermarkPreset[];
  selectedPresetIds: string[];
  onSelectPreset: (preset: WatermarkPreset) => void;
  onDeletePreset: (preset: WatermarkPreset) => void;
  onEditPreset: (preset: WatermarkPreset) => void;
  /** 时间地点 LOGO 编辑值覆盖（按预设 ID） */
  datetimeOverrides?: Record<string, DatetimeLogoValues>;
  /** 地理信息水印编辑值覆盖（按预设 ID） */
  geoInfoOverrides?: Record<string, GeoInfoLogoValues>;
  /** 当前水印方案作用范围提示 */
  scopeInfo?: ScopeInfo;
  /** 把当前方案独立到当前图片 */
  onMakeIndependent?: () => void;
  /** 当前图片恢复跟随全局默认方案 */
  onFollowGlobal?: () => void;
}

/** 从预设配置中取出水印文案 */
function getWatermarkText(preset: WatermarkPreset): string {
  const text = preset.config?.text;
  return typeof text === "string" && text.length > 0 ? text : preset.name;
}

/** 水印 div 预览：用 div 元素模拟叠加水印效果 */
function WatermarkPreview({
  preset,
  datetimeOverrides,
  geoInfoOverrides,
}: {
  preset: WatermarkPreset;
  datetimeOverrides?: Record<string, DatetimeLogoValues>;
  geoInfoOverrides?: Record<string, GeoInfoLogoValues>;
}) {
  const color = typeof preset.config?.color === "string" ? preset.config.color : "#ffffff";
  const fontSize =
    typeof preset.config?.fontSize === "number" ? preset.config.fontSize : 14;
  const opacity =
    typeof preset.config?.opacity === "number" ? preset.config.opacity : 0.6;
  const src = typeof preset.config?.src === "string" ? preset.config.src : "";
  const location =
    typeof preset.config?.location === "string" ? preset.config.location : undefined;
  const ov = datetimeOverrides?.[preset.id];
  const geoOv = geoInfoOverrides?.[preset.id];

  if (preset.config?.variant === "datetime") {
    // 时间区间随机用固定种子生成示例展示（不随渲染跳动）；日期顺序模式展示起始日期（第 1 张）
    const time = resolveDatetimeTime(ov ?? {}, "preview");
    const date = resolveDatetimeDate(ov ?? {}, 0);
    const week = resolveDatetimeWeek(ov ?? {}, 0);
    return (
      <div className="preset-watermark">
        <DatetimeLogo
          location={ov?.location ?? location}
          time={time}
          date={date}
          week={week}
          size="small"
        />
      </div>
    );
  }

  if (preset.config?.variant === "geo-info") {
    // 与预览/导出同一解析：日期起始递增模式显示起始日期（第 1 张），区间随机时间用固定种子展示示例
    const geoCfg: Partial<GeoInfoLogoValues> = {
      ...(preset.config as Partial<GeoInfoLogoValues>),
      ...(geoOv ?? {}),
    };
    const geoTime = resolveGeoInfoTimeText(geoOv ?? {}, 0, "preview");
    return (
      <div className="preset-watermark">
        <GeoInfoLogo
          time={geoTime}
          longitude={geoCfg.longitude}
          latitude={geoCfg.latitude}
          location={geoCfg.location}
          remark={geoCfg.remark}
          size="small"
        />
      </div>
    );
  }

  if (preset.type === "image" && src) {
    return (
      <div className="preset-watermark">
        <img src={src} alt={preset.name} className="preset-watermark-img" style={{ opacity }} />
      </div>
    );
  }

  if (preset.type === "image") {
    return (
      <div className="preset-watermark">
        <PictureOutlined style={{ fontSize: 18, opacity }} />
      </div>
    );
  }

  return (
    <div className="preset-watermark">
      <span
        className="preset-watermark-text"
        style={{ color, fontSize: Math.min(fontSize, 16), opacity }}
      >
        {getWatermarkText(preset)}
      </span>
    </div>
  );
}

function ToolPanel({
  presets,
  selectedPresetIds,
  onSelectPreset,
  onDeletePreset,
  onEditPreset,
  datetimeOverrides,
  geoInfoOverrides,
  scopeInfo,
  onMakeIndependent,
  onFollowGlobal,
}: ToolPanelProps) {
  const { modal } = App.useApp();

  const handleDeleteClick = (preset: WatermarkPreset) => {
    if (preset.builtin) {
      modal.warning({ title: "内置预设", content: "内置预设不允许删除" });
      return;
    }
    modal.confirm({
      title: "删除水印预设",
      content: `确定要删除「${preset.name}」吗？删除后不可恢复。`,
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      onOk: () => onDeletePreset(preset),
    });
  };

  return (
    <aside className="tool-panel">
      {scopeInfo && (
        <div className="scope-bar">
          <div className="scope-bar-row">
            <span
              className={`scope-bar-dot ${scopeInfo.hasImagePlan ? "is-solo" : ""}`}
              aria-hidden
            />
            <span
              className="scope-bar-title"
              title={scopeInfo.hasImagePlan ? "本图独立水印" : "全局默认水印"}
            >
              {scopeInfo.hasImagePlan ? "本图独立水印" : "全局默认水印"}
            </span>
            {scopeInfo.hasImagePlan ? (
              <Tooltip title="恢复为全局默认方案">
                <Button
                  className="scope-bar-action"
                  size="small"
                  type="text"
                  icon={<LinkOutlined />}
                  onClick={onFollowGlobal}
                />
              </Tooltip>
            ) : (
              <Tooltip title="将当前水印仅作用于本图">
                <Button
                  className="scope-bar-action"
                  size="small"
                  type="text"
                  icon={<ScissorOutlined />}
                  onClick={onMakeIndependent}
                />
              </Tooltip>
            )}
          </div>
          <div className="scope-bar-label" title={scopeInfo.label}>
            {scopeInfo.label}
          </div>
        </div>
      )}
      <div className="tool-group">
        <div className="tool-group-title">本机水印预设</div>
        <div className="tool-group-hint">可多选水印，叠加使用</div>
        {presets.length === 0 ? (
          <Empty
            className="preset-empty"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无水印预设"
          />
        ) : (
          <div className="preset-list">
            {presets.map((preset) => (
              <div
                key={preset.id}
                className={`preset-item ${selectedPresetIds.includes(preset.id) ? "active" : ""}`}
                onClick={() => onSelectPreset(preset)}
              >
                <WatermarkPreview
                  preset={preset}
                  datetimeOverrides={datetimeOverrides}
                  geoInfoOverrides={geoInfoOverrides}
                />
                <div className="preset-info">
                  <span className="preset-name" title={preset.name}>
                    {preset.name}
                  </span>
                  <div className="preset-tags">
                    {preset.type === "image" ? (
                      <PictureOutlined className="preset-type-icon" />
                    ) : (
                      <FontSizeOutlined className="preset-type-icon" />
                    )}
                    {preset.builtin && <Tag className="preset-builtin-tag">内置</Tag>}
                  </div>
                </div>
                {!preset.builtin && (
                  <div
                    className="preset-actions"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Tooltip title="修改">
                      <Button
                        size="small"
                        type="text"
                        icon={<EditOutlined />}
                        onClick={() => onEditPreset(preset)}
                      />
                    </Tooltip>
                    <Tooltip title="删除">
                      <Button
                        size="small"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => handleDeleteClick(preset)}
                      />
                    </Tooltip>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

export default memo(ToolPanel);
