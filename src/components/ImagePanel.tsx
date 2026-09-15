import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button, Popconfirm, Tooltip } from "antd";
import {
  PlusOutlined,
  DeleteOutlined,
  ExportOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  HourglassOutlined,
  PictureOutlined,
  PlayCircleOutlined,
  FileImageOutlined,
} from "@ant-design/icons";
import type { PhotoItem } from "./types";
import type { PanelTab } from "./EditorLayout";

export interface ProcessedMap {
  /** 主图 id → 结果条目；null 表示处理失败 */
  [mainId: string]: PhotoItem | null;
}

/**
 * 行窗口虚拟化的布局常量：
 * - 卡片 = 方形缩略图（宽=列宽，aspect-ratio 1/1）+ 固定高信息区。
 * - IP_META_H 必须与 App.css 中 .ip-meta{height:47px} 保持一致。
 */
const IP_META_H = 47; // 卡片信息区固定高
const IP_GAP = 8; // 卡片 / 行间距
const IP_PAD_X = 10; // .ip-scroll 左右 padding
const OVERSCAN_ROWS = 6; // 可视区上下额外渲染的行数

const formatSize = (bytes: number) => {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
};

/**
 * 纯原生滚轮接管（与 React 无关，直接操作 DOM）：
 *
 * 背景：在 WebView2/Chromium 里，当鼠标悬停在列表内的卡片上时，浏览器的
 * “默认滚动”会被吞掉 —— 表现为滚动条能拖、但滚轮怎么滚都不动。
 *
 * 做法：在滚动容器上注册【捕获阶段 + 非 passive】的原生 wheel 监听
 * （React 的 onWheel 被委托成 passive，无法 preventDefault，所以必须原生注册），
 * 把 deltaY 换算成像素后手动写入 scrollTop，彻底绕开浏览器默认滚动的判定。
 * 由于挂在捕获阶段，无论事件目标是哪张卡片、是否被中间层拦截，都会先到这里。
 */
function bindNativeWheelFix(el: HTMLElement): () => void {
  const onWheel = (e: WheelEvent) => {
    // 保留 Ctrl/Cmd + 滚轮（页面缩放）等系统手势
    if (e.ctrlKey || e.metaKey) return;
    // 只接管发生在本滚动容器内部的滚轮（不抢 modal 弹层等外部的滚动）
    if (e.target !== el && !el.contains(e.target as Node)) return;
    // 内容不满一屏时没必要接管，放行给外层
    if (el.scrollHeight <= el.clientHeight + 1) return;

    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16; // DOM_DELTA_LINE：按行
    else if (e.deltaMode === 2) dy *= Math.max(el.clientHeight - 1, 1); // DOM_DELTA_PAGE

    if (!dy) return;
    e.preventDefault();
    const max = el.scrollHeight - el.clientHeight;
    el.scrollTop = Math.max(0, Math.min(el.scrollTop + dy, max));
  };
  el.addEventListener("wheel", onWheel, { passive: false, capture: true });
  return () => el.removeEventListener("wheel", onWheel, { capture: true });
}

interface ImagePanelProps {
  originals: PhotoItem[];
  processed: ProcessedMap;
  /** 处理失败原因（主图 id → 原因，与 processed 中 null 对应） */
  failures: Record<string, string>;
  /** 当前选中的主原图 id */
  currentId: string | null;
  activeTab: PanelTab;
  /** 是否正在批量处理 */
  processing: boolean;
  /**
   * 单图独立方案的键集合签名（由 EditorLayout 计算）。
   * 只传签名而非整张 map，使"编辑某张独立方案"时本组件不会跟着每 tick 重渲染。
   */
  soloSignature: string;
  onTabChange: (tab: PanelTab) => void;
  /** 点选卡片（传入主原图 id；两 Tab 一一对应自动跟随） */
  onSelect: (mainId: string) => void;
  /** 删除：scope=origin 连原图带结果删；scope=result 只删结果 */
  onDelete: (mainId: string, scope: "origin" | "result") => void;
  onAdd: () => void;
  onProcess: () => void;
  onExportAll: () => void;
  /** 单张导出（悬浮小图标），统一走 EditorLayout 的导出 loading */
  onExportOne: (item: PhotoItem) => void;
  /** 是否正在导出（驱动导出按钮 loading / 禁用） */
  exporting?: boolean;
  /** 是否正在导入图片 / 生成缩略图（驱动批量添加 loading） */
  adding?: boolean;
}

/** 每个 origin 在某个 Tab 下的展示状态 */
type CardState =
  | { kind: "origin" }
  | { kind: "done"; result: PhotoItem }
  | { kind: "failed"; reason: string }
  | { kind: "pending" };

/** 渲染单张卡所需的上下文（均为稳定引用或纯值，避免虚拟行内重复解构） */
interface CardContext {
  processed: ProcessedMap;
  failures: Record<string, string>;
  currentId: string | null;
  activeTab: PanelTab;
  soloIds: Set<string>;
  exporting?: boolean;
  onTabChange: (tab: PanelTab) => void;
  onSelect: (mainId: string) => void;
  onDelete: (mainId: string, scope: "origin" | "result") => void;
  onExportOne: (item: PhotoItem) => void;
}

/** 单个缩略图上的悬浮操作按钮 */
const renderThumbActions = (ctx: CardContext, o: PhotoItem, state: CardState) => {
  const exportItem =
    state.kind === "done"
      ? (state as { result: PhotoItem }).result
      : ctx.activeTab === "origin"
        ? o
        : undefined;

  return (
    <div
      className="ip-actions"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {exportItem && (
        <Tooltip title={exportItem === o ? "导出原图（未加水印）" : "导出这张带水印的结果图"}>
          <Button
            type="text"
            size="small"
            icon={<ExportOutlined />}
            loading={ctx.exporting}
            disabled={ctx.exporting}
            onClick={() => ctx.onExportOne(exportItem)}
          />
        </Tooltip>
      )}
      <Popconfirm
        title={`删除「${o.name}」？`}
        description={
          ctx.activeTab === "origin"
            ? "原图与处理结果将一起删除，不可恢复"
            : undefined
        }
        okText="删除"
        okType="danger"
        cancelText="取消"
        onConfirm={() =>
          ctx.onDelete(o.id, ctx.activeTab === "origin" ? "origin" : "result")
        }
      >
        <Button type="text" size="small" icon={<DeleteOutlined />} />
      </Popconfirm>
    </div>
  );
};

/** 渲染单张主图内容卡（两 Tab 通用；处理结果 Tab 下用 state 反映处理状态） */
const renderCard = (o: PhotoItem, ctx: CardContext) => {
  const hasResult = o.id in ctx.processed;
  const result = ctx.processed[o.id];
  const state: CardState = hasResult
    ? result
      ? { kind: "done", result }
      : { kind: "failed", reason: ctx.failures[o.id] ?? "未知错误" }
    : { kind: "pending" };

  const isActive = o.id === ctx.currentId;
  const cls = [
    "ip-card",
    isActive ? "is-active" : "",
    ctx.activeTab === "processed" ? `is-${state.kind}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  /** 有缩略图显示小图；没有则显示占位（绝不直接渲染全尺寸大图，避免多图时卡顿） */
  const renderThumb = (thumbUrl?: string) =>
    thumbUrl ? (
      <img src={thumbUrl} alt={o.name} loading="lazy" draggable={false} />
    ) : (
      <div className="ip-placeholder is-pending">
        <PictureOutlined className="ip-ph-icon" />
        <span>预览生成中…</span>
      </div>
    );

  const thumbnail = (() => {
    if (ctx.activeTab === "origin") {
      return renderThumb(o.thumbUrl);
    }
    if (state.kind === "done") {
      return renderThumb((state as { result: PhotoItem }).result.thumbUrl);
    }
    // 处理结果 Tab 的失败 / 未处理占位
    if (state.kind === "failed") {
      return (
        <div className="ip-placeholder is-failed">
          <CloseCircleFilled className="ip-ph-icon" />
          <span>处理失败</span>
        </div>
      );
    }
    return (
      <div className="ip-placeholder is-pending">
        <HourglassOutlined className="ip-ph-icon" />
        <span>尚未处理</span>
      </div>
    );
  })();

  const badge = (() => {
    if (ctx.activeTab === "origin") return <span className="ip-badge ip-badge-origin">原图</span>;
    if (state.kind === "done")
      return (
        <span className="ip-badge ip-badge-ok">
          <CheckCircleFilled /> 已处理
        </span>
      );
    if (state.kind === "failed") return <span className="ip-badge ip-badge-fail">失败</span>;
    return <span className="ip-badge">未处理</span>;
  })();

  const actions =
    ctx.activeTab === "processed" && state.kind === "pending"
      ? null
      : renderThumbActions(ctx, o, state);

  const failedReason = state.kind === "failed" ? (state as { reason: string }).reason : null;
  const subText =
    ctx.activeTab === "origin"
      ? formatSize(o.size)
      : state.kind === "done"
        ? formatSize((state as { result: PhotoItem }).result.size)
        : state.kind === "failed"
          ? "点击查看失败原因"
          : "点此卡回原图设置水印";
  const isSolo = ctx.soloIds.has(o.id);

  return (
    <div
      className={cls}
      role="button"
      tabIndex={0}
      title={
        failedReason
          ? `处理失败：${failedReason}`
          : state.kind === "pending" && ctx.activeTab === "processed"
            ? `「${o.name}」尚未处理，点击回到原图设置水印`
            : isSolo
              ? `「${o.name}」（此图单独设置水印）`
              : o.name
      }
      onClick={() => {
        // 处理结果 Tab：未处理卡片 → 跳回原图设置
        if (ctx.activeTab === "processed" && state.kind === "pending") {
          ctx.onTabChange("origin");
        }
        ctx.onSelect(o.id);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (ctx.activeTab === "processed" && state.kind === "pending") {
            ctx.onTabChange("origin");
          }
          ctx.onSelect(o.id);
        }
      }}
    >
      <div className="ip-thumb">
        {thumbnail}
        {badge}
        {isSolo && <span className="ip-badge ip-badge-solo">单独</span>}
        {actions}
      </div>
      <div className="ip-meta">
        <span className="ip-name" title={o.name}>
          {o.name}
        </span>
        <span className="ip-sub">
          <span className={failedReason ? "ip-sub-failed" : ""}>{subText}</span>
        </span>
      </div>
    </div>
  );
};

/**
 * 行窗口虚拟化列表：
 * 只渲染可视区（上下各 OVERSCAN_ROWS 行）的真实卡片，其余区域用占位高度撑起。
 * - 不再整表挂载 DOM，滚动时主线程只有十几张卡片在做 hover/布局，滚轮不会被打满；
 * - 缩略图懒加载 + 行高收敛，滚动条高度稳定。
 */
const VirtualGrid = memo(function VirtualGrid({
  originals,
  processed,
  failures,
  currentId,
  activeTab,
  soloIds,
  exporting,
  onTabChange,
  onSelect,
  onDelete,
  onExportOne,
}: {
  originals: PhotoItem[];
  processed: ProcessedMap;
  failures: Record<string, string>;
  currentId: string | null;
  activeTab: PanelTab;
  soloIds: Set<string>;
  exporting?: boolean;
  onTabChange: (tab: PanelTab) => void;
  onSelect: (mainId: string) => void;
  onDelete: (mainId: string, scope: "origin" | "result") => void;
  onExportOne: (item: PhotoItem) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [metrics, setMetrics] = useState(() => ({
    top: 0,
    colW: 0,
    vh: 0,
  }));

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      // 每列宽 =（滚动内容宽 - 两卡间隙）/ 2
      const colW = Math.max(80, (el.clientWidth - IP_PAD_X * 2 - IP_GAP) / 2);
      setMetrics((m) =>
        m.top === el.scrollTop &&
        m.vh === el.clientHeight &&
        Math.abs(m.colW - colW) < 0.5
          ? m
          : { top: el.scrollTop, colW, vh: el.clientHeight },
      );
    };
    update();
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        update();
      });
    };
    el.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // 纯原生兜底：无论 hover 在什么元素上，滚轮都被强制转发给本容器
    const disposeWheel = bindNativeWheelFix(el);
    return () => {
      disposeWheel();
      el.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const n = originals.length;
  const nRows = Math.ceil(n / 2);
  // 首帧尚未测量到容器时按 300px 面板的固定列宽估算，避免 0 高度闪烁
  const colW = metrics.colW || 136;
  const rowH = colW + IP_META_H + IP_GAP; // 每行占位高度（含行距）
  const cardH = colW + IP_META_H; // 卡片实际高度（缩略图方形 + 信息区）
  const firstRow = Math.max(0, Math.floor(metrics.top / rowH) - OVERSCAN_ROWS);
  const lastRow = Math.min(
    nRows - 1,
    Math.ceil((metrics.top + Math.max(metrics.vh, 1)) / rowH) + OVERSCAN_ROWS,
  );

  const ctx: CardContext = {
    processed,
    failures,
    currentId,
    activeTab,
    soloIds,
    exporting,
    onTabChange,
    onSelect,
    onDelete,
    onExportOne,
  };

  const rows: ReactNode[] = [];
  for (let i = firstRow; i <= lastRow; i++) {
    const a = originals[i * 2];
    const b = originals[i * 2 + 1];
    rows.push(
      <div className="ip-vrow" key={i} style={{ top: i * rowH, height: cardH }}>
        {renderCard(a, ctx)}
        {b ? renderCard(b, ctx) : null}
      </div>,
    );
  }

  return (
    <div className="ip-scroll" ref={scrollRef}>
      <div className="ip-vport" style={{ height: nRows * rowH - IP_GAP }}>
        {rows}
      </div>
    </div>
  );
});

function ImagePanel({
  originals,
  processed,
  failures,
  currentId,
  activeTab,
  processing,
  exporting,
  adding,
  soloSignature,
  onTabChange,
  onSelect,
  onDelete,
  onAdd,
  onProcess,
  onExportAll,
  onExportOne,
}: ImagePanelProps) {
  /** 哪些主图有独立方案（从签名重建，签名不变则引用不变，配合 memo 稳定） */
  const soloIds = useMemo(() => {
    const ids = new Set<string>();
    if (soloSignature) {
      for (const id of soloSignature.split("\u0000")) ids.add(id);
    }
    return ids;
  }, [soloSignature]);
  const doneCount = originals.filter((o) => processed[o.id] != null).length;
  const failedCount = originals.filter((o) => o.id in processed && processed[o.id] === null)
    .length;
  const pendingCount = originals.length - doneCount - failedCount;
  const exportableCount = activeTab === "origin" ? originals.length : doneCount;

  const renderList = () => {
    if (originals.length === 0) {
      const isOrigin = activeTab === "origin";
      return (
        <div className="ip-scroll">
          <div className="ip-empty">
            <div className="ip-empty-icon">
              {isOrigin ? <PictureOutlined /> : <FileImageOutlined />}
            </div>
            <div className="ip-empty-title">
              {isOrigin ? "还没有原图" : "还没有可查看的处理结果"}
            </div>
            <p className="ip-empty-desc">
              {isOrigin
                ? "把图片拖进窗口，或点击下方「批量添加」"
                : "先添加原图并开始处理，结果会与每张原图一一对应显示在这里"}
            </p>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              loading={adding}
              disabled={adding}
              onClick={onAdd}
            >
              批量添加
            </Button>
          </div>
        </div>
      );
    }
    return (
      <VirtualGrid
        originals={originals}
        processed={processed}
        failures={failures}
        currentId={currentId}
        activeTab={activeTab}
        soloIds={soloIds}
        exporting={exporting}
        onTabChange={onTabChange}
        onSelect={onSelect}
        onDelete={onDelete}
        onExportOne={onExportOne}
      />
    );
  };

  const pendingHint = activeTab === "processed" && pendingCount > 0 && failedCount + doneCount > 0;

  return (
    <aside className="image-panel">
      <div className="ip-header">
        <div className="ip-seg">
          <button
            type="button"
            className={`ip-seg-btn ${activeTab === "origin" ? "active" : ""}`}
            onClick={() => onTabChange("origin")}
          >
            原图
            <span className="ip-seg-num">{originals.length}</span>
          </button>
          <button
            type="button"
            className={`ip-seg-btn ${activeTab === "processed" ? "active" : ""}`}
            onClick={() => onTabChange("processed")}
          >
            处理结果
            <span className="ip-seg-num">
              {originals.length ? `${doneCount}/${originals.length}` : "0"}
            </span>
          </button>
        </div>
        {pendingHint && (
          <div className="ip-hint">
            <span className="ip-hint-dot" />
            还有 {pendingCount} 张未处理，点灰色卡片可回到原图设置
          </div>
        )}
      </div>

      {renderList()}

      <div className="ip-footer">
        {activeTab === "processed" ? (
          <Button
            icon={<PlayCircleOutlined />}
            loading={processing}
            disabled={originals.length === 0 || processing}
            onClick={onProcess}
            className="ip-footer-main"
          >
            {doneCount + failedCount > 0 ? "重新处理全部" : "开始处理"}
          </Button>
        ) : (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            loading={adding}
            disabled={adding}
            onClick={onAdd}
            className="ip-footer-main"
          >
            批量添加
          </Button>
        )}
        <Button
          icon={<ExportOutlined />}
          loading={exporting}
          disabled={exportableCount === 0 || exporting}
          onClick={onExportAll}
        >
          导出全部
        </Button>
      </div>
    </aside>
  );
}

export default memo(ImagePanel);
