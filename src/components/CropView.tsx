import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, Segmented, Spin, Tooltip } from "antd";
import {
  RedoOutlined,
  RotateLeftOutlined,
  RotateRightOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import ReactCrop from "react-image-crop";
import type { PercentCrop, PixelCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import type { PhotoItem } from "./types";
import {
  applyDisplayOp,
  applyFinalCrop,
  applyRotateHalf,
  IDENTITY_TRANSFORM,
  isIdentity,
  makeWorkingImage,
  transformDims,
  type ImageTransform,
} from "./cropImage";

/* ------------------------------------------------------------------ */
/* 比例预设                                                            */
/* ------------------------------------------------------------------ */

type RatioKey = "free" | "original" | "1:1" | "4:3" | "3:2" | "16:9" | "9:16" | "3:4" | "2:3";

const RATIO_OPTIONS: { label: string; value: RatioKey }[] = [
  { label: "自由", value: "free" },
  { label: "原图", value: "original" },
  { label: "1:1", value: "1:1" },
  { label: "4:3", value: "4:3" },
  { label: "3:2", value: "3:2" },
  { label: "16:9", value: "16:9" },
  { label: "9:16", value: "9:16" },
  { label: "3:4", value: "3:4" },
  { label: "2:3", value: "2:3" },
];

/** 目标宽高比（w/h）；free 返回 null */
function ratioAspect(key: RatioKey, dw: number, dh: number): number | null {
  if (key === "free") return null;
  if (key === "original") return dw / dh;
  const [a, b] = key.split(":").map(Number);
  if (!a || !b) return null;
  return a / b;
}

/** 在 dw×dh 内，围绕指定中心生成最大可容纳的 aspect 矩形（px） */
function pxRectForAspect(
  dw: number,
  dh: number,
  aspect: number | null,
  cx?: number,
  cy?: number,
): { x: number; y: number; width: number; height: number } {
  if (aspect == null) return { x: 0, y: 0, width: dw, height: dh };
  let w: number;
  let h: number;
  if (aspect >= dw / dh) {
    w = dw;
    h = dw / aspect;
  } else {
    h = dh;
    w = dh * aspect;
  }
  const cxp = cx ?? dw / 2;
  const cyp = cy ?? dh / 2;
  const x = Math.min(Math.max(0, cxp - w / 2), Math.max(0, dw - w));
  const y = Math.min(Math.max(0, cyp - h / 2), Math.max(0, dh - h));
  return { x, y, width: w, height: h };
}

function rectToPercent(
  rect: { x: number; y: number; width: number; height: number },
  dw: number,
  dh: number,
): PercentCrop {
  return {
    unit: "%",
    x: (rect.x / dw) * 100,
    y: (rect.y / dh) * 100,
    width: (rect.width / dw) * 100,
    height: (rect.height / dh) * 100,
  };
}

/** 生成默认选区（围绕当前选区中心或画布中心） */
function defaultCropPercent(
  key: RatioKey,
  dw: number,
  dh: number,
  current?: PercentCrop | null,
): PercentCrop {
  const cx = current ? ((current.x + current.width / 2) / 100) * dw : undefined;
  const cy = current ? ((current.y + current.height / 2) / 100) * dh : undefined;
  const rect = pxRectForAspect(dw, dh, ratioAspect(key, dw, dh), cx, cy);
  return rectToPercent(rect, dw, dh);
}

const APPROX_EQ = (a: number, b: number) => Math.abs(a - b) < 0.01;

function sameTransform(a: ImageTransform, b: ImageTransform): boolean {
  return a.rotate === b.rotate && a.flipH === b.flipH && a.flipV === b.flipV;
}

function sameCropNear(a: PercentCrop, b: PercentCrop): boolean {
  return (
    a.unit === b.unit &&
    APPROX_EQ(a.x, b.x) &&
    APPROX_EQ(a.y, b.y) &&
    APPROX_EQ(a.width, b.width) &&
    APPROX_EQ(a.height, b.height)
  );
}

/* ------------------------------------------------------------------ */
/* 操作历史                                                            */
/* ------------------------------------------------------------------ */

/** 一次用户操作提交后的完整状态快照 */
interface HistorySnap {
  transform: ImageTransform;
  ratio: RatioKey;
  crop: PercentCrop;
}

function snapEq(a: HistorySnap, b: HistorySnap): boolean {
  return a.ratio === b.ratio && sameTransform(a.transform, b.transform) && sameCropNear(a.crop, b.crop);
}

/* ------------------------------------------------------------------ */
/* 镜像按钮图标                                                        */
/* ------------------------------------------------------------------ */

function FlipHorizontalIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M8 1v14" opacity="0.5" />
      <path d="M3.5 5.5 1.5 8l2 2.5" />
      <path d="M12.5 5.5l2 2.5-2 2.5" />
    </svg>
  );
}

function FlipVerticalIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M1 8h14" opacity="0.5" />
      <path d="M5.5 3.5 8 1.5l2.5 2" />
      <path d="M5.5 12.5 8 14.5l2.5-2" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* 组件                                                               */
/* ------------------------------------------------------------------ */

interface CropViewProps {
  image: PhotoItem;
  zoom: number;
  onCommit: (result: { url: string; size: number; width: number; height: number }) => void;
  onCancel: () => void;
}

export default function CropView({ image, zoom, onCommit, onCancel }: CropViewProps) {
  // 当前方向底座的像素信息（identity 时即原图）
  const [work, setWork] = useState<{ url: string; width: number; height: number } | null>(null);
  const workOwned = useRef(false);
  const workUrlRef = useRef<string | null>(null);
  const [t, setT] = useState<ImageTransform>(IDENTITY_TRANSFORM);
  const [transformBusy, setTransformBusy] = useState(false);
  const [committing, setCommitting] = useState(false);
  // 实时选区（拖动过程中连续更新）；每次拖拽结束/操作完成才写入历史
  const [crop, setCrop] = useState<PercentCrop | null>(null);
  const [ratio, setRatio] = useState<RatioKey>("original");
  // 操作历史（快照含 transform + ratio + crop）
  const [history, setHistory] = useState<HistorySnap[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    const url = workUrlRef.current;
    return () => {
      seqRef.current += 1; // 使可能仍在进行的编码失效
      if (url && url !== image.url) URL.revokeObjectURL(url);
    };
  }, [image.url]);

  /* ---------- 初始加载：读取原图尺寸并生成恒等底座 ---------- */
  useEffect(() => {
    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      const w = { url: image.url, width: img.naturalWidth, height: img.naturalHeight };
      workUrlRef.current = w.url;
      setWork(w);
    };
    img.onerror = () => {
      if (!alive) return;
      // 加载失败也给予一个可操作的空状态（一般不会发生）
      setWork(null);
    };
    img.src = image.url;
    return () => {
      alive = false;
    };
  }, [image.url]);

  /* ---------- 缩放容器尺寸测量 ---------- */
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setStage((prev) =>
        prev.w === r.width && prev.h === r.height ? prev : { w: r.width, h: r.height }
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ---------- 历史：把一条新快照追加到当前位置（截断未来的 redo） ---------- */
  const pushSnap = (snap: HistorySnap) => {
    const head = historyIndex >= 0 ? history[historyIndex] : null;
    if (head && snapEq(head, snap)) return; // 连续相同操作（如微小拖拽）去重
    const next = history.slice(0, historyIndex + 1);
    next.push(snap);
    setHistory(next);
    setHistoryIndex(next.length - 1);
  };

  /* ---------- 编码器：把方向变换重新渲染为底座（异步） ---------- */
  const encodeTo = (nextT: ImageTransform, nextCrop: PercentCrop) => {
    const seq = ++seqRef.current;
    setTransformBusy(true);
    void (async () => {
      try {
        const res = await makeWorkingImage(image.url, image.name, nextT);
        if (seq !== seqRef.current) {
          if (res.url !== image.url) URL.revokeObjectURL(res.url);
          return;
        }
        // 释放上一次自建的底座
        if (workOwned.current && workUrlRef.current && workUrlRef.current !== image.url) {
          URL.revokeObjectURL(workUrlRef.current);
        }
        workOwned.current = res.url !== image.url;
        workUrlRef.current = res.url;
        setWork(res);
        setT(nextT);
        setCrop(nextCrop);
      } catch {
        // 编码失败时保持原状（历史索引不变）
      } finally {
        if (seq === seqRef.current) setTransformBusy(false);
      }
    })();
  };

  /* ---------- 旋转 / 镜像：目标状态入历史并异步重绘底座 ---------- */
  const applyTransformOp = (nextT: ImageTransform) => {
    if (!work) return;
    if (sameTransform(t, nextT)) return;
    // 按新方向尺寸重算选区（围绕当前选区中心）
    const d = transformDims(work.width, work.height, nextT);
    const nextCrop = defaultCropPercent(ratio, d.width, d.height, crop);
    pushSnap({ transform: nextT, ratio, crop: nextCrop });
    encodeTo(nextT, nextCrop);
  };

  const rotateCW = () => applyTransformOp(applyDisplayOp(t, "rotateCW"));
  const rotateCCW = () => {
    let n = t;
    n = applyDisplayOp(n, "rotateCW");
    n = applyDisplayOp(n, "rotateCW");
    n = applyDisplayOp(n, "rotateCW");
    applyTransformOp(n);
  };
  const rotate180 = () => applyTransformOp(applyRotateHalf(t));
  const flipH = () => applyTransformOp(applyDisplayOp(t, "flipH"));
  const flipV = () => applyTransformOp(applyDisplayOp(t, "flipV"));
  const resetTransform = () => applyTransformOp(IDENTITY_TRANSFORM);

  /* ---------- 比例切换（入历史，不重编码） ---------- */
  const handleRatioChange = (k: RatioKey) => {
    if (!work || k === ratio) return;
    let nextCrop: PercentCrop;
    if (k === "free") {
      // 进入自由比例：保留当前选区
      nextCrop = crop ?? defaultCropPercent("free", work.width, work.height);
    } else {
      // 以当前选区中心重算对应比例的最大矩形
      nextCrop = defaultCropPercent(k, work.width, work.height, crop);
    }
    pushSnap({ transform: t, ratio: k, crop: nextCrop });
    setRatio(k);
    setCrop(nextCrop);
  };

  /* ---------- 选区拖拽结束：提交一条历史（pushSnap 自动去重） ---------- */
  const handleCropComplete = (_cropPx: PixelCrop, percent: PercentCrop) => {
    if (!work) return;
    pushSnap({ transform: t, ratio, crop: percent });
  };

  /* ---------- 撤销 / 重做 ---------- */
  const stepHistory = (delta: -1 | 1) => {
    const targetIndex = historyIndex + delta;
    const target = history[targetIndex];
    if (!target) return;
    setRatio(target.ratio);
    if (sameTransform(target.transform, t)) {
      // 仅选区/比例差异：瞬时恢复
      setCrop(target.crop);
      setHistoryIndex(targetIndex);
    } else {
      // 方向不同：入队异步重绘底座后恢复
      setHistoryIndex(targetIndex);
      encodeTo(target.transform, target.crop);
    }
  };

  const busy = transformBusy || committing;
  const canUndo = !busy && historyIndex > 0;
  const canRedo = !busy && historyIndex >= 0 && historyIndex < history.length - 1;

  /* ---------- 首次底座就绪：初始化选区并写入历史首条 ---------- */
  useEffect(() => {
    if (!work) return;
    if (historyIndex !== -1) return;
    const c = defaultCropPercent(ratio, work.width, work.height);
    setCrop(c);
    setHistory([{ transform: t, ratio, crop: c }]);
    setHistoryIndex(0);
    // 仅在底座首载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work]);

  /* ---------- 应用 ---------- */
  const changed = useMemo(() => {
    if (!work || !crop) return false;
    const full =
      APPROX_EQ(crop.x, 0) &&
      APPROX_EQ(crop.y, 0) &&
      APPROX_EQ(crop.width, 100) &&
      APPROX_EQ(crop.height, 100);
    return !(full && isIdentity(t));
  }, [work, crop, t]);

  const handleCommit = useCallback(async () => {
    if (committing || !work || !crop) return;
    if (!changed) {
      onCancel(); // 无改动，直接退出
      return;
    }
    setCommitting(true);
    try {
      const x = Math.min(Math.max(0, (crop.x / 100) * work.width), work.width - 1);
      const y = Math.min(Math.max(0, (crop.y / 100) * work.height), work.height - 1);
      const w = Math.max(1, Math.min((crop.width / 100) * work.width, work.width - x));
      const h = Math.max(1, Math.min((crop.height / 100) * work.height, work.height - y));
      const result = await applyFinalCrop(work.url, image.name, { x, y, width: w, height: h });
      onCommit(result);
    } catch {
      // 编码失败：保持裁剪界面，交由调用方统一提示
      setCommitting(false);
    }
  }, [committing, work, crop, changed, image.name, onCommit, onCancel]);

  /* ---------- 键盘：Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y / Enter / Esc ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          if (canRedo) stepHistory(1);
        } else if (canUndo) {
          stepHistory(-1);
        }
        return;
      }
      if (mod && key === "y") {
        e.preventDefault();
        if (canRedo) stepHistory(1);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        void handleCommit();
      } else if (e.key === "Escape") {
        if (!transformBusy && !committing) onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canUndo, canRedo, handleCommit, transformBusy, committing, onCancel, stepHistory]);

  /* ---------- 布局计算：图片在舞台内的 CSS 尺寸（不含 zoom） ---------- */
  const view = useMemo(() => {
    if (!work || stage.w <= 0 || stage.h <= 0) return null;
    const availW = Math.max(40, stage.w - 32);
    const availH = Math.max(40, stage.h - 32);
    const scale = Math.min(availW / work.width, availH / work.height, 1);
    return { width: Math.round(work.width * scale), height: Math.round(work.height * scale) };
  }, [work, stage]);

  const aspectNum = useMemo(() => {
    if (!work) return undefined;
    const a = ratioAspect(ratio, work.width, work.height);
    return a == null ? undefined : a;
  }, [ratio, work]);

  const sizeHint = useMemo(() => {
    if (!work || !crop) return null;
    const w = Math.round((crop.width / 100) * work.width);
    const h = Math.round((crop.height / 100) * work.height);
    return { w: Math.max(1, w), h: Math.max(1, h) };
  }, [work, crop]);

  return (
    <>
      <div className="crop-bar">
        <span className="crop-bar-title">裁剪</span>
        <Tooltip title="撤销 Ctrl+Z">
          <Button
            size="small"
            type="text"
            icon={<UndoOutlined />}
            disabled={!canUndo}
            onClick={() => stepHistory(-1)}
          />
        </Tooltip>
        <Tooltip title="重做 Ctrl+Shift+Z">
          <Button
            size="small"
            type="text"
            icon={<RedoOutlined />}
            disabled={!canRedo}
            onClick={() => stepHistory(1)}
          />
        </Tooltip>
        <Segmented
          size="small"
          value={ratio}
          onChange={(v) => handleRatioChange(v as RatioKey)}
          options={RATIO_OPTIONS}
          disabled={busy || !work}
        />
        <span className="crop-bar-divider" />
        <Tooltip title="逆时针旋转 90°">
          <Button size="small" type="text" icon={<RotateLeftOutlined />} disabled={busy || !work} onClick={rotateCCW} />
        </Tooltip>
        <Tooltip title="顺时针旋转 90°">
          <Button size="small" type="text" icon={<RotateRightOutlined />} disabled={busy || !work} onClick={rotateCW} />
        </Tooltip>
        <Tooltip title="旋转 180°">
          <Button size="small" type="text" icon={<RotateRightOutlined className="crop-icon-180" />} disabled={busy || !work} onClick={rotate180} />
        </Tooltip>
        <Tooltip title="水平翻转（左右）">
          <Button size="small" type="text" icon={<FlipHorizontalIcon />} disabled={busy || !work} onClick={flipH} />
        </Tooltip>
        <Tooltip title="垂直翻转（上下）">
          <Button size="small" type="text" icon={<FlipVerticalIcon />} disabled={busy || !work} onClick={flipV} />
        </Tooltip>
        <Tooltip title="恢复原方向（旋转/镜像全部取消）">
          <Button
            size="small"
            type="text"
            className="crop-reset-btn"
            disabled={busy || !work || isIdentity(t)}
            onClick={resetTransform}
          >
            重置
          </Button>
        </Tooltip>
        <span className="crop-bar-spacer" />
        {sizeHint && (
          <span className="crop-size-hint" title="裁剪输出像素尺寸">
            {sizeHint.w} × {sizeHint.h} px
          </span>
        )}
        <Button size="small" className="crop-btn-cancel" disabled={busy} onClick={onCancel}>
          取消
        </Button>
        <Button
          size="small"
          type="primary"
          className="crop-btn-apply"
          loading={committing}
          disabled={busy || !work || !changed}
          onClick={() => void handleCommit()}
        >
          应用裁剪
        </Button>
      </div>

      <div className="crop-stage" ref={stageRef}>
        {!work ? (
          <div className="crop-loading">
            <Spin />
            <span>正在读取图片…</span>
          </div>
        ) : view ? (
          <>
            <div className="crop-zoom" style={{ transform: `scale(${zoom / 100})` }}>
              <ReactCrop
                crop={crop ?? undefined}
                onChange={(_crop, percent) => setCrop(percent)}
                onComplete={handleCropComplete}
                aspect={aspectNum}
                keepSelection
                ruleOfThirds
                minWidth={16}
                minHeight={16}
                disabled={busy}
                className="crop-reactcrop"
              >
                <img
                  key={work.url}
                  src={work.url}
                  alt=""
                  draggable={false}
                  className="crop-media"
                  style={{
                    width: view.width,
                    height: view.height,
                    maxWidth: "none",
                    maxHeight: "none",
                  }}
                />
              </ReactCrop>
            </div>
            {busy && (
              <div className="crop-busy-mask">
                <Spin size="small" />
              </div>
            )}
          </>
        ) : (
          <div className="crop-loading">
            <Spin />
          </div>
        )}
      </div>
    </>
  );
}
