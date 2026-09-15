import { useCallback, useMemo, useRef, useState } from "react";
import { App, Checkbox, Modal, Radio } from "antd";
import { CloudUploadOutlined } from "@ant-design/icons";
import HeaderBar from "./HeaderBar";
import ToolPanel from "./ToolPanel";
import PreviewArea from "./PreviewArea";
import ImagePanel from "./ImagePanel";
import { exportAll } from "./exportUtil";
import { exportSingle } from "./exportUtil";
import { composeWatermark } from "./composeWatermark";
import { createThumbAndDisplay } from "./thumb";
import type {
  DatetimeLogoValues,
  GeoInfoLogoValues,
  ImageWatermarkPlansMap,
  PhotoItem,
  WatermarkOrientation,
  WatermarkPlan,
  WatermarkPosition,
  WatermarkPositionsMap,
  WatermarkPreset,
  WatermarkScalesMap,
} from "./types";
import { toMainId, toResultId } from "./types";
import {
  deleteWatermarkPreset,
  loadDatetimeOverrides,
  loadGeoInfoOverrides,
  loadWatermarkPresets,
  resolveWatermarkPosition,
  resolveWatermarkScale,
  saveDatetimeOverrides,
  saveGeoInfoOverrides,
} from "./watermarkStore";

export type PanelTab = "origin" | "processed";

/** 处理失败的失败原因（主图 id → 失败信息） */
type FailMap = Record<string, string>;

/** 水印应用范围的弹窗选择结果 */
type ScopeMode = "all" | "current" | "selected";

/** 浅复制一份水印方案（positions / scales 内部对象也复制，避免引用共享） */
function clonePlan(plan: WatermarkPlan): WatermarkPlan {
  return {
    presetIds: [...(plan.presetIds ?? [])],
    positions: plan.positions ? structuredClone(plan.positions) : undefined,
    scales: plan.scales ? structuredClone(plan.scales) : undefined,
  };
}

function EditorLayout() {
  const { message } = App.useApp();
  /** 主原图列表（id 即主 id，始终不带前缀） */
  const [originals, setOriginals] = useState<PhotoItem[]>([]);
  /**
   * 处理结果：主 id → 结果条目（带水印成品）。
   * - 有值 PhotoItem：处理成功
   * - null：该图处理失败（失败原因见 failures）
   * - 无该 key：尚未处理
   */
  const [processed, setProcessed] = useState<Record<string, PhotoItem | null>>(
    {},
  );
  /** 处理失败原因（主 id → 原因，与 processed 中的 null 对应） */
  const [failures, setFailures] = useState<FailMap>({});
  /** 当前选中的主原图 id（原图与处理结果一一对应，跟随切换） */
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<PanelTab>("origin");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [watermarkPresets, setWatermarkPresets] = useState<WatermarkPreset[]>(
    () => loadWatermarkPresets(),
  );
  /**
   * 全局默认水印方案的预设勾选（未单独设置的图片都跟随它）。
   * 位置 / 大小分别见 watermarkPositions / watermarkScales。
   */
  const [selectedPresetIds, setSelectedPresetIds] = useState<string[]>([]);
  /**
   * 单图覆盖方案表（主图 id → 该图自己的水印方案）。
   * 不在此表中的图片跟随全局默认方案；一旦某图被单独设置，
   * 之后对该图的预设 / 位置 / 大小调整都只写入它自己的方案，不影响全局与其他图。
   */
  const [imagePlans, setImagePlans] = useState<ImageWatermarkPlansMap>({});
  /**
   * 编辑作用对象：用户在 ToolPanel 顶部的「水印作用范围」中切换
   * - "global"：勾选预设 / 拖位置 / 改大小都写入全局默认
   * - "image"：写入当前主图的独立方案（无覆盖则自动复制全局快照）
   * 该开关决定「实时编辑」写哪里，但不影响"开始处理"对每张图按 imagePlans+globalPlan 的解析。
   */
  const [editingTarget, setEditingTarget] = useState<"global" | "image">("global");
  /** 时间地点 LOGO 编辑值覆盖（按预设 ID，双击编辑后持久化） */
  const [datetimeOverrides, setDatetimeOverrides] = useState<
    Record<string, DatetimeLogoValues>
  >(() => loadDatetimeOverrides());
  /** 地理信息水印编辑值覆盖（按预设 ID，双击编辑后持久化） */
  const [geoInfoOverrides, setGeoInfoOverrides] = useState<
    Record<string, GeoInfoLogoValues>
  >(() => loadGeoInfoOverrides());
  /** 是否正在批量合成水印 */
  const [processing, setProcessing] = useState(false);
  /** 是否正在导出（单张/悬浮/全部共用，防并发 + 按钮 loading） */
  const [exporting, setExporting] = useState(false);
  const exportingRef = useRef(false);
  /** 是否正在导入图片 / 生成缩略图（驱动「批量上传/批量添加」loading） */
  const [adding, setAdding] = useState(false);
  /** 进行中的缩略图任务数：并发导入时等所有批次都结束再收尾 */
  const thumbTasksRef = useRef(0);
  /** 各预设按横/竖屏方向独立的水印位置（全局默认方案，预览中可拖拽调整） */
  const [watermarkPositions, setWatermarkPositions] =
    useState<WatermarkPositionsMap>({});
  /** 当前水印布局方向：横屏 / 竖屏（两套位置各自独立，当前默认取值相同） */
  const [watermarkOrientation, setWatermarkOrientation] =
    useState<WatermarkOrientation>("landscape");
  /** 各预设按横/竖屏方向独立的水印大小倍率（全局默认方案） */
  const [watermarkScales, setWatermarkScales] = useState<WatermarkScalesMap>(
    {},
  );
  /** 时间行大数字（0-9 字形）间距（基准 px，随水印缩放；负值 = 往里缩） */
  const [timeDigitSpacing, setTimeDigitSpacing] = useState(-9);
  /** 日期行小数字（0-9 字形）间距（基准 px，随水印缩放；负值 = 往里缩） */
  const [dateDigitSpacing, setDateDigitSpacing] = useState(-1);
  /** 拖拽上传：是否有文件正拖入窗口 */
  const [dragActive, setDragActive] = useState(false);
  /** 拖拽计数器，防止经过子元素时闪烁 */
  const dragCounter = useRef(0);
  /** 水印应用范围弹窗 */
  const [scopeModalOpen, setScopeModalOpen] = useState(false);
  const [scopeMode, setScopeMode] = useState<ScopeMode>("all");
  const [scopeSelectedIds, setScopeSelectedIds] = useState<string[]>([]);

  const triggerUpload = useCallback(() => fileInputRef.current?.click(), []);

  const handleFiles = (files: File[] | null) => {
    if (!files || files.length === 0) return;
    const newItems: PhotoItem[] = files.map((file, idx) => ({
      id: `origin-${Date.now()}-${idx}-${file.name}`,
      name: file.name,
      url: URL.createObjectURL(file),
      size: file.size,
    }));
    setOriginals((prev) => [...prev, ...newItems]);
    // 首次导入时选中第一张；后续追加不打断当前查看
    setCurrentId((prev) => prev ?? newItems[0]?.id ?? null);
    // 后台分批为新增图片生成缩略图（避免一次性解码大量全尺寸原图导致卡顿）
    setAdding(true);
    thumbTasksRef.current += 1;
    void generateThumbsForOriginals(newItems, files).finally(() => {
      thumbTasksRef.current -= 1;
      if (thumbTasksRef.current <= 0) {
        thumbTasksRef.current = 0;
        setAdding(false);
      }
    });
  };

  /**
   * 为新导入的图片分批生成缩略图 + 预览大图（同一张原图只完整解码一次），
   * 生成完一批回写一批，右栏卡片渐进显示小图、预览区则改用降采样大图。
   */
  const generateThumbsForOriginals = async (items: PhotoItem[], blobs: Blob[]) => {
    const CHUNK = 2; // 同时解码张数：一次解码 + 两级缩略比较吃内存，比原来更保守
    for (let i = 0; i < items.length; i += CHUNK) {
      const slice = items.slice(i, i + CHUNK);
      const results = await Promise.all(
        slice.map(async (item, k) => ({
          id: item.id,
          meta: await createThumbAndDisplay(blobs[i + k]),
        })),
      );
      const patch = new Map<
        string,
        { thumbUrl?: string; displayUrl?: string; width?: number; height?: number }
      >();
      for (const r of results) {
        if (!r.meta.thumbUrl && !r.meta.displayUrl) continue;
        patch.set(r.id, {
          thumbUrl: r.meta.thumbUrl ?? undefined,
          displayUrl: r.meta.displayUrl ?? undefined,
          width: r.meta.width > 0 ? r.meta.width : undefined,
          height: r.meta.height > 0 ? r.meta.height : undefined,
        });
      }
      if (patch.size === 0) continue;
      setOriginals((prev) => {
        let changed = false;
        const next = prev.map((o) => {
          const p = patch.get(o.id);
          if (!p) return o;
          changed = true;
          return { ...o, ...p };
        });
        // 生成期间该批已被删除：释放没人引用的缩略图 / 预览大图
        if (!changed) {
          patch.forEach((p) => {
            if (p.thumbUrl) URL.revokeObjectURL(p.thumbUrl);
            if (p.displayUrl) URL.revokeObjectURL(p.displayUrl);
          });
        }
        return changed ? next : prev;
      });
    }
  };

  /**
   * 为替换过大图的条目重建缩略图 + 预览大图（裁剪应用后）。
   * 新图就绪后再替换并释放旧图，避免卡片短暂破图。
   */
  const refreshThumb = (
    mainId: string,
    scope: "origin" | "result",
    sourceUrl: string,
  ) => {
    const prev =
      scope === "origin"
        ? originals.find((o) => o.id === mainId)
        : processed[mainId];
    void (async () => {
      const meta = await createThumbAndDisplay(sourceUrl);
      const { thumbUrl: t, displayUrl: d, width, height } = meta;
      if (!t && !d) return;
      if (scope === "origin") {
        setOriginals((prevList) => {
          let changed = false;
          const next = prevList.map((o) => {
            if (o.id !== mainId) return o;
            changed = true;
            if (prev?.thumbUrl && o.thumbUrl === prev.thumbUrl)
              URL.revokeObjectURL(prev.thumbUrl);
            if (prev?.displayUrl && o.displayUrl === prev.displayUrl)
              URL.revokeObjectURL(prev.displayUrl);
            return {
              ...o,
              thumbUrl: t ?? o.thumbUrl,
              displayUrl: d ?? o.displayUrl,
              width: width > 0 ? width : o.width,
              height: height > 0 ? height : o.height,
            };
          });
          if (!changed) {
            if (t) URL.revokeObjectURL(t);
            if (d) URL.revokeObjectURL(d);
          }
          return changed ? next : prevList;
        });
      } else {
        setProcessed((prevMap) => {
          const cur = prevMap[mainId];
          if (!cur) {
            if (t) URL.revokeObjectURL(t);
            if (d) URL.revokeObjectURL(d);
            return prevMap;
          }
          if (prev?.thumbUrl && cur.thumbUrl === prev.thumbUrl)
            URL.revokeObjectURL(prev.thumbUrl);
          if (prev?.displayUrl && cur.displayUrl === prev.displayUrl)
            URL.revokeObjectURL(prev.displayUrl);
          return {
            ...prevMap,
            [mainId]: {
              ...cur,
              thumbUrl: t ?? cur.thumbUrl,
              displayUrl: d ?? cur.displayUrl,
              width: width > 0 ? width : cur.width,
              height: height > 0 ? height : cur.height,
            },
          };
        });
      }
    })();
  };

  /**
   * 批量处理完成后，后台分批为成功结果生成缩略图 + 预览大图。
   * 生成前卡片先显示占位，避免「处理结果」Tab 一次性解码所有全尺寸成品图。
   */
  const hydrateProcessedThumbs = async (
    entries: { mainId: string; url: string }[],
  ) => {
    const CHUNK = 2;
    for (let i = 0; i < entries.length; i += CHUNK) {
      const slice = entries.slice(i, i + CHUNK);
      const results = await Promise.all(
        slice.map(async (e) => ({
          mainId: e.mainId,
          meta: await createThumbAndDisplay(e.url),
        })),
      );
      const patch = new Map<
        string,
        { thumbUrl?: string; displayUrl?: string; width?: number; height?: number }
      >();
      for (const r of results) {
        if (!r.meta.thumbUrl && !r.meta.displayUrl) continue;
        patch.set(r.mainId, {
          thumbUrl: r.meta.thumbUrl ?? undefined,
          displayUrl: r.meta.displayUrl ?? undefined,
          width: r.meta.width > 0 ? r.meta.width : undefined,
          height: r.meta.height > 0 ? r.meta.height : undefined,
        });
      }
      if (patch.size === 0) continue;
      setProcessed((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const [id, p] of patch) {
          const cur = next[id];
          if (!cur) {
            if (p.thumbUrl) URL.revokeObjectURL(p.thumbUrl);
            if (p.displayUrl) URL.revokeObjectURL(p.displayUrl);
            continue;
          }
          next[id] = { ...cur, ...p };
          changed = true;
        }
        return changed ? next : prev;
      });
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    if (!e.dataTransfer.types.includes("Files")) return;
    dragCounter.current += 1;
    setDragActive(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragActive(false);
    const imageFiles = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (imageFiles.length === 0) {
      message.warning("拖入的文件中没有图片");
      return;
    }
    handleFiles(imageFiles);
    message.success(`已拖入 ${imageFiles.length} 张图片`);
  };

  /** 当前选中的主原图 */
  const currentOrigin = originals.find((item) => item.id === currentId) ?? null;
  /** 当前原图对应的处理结果（失败为 null；未处理时当前原图 id 不在 processed 中） */
  const currentResult = currentId ? (processed[currentId] ?? null) : null;
  /** 当前图片在原始列表中的序号（0 起）：日期顺序递增模式按此计算（第 1 张 = 起始日期） */
  const currentImageIndex = useMemo(() => {
    if (!currentId) return 0;
    const idx = originals.findIndex((item) => item.id === currentId);
    return idx >= 0 ? idx : 0;
  }, [currentId, originals]);

  /** 预览区显示的图：原图 Tab 显示原图；处理结果 Tab 显示其结果（未处理/失败时为 null，交给空态引导） */
  const currentImage =
    activeTab === "processed" ? currentResult : currentOrigin;

  /** 当前主图 id（currentId 已是主 id，处理结果 id 也是主 id） */
  const currentMainId = currentId ? toMainId(currentId) : null;

  /** 全局默认方案（从全局状态派生） */
  const globalPlan: WatermarkPlan = useMemo(
    () => ({
      presetIds: selectedPresetIds,
      positions: watermarkPositions,
      scales: watermarkScales,
    }),
    [selectedPresetIds, watermarkPositions, watermarkScales],
  );

  /** 当前图片是否已有单独覆盖方案 */
  const hasImagePlan = currentMainId ? currentMainId in imagePlans : false;

  /** 读取某个主图生效的水印方案：有覆盖用覆盖，否则用全局默认 */
  const planForMain = (mainId: string | null): WatermarkPlan =>
    mainId && imagePlans[mainId] ? imagePlans[mainId]! : globalPlan;

  /** 当前图片生效的水印方案（预览与导出共用，所见即所得） */
  const currentPlan = planForMain(currentMainId);

  /**
   * 当前编辑作用对象：
   * - editingTarget === "global" → null（写全局默认）
   * - editingTarget === "image" 且已选中主图 → mainId（写该图覆盖）
   * 这是用户「实时编辑」影响的范围；不改变每张图按 imagePlans+globalPlan 解析的"处理"逻辑。
   */
  const effectiveTargetMainId =
    editingTarget === "image" && currentMainId ? currentMainId : null;

  /**
   * 编辑时读取的方案：
   * - 写"全局"：直接拿全局默认
   * - 写"当前图片"：拿该图当前已有方案（若有），否则用全局默认作为初始，
   *   并在首次写时自动创建该图的覆盖（writePlan 内部以 target id 为 key 写入 imagePlans）。
   */
  const editingPlan = effectiveTargetMainId
    ? planForMain(effectiveTargetMainId)
    : globalPlan;

  /**
   * 把一份方案写入某个目标：
   * - target 为 null → 写全局默认
   * - target 为主图 id → 写该图覆盖
   */
  const writePlan = (target: string | null, plan: WatermarkPlan) => {
    if (target) {
      setImagePlans((prev) => ({ ...prev, [target]: plan }));
    } else {
      setSelectedPresetIds(plan.presetIds);
      setWatermarkPositions(plan.positions ?? {});
      setWatermarkScales(plan.scales ?? {});
    }
  };

  /**
   * 写入编辑作用对象：
   * - 配合 ToolPanel 顶部的「作用范围」Segmented
   * - 写"当前图片"时，若该图无覆盖，首次写入会创建该图的 imagePlan 快照
   *   （这意味着切到"当前图片"再改预设/位置，自动独立化该图）
   */
  const writeToEditingTarget = (next: WatermarkPlan) => {
    writePlan(effectiveTargetMainId, next);
  };

  /** 裁剪应用：替换当前 Tab 正在预览的图（原图与处理结果互不影响） */
  const handleCropApply = (result: {
    url: string;
    size: number;
    width: number;
    height: number;
  }) => {
    const mainId = currentId ? toMainId(currentId) : null;
    if (!mainId) return;
    if (activeTab === "origin") {
      setOriginals((prev) =>
        prev.map((o) => {
          if (o.id !== mainId) return o;
          if (o.url !== result.url) URL.revokeObjectURL(o.url);
          return { ...o, url: result.url, size: result.size };
        }),
      );
      refreshThumb(mainId, "origin", result.url);
    } else {
      setProcessed((prev) => {
        const cur = prev[mainId];
        if (!cur) return prev;
        if (cur.url !== result.url) URL.revokeObjectURL(cur.url);
        return {
          ...prev,
          [mainId]: { ...cur, url: result.url, size: result.size },
        };
      });
      refreshThumb(mainId, "result", result.url);
    }
    message.success("裁剪完成，已更新当前图片");
  };

  /** 导出范围：按当前 Tab，结果列表保持与原图一致的顺序 */
  const exportList: PhotoItem[] = useMemo(() => {
    if (activeTab === "origin") return originals;
    return originals
      .map((o) => processed[o.id])
      .filter((r): r is PhotoItem => r !== null && r !== undefined);
  }, [activeTab, originals, processed]);

  const handleTabChange = (tab: PanelTab) => {
    setActiveTab(tab);
    if (currentId === null && originals.length > 0) {
      setCurrentId(originals[0].id);
    }
  };

  const handleSelect = (mainId: string) => setCurrentId(mainId);

  const handleExportSingle = async () => {
    if (!currentImage) {
      if (activeTab === "processed" && currentOrigin) {
        message.warning("当前图片还没有可导出的处理结果，请先点击「开始处理」");
      } else {
        message.warning("请先在右侧选择一张要导出的图片");
      }
      return;
    }
    await performExport(currentImage);
  };

  /** 统一的单张导出：加锁防重入，并提供 loading 反馈 */
  const performExport = async (item: PhotoItem) => {
    if (exportingRef.current) return;
    exportingRef.current = true;
    setExporting(true);
    try {
      const result = await exportSingle(item);
      if (result === "ok") {
        message.success(`已导出「${item.name}」`);
      } else if (result === "cancelled") {
        message.info("已取消导出");
      } else {
        message.error(`导出「${item.name}」失败`);
      }
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  };

  /** 悬浮导出（右侧卡片小图标导出单张） */
  const handleExportItem = async (item: PhotoItem) => {
    await performExport(item);
  };

  const handleExportAll = async () => {
    if (exportingRef.current) return;
    if (exportList.length === 0) {
      message.warning("当前列表没有可导出的图片");
      return;
    }
    exportingRef.current = true;
    setExporting(true);
    try {
      const result = await exportAll(exportList);
      if (result.cancelled) {
        message.info("已取消导出");
        return;
      }
      if (result.failed.length > 0) {
        message.error(
          `导出完成：成功 ${result.saved} 张，失败 ${result.failed.join("、")}`,
        );
      } else {
        message.success(`已导出 ${result.saved} 张图片`);
      }
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  };

  /**
   * 删除图片：
   * - scope = origin：整对删除（原图 + 处理结果 + 单图水印方案）
   * - scope = result：只删处理结果，原图保留（可随时重新处理）
   */
  const handleDelete = (mainId: string, scope: "origin" | "result") => {
    const origin = originals.find((o) => o.id === mainId);
    const result = processed[mainId] ?? null;
    if (scope === "origin") {
      if (!origin) return;
      if (result) {
        URL.revokeObjectURL(result.url);
        if (result.thumbUrl) URL.revokeObjectURL(result.thumbUrl);
        if (result.displayUrl) URL.revokeObjectURL(result.displayUrl);
      }
      URL.revokeObjectURL(origin.url);
      if (origin.thumbUrl) URL.revokeObjectURL(origin.thumbUrl);
      if (origin.displayUrl) URL.revokeObjectURL(origin.displayUrl);
      const nextOriginals = originals.filter((o) => o.id !== mainId);
      setOriginals(nextOriginals);
      setProcessed((prev) => {
        const next = { ...prev };
        delete next[mainId];
        return next;
      });
      setFailures((prev) => {
        if (!(mainId in prev)) return prev;
        const next = { ...prev };
        delete next[mainId];
        return next;
      });
      setImagePlans((prev) => {
        if (!(mainId in prev)) return prev;
        const next = { ...prev };
        delete next[mainId];
        return next;
      });
      // 若删的是当前选中：就近补选同列表邻居
      if (currentId === mainId) {
        const idx = originals.findIndex((o) => o.id === mainId);
        const fallback =
          nextOriginals[Math.min(idx, nextOriginals.length - 1)] ??
          nextOriginals[0] ??
          null;
        setCurrentId(fallback ? fallback.id : null);
      }
      message.success(`已删除「${origin.name}」及处理结果`);
    } else {
      // 只删结果
      if (result) {
        URL.revokeObjectURL(result.url);
        if (result.thumbUrl) URL.revokeObjectURL(result.thumbUrl);
        if (result.displayUrl) URL.revokeObjectURL(result.displayUrl);
      }
      setProcessed((prev) => {
        if (!(mainId in prev)) return prev;
        const next = { ...prev };
        delete next[mainId];
        return next;
      });
      setFailures((prev) => {
        if (!(mainId in prev)) return prev;
        const next = { ...prev };
        delete next[mainId];
        return next;
      });
      message.success(
        origin
          ? `已删除「${origin.name}」的处理结果，原图已保留`
          : "已删除处理结果",
      );
    }
  };

  const checkPreset = () => {
    if (watermarkPresets.length === 0) {
      message.warning("暂无本机水印预设");
      return false;
    }
    if (editingPlan.presetIds.length === 0) {
      message.warning("请先在左侧选择一个或多个水印预设（可多选叠加）");
      return false;
    }
    return true;
  };

  /** 打开「应用到图片」范围弹窗 */
  const handleWatermarkCurrent = () => {
    if (!checkPreset()) return;
    if (originals.length === 0) {
      message.warning("请先添加图片");
      return;
    }
    setScopeSelectedIds(currentId ? [currentId] : []);
    setScopeMode("all");
    setScopeModalOpen(true);
  };

  /** 更新某个水印的位置（方向位分套；走当前编辑作用对象），稳定回调供 PreviewArea memo */
  const handleWatermarkPositionChange = (
    id: string,
    orientation: WatermarkOrientation,
    pos: WatermarkPosition,
  ) => {
    writeToEditingTarget({
      ...editingPlan,
      positions: {
        ...(editingPlan.positions ?? {}),
        [id]: { ...(editingPlan.positions?.[id] ?? {}), [orientation]: pos },
      },
    });
  };

  /** 更新某个水印的大小倍率（稳定回调供 PreviewArea memo） */
  const handleWatermarkScaleChange = (
    id: string,
    orientation: WatermarkOrientation,
    scale: number,
  ) => {
    writeToEditingTarget({
      ...editingPlan,
      scales: {
        ...(editingPlan.scales ?? {}),
        [id]: { ...(editingPlan.scales?.[id] ?? {}), [orientation]: scale },
      },
    });
  };

  /**
   * 把“当前编辑方案”应用到所选范围：
   * - all：写为全局默认（之前单独设置的图不受影响）
   * - current / selected：复制到这些图的覆盖方案
   */
  const handleApplyScope = () => {
    if (!scopeModalOpen) return;
    if (editingPlan.presetIds.length === 0) {
      message.warning("请先在左侧选择一个或多个水印预设");
      return;
    }
    const snapshot = clonePlan(editingPlan);
    if (scopeMode === "all") {
      writePlan(null, snapshot);
      message.success(
        hasImagePlan
          ? "已更新全局默认水印方案"
          : "已应用到所有图片（未单独设置的图片跟随）",
      );
    } else {
      const targets =
        scopeMode === "current"
          ? currentMainId
            ? [currentMainId]
            : []
          : scopeSelectedIds.filter(
              (id) => id !== null && originals.some((o) => o.id === id),
            );
      if (targets.length === 0) {
        message.warning("请先选择要应用到的图片");
        return;
      }
      setImagePlans((prev) => {
        const next = { ...prev };
        for (const id of targets) next[id] = clonePlan(snapshot);
        return next;
      });
      message.success(
        `已将当前水印单独应用到 ${targets.length} 张图片（不影响其他图片）`,
      );
      // 独立设置后停留在这批图的某一张，方便继续微调
      const first = targets[0];
      if (first) {
        setCurrentId(first);
        setActiveTab("origin");
      }
    }
    setScopeModalOpen(false);
  };

  /**
   * ToolPanel 顶部「作用范围」Segmented 切换：
   * - 切到"当前图片"且该图无覆盖时，从全局默认复制一份快照作为它的独立方案
   *   （之后改动自动只影响它；预览也会立刻与全局区分）
   * - 切到"全部图片"不触碰 imagePlans
   */
  const handleEditingTargetChange = (target: "global" | "image") => {
    setEditingTarget(target);
    if (target === "image" && currentMainId && !imagePlans[currentMainId]) {
      setImagePlans((prev) => ({
        ...prev,
        [currentMainId]: clonePlan(globalPlan),
      }));
    }
  };

  /** 让当前图片恢复跟随全局默认方案（清掉它的独立方案） */
  const handleResetImageScope = () => {
    if (!currentMainId || !imagePlans[currentMainId]) return;
    setImagePlans((prev) => {
      const next = { ...prev };
      delete next[currentMainId];
      return next;
    });
    if (editingTarget === "image") setEditingTarget("global");
    message.success(
      currentOrigin
        ? `「${currentOrigin.name}」已恢复跟随全局默认水印`
        : "已恢复跟随全局默认水印",
    );
  };

  /** 旧按钮式 ToolPanel 的「仅此图单独」→ 切到"当前图片"作用范围 */
  const handleMakeIndependent = () => handleEditingTargetChange("image");

  const handleSelectPreset = (preset: WatermarkPreset) => {
    const exists = editingPlan.presetIds.includes(preset.id);
    const presetIds = exists
      ? editingPlan.presetIds.filter((id) => id !== preset.id)
      : [...editingPlan.presetIds, preset.id];
    const positions = { ...(editingPlan.positions ?? {}) };
    const scales = { ...(editingPlan.scales ?? {}) };
    // 新勾选预设：清除该预设上次的拖拽位置/大小记录，回到默认位置与大小
    //（不清理的话，预览里拖过一次就会一直盖过默认值，导致"默认不生效"）
    delete positions[preset.id];
    delete scales[preset.id];
    writeToEditingTarget({ presetIds, positions, scales });
  };

  const handleDeletePreset = (preset: WatermarkPreset) => {
    if (preset.builtin) {
      message.warning("内置预设不允许删除");
      return;
    }
    setWatermarkPresets(deleteWatermarkPreset(preset.id));
    // 从当前编辑对象移除该预设，避免脏引用
    writeToEditingTarget({
      ...editingPlan,
      presetIds: editingPlan.presetIds.filter((id) => id !== preset.id),
    });
    setImagePlans((prev) => {
      const next: ImageWatermarkPlansMap = {};
      for (const [id, plan] of Object.entries(prev)) {
        const presetIds = plan.presetIds.filter((pid) => pid !== preset.id);
        if (presetIds.length > 0) next[id] = { ...plan, presetIds };
      }
      return next;
    });
    message.success(`已删除水印预设「${preset.name}」`);
  };

  const handleEditPreset = (preset: WatermarkPreset) => {
    if (preset.builtin) {
      message.warning("内置预设不允许修改");
      return;
    }
    message.info(`编辑水印预设「${preset.name}」功能开发中`);
  };

  /**
   * 按“某个方案的 presetIds”过滤出预设列表，并合并编辑值
   * （时间/日期/星期/地点 + 地理信息覆盖到 config）
   */
  const resolvePresetsOf = (plan: WatermarkPlan): WatermarkPreset[] => {
    return watermarkPresets
      .filter((p) => plan.presetIds.includes(p.id))
      .map((p) => {
        const overrides = {
          ...datetimeOverrides[p.id],
          ...geoInfoOverrides[p.id],
        };
        return Object.keys(overrides).length
          ? { ...p, config: { ...p.config, ...overrides } }
          : p;
      });
  };

  /** 当前生效方案的预设列表（预览用） */
  const currentEffectivePresets = useMemo(
    () => resolvePresetsOf(currentPlan),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [watermarkPresets, currentPlan.presetIds, datetimeOverrides, geoInfoOverrides],
  );

  const handleDatetimeChange = (
    presetId: string,
    values: DatetimeLogoValues,
  ) => {
    setDatetimeOverrides((prev) => {
      const next = { ...prev, [presetId]: values };
      saveDatetimeOverrides(next);
      return next;
    });
  };

  const handleGeoInfoChange = (presetId: string, values: GeoInfoLogoValues) => {
    setGeoInfoOverrides((prev) => {
      const next = { ...prev, [presetId]: values };
      saveGeoInfoOverrides(next);
      return next;
    });
  };

  const handleRemoveWatermark = (presetId: string) => {
    writeToEditingTarget({
      presetIds: editingPlan.presetIds.filter((id) => id !== presetId),
      positions: editingPlan.positions ?? {},
      scales: editingPlan.scales ?? {},
    });
    message.info("已移除该水印");
  };

  /**
   * 开始处理：把水印真正合成进每张原图，生成带水印的新图。
   * 逐图解析方案——有单独覆盖的用覆盖，否则用全局默认；
   * 没有任何预设的图片跳过（不生成结果）。
   */
  const handleProcess = async () => {
    if (originals.length === 0) {
      message.warning("请先上传图片");
      return;
    }
    const anyPlan = originals.some((o) => planForMain(o.id).presetIds.length > 0);
    if (!anyPlan) {
      message.warning("请先添加水印：选择一个预设并「应用到图片」");
      return;
    }
    if (processing) return;
    setProcessing(true);
    const nextMap: Record<string, PhotoItem | null> = {};
    const failMap: FailMap = {};
    let skipped = 0;
    // 旧结果 URL：render 更新后再释放，避免正在显示的缩略图破图
    const oldResultUrls = Object.values(processed).filter(
      (r): r is PhotoItem => r !== null && r !== undefined,
    );
    try {
      for (const [imgIndex, item] of originals.entries()) {
        const plan = planForMain(item.id);
        const planPresets = resolvePresetsOf(plan);
        // 该图没有启用任何水印：跳过（不生成结果）
        if (planPresets.length === 0) {
          skipped += 1;
          continue;
        }
        try {
          // 逐个预设链式合成，实现多水印叠加
          let currentUrl = item.url;
          let currentSize = item.size;
          for (const preset of planPresets) {
            const composed = await composeWatermark(
              { ...item, url: currentUrl, size: currentSize },
              preset,
              {
                position: resolveWatermarkPosition(
                  preset,
                  watermarkOrientation,
                  plan.positions,
                ),
                seed: item.id,
                dateIndex: imgIndex,
                scale: resolveWatermarkScale(
                  preset,
                  watermarkOrientation,
                  plan.scales,
                ),
                timeDigitSpacing,
                dateDigitSpacing,
                orientation: watermarkOrientation,
              },
            );
            // 释放中间合成结果的临时 URL（保留原图 URL）
            if (currentUrl !== item.url) URL.revokeObjectURL(currentUrl);
            currentUrl = composed.url;
            currentSize = composed.blob.size;
          }
          nextMap[item.id] = {
            ...item,
            id: toResultId(item.id),
            url: currentUrl,
            size: currentSize,
            // 结果缩略图在后台单独生成，避免把原图缩略错当作成品图
            thumbUrl: undefined,
          };
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          failMap[item.id] = reason;
          nextMap[item.id] = null;
        }
      }
    } finally {
      setProcessing(false);
    }
    const succeeded = originals.filter((o) => nextMap[o.id]);
    setProcessed(nextMap);
    setFailures(failMap);
    setActiveTab("processed");
    // 后台分批为成功结果生成缩略图（不阻塞 UI）
    void hydrateProcessedThumbs(
      succeeded
        .map((o) => {
          const r = nextMap[o.id];
          return r ? { mainId: o.id, url: r.url } : null;
        })
        .filter((e): e is { mainId: string; url: string } => e !== null),
    );
    // 处理完成优先选中第一张成功的；全部失败则停留在当前原图（空态展示失败原因）
    setCurrentId(
      succeeded[0]?.id ?? currentOrigin?.id ?? originals[0]?.id ?? null,
    );
    if (succeeded.length > 0) {
      message.success(
        `已生成 ${succeeded.length} 张带水印图片${
          Object.keys(failMap).length
            ? `，${Object.keys(failMap).length} 张失败`
            : ""
        }${skipped ? `，${skipped} 张未设置水印已跳过` : ""}`,
      );
    }
    if (skipped > 0 && succeeded.length === 0 && Object.keys(failMap).length === 0) {
      message.warning("没有启用水印的图片，请先在左侧选择预设并「应用到图片」");
    }
    if (Object.keys(failMap).length > 0) {
      const failedNames = Object.keys(failMap)
        .slice(0, 5)
        .map((id) => originals.find((o) => o.id === id)?.name ?? id)
        .join("、");
      message.error(
        `处理失败 ${Object.keys(failMap).length} 张：${failedNames}${
          Object.keys(failMap).length > 5 ? " 等" : ""
        }`,
      );
    }
    if (succeeded.length === 0 && Object.keys(failMap).length === 0 && skipped === 0) {
      message.warning("没有可处理的图片");
    }
    // 新结果 render 完成后再释放旧 URL
    setTimeout(
      () => oldResultUrls.forEach((r) => URL.revokeObjectURL(r.url)),
      0,
    );
  };

  /**
   * 性能优化：HeaderBar / ToolPanel / ImagePanel 均用 React.memo 包裹，
   * 这里把传给它们的回调包成"身份永远稳定"的转发器（每次渲染把最新的
   * handleProcess / handleDelete 等闭包写进 latestHandlersRef）。
   * 这样拖动大小滑块、调字距等顶层状态变化时，不会因为内联回调重建而
   * 使子组件 memo 失效，长列表 / 面板得以跳过整树重渲染；转发器读的又
   * 始终是最新闭包，不会出现过期状态。
   */
  const latestHandlersRef = useRef({
    process: handleProcess,
    exportSingle: handleExportSingle,
    exportAll: handleExportAll,
    exportItem: handleExportItem,
    cropApply: handleCropApply,
    watermarkPos: handleWatermarkPositionChange,
    watermarkScale: handleWatermarkScaleChange,
    removeWatermark: handleRemoveWatermark,
    datetimeChange: handleDatetimeChange,
    geoInfoChange: handleGeoInfoChange,
    deleteOne: handleDelete,
    tabChange: handleTabChange,
    selectOne: handleSelect,
    watermarkCurrent: handleWatermarkCurrent,
    selectPreset: handleSelectPreset,
    deletePreset: handleDeletePreset,
    editPreset: handleEditPreset,
    makeIndependent: handleMakeIndependent,
    followGlobal: handleResetImageScope,
  });
  latestHandlersRef.current = {
    process: handleProcess,
    exportSingle: handleExportSingle,
    exportAll: handleExportAll,
    exportItem: handleExportItem,
    cropApply: handleCropApply,
    watermarkPos: handleWatermarkPositionChange,
    watermarkScale: handleWatermarkScaleChange,
    removeWatermark: handleRemoveWatermark,
    datetimeChange: handleDatetimeChange,
    geoInfoChange: handleGeoInfoChange,
    deleteOne: handleDelete,
    tabChange: handleTabChange,
    selectOne: handleSelect,
    watermarkCurrent: handleWatermarkCurrent,
    selectPreset: handleSelectPreset,
    deletePreset: handleDeletePreset,
    editPreset: handleEditPreset,
    makeIndependent: handleMakeIndependent,
    followGlobal: handleResetImageScope,
  };

  const runProcess = useCallback(() => {
    void latestHandlersRef.current.process();
  }, []);
  const runExportSingle = useCallback(() => {
    void latestHandlersRef.current.exportSingle();
  }, []);
  const runExportAll = useCallback(() => {
    void latestHandlersRef.current.exportAll();
  }, []);
  const runExportItem = useCallback((item: PhotoItem) => {
    void latestHandlersRef.current.exportItem(item);
  }, []);
  const runCropApply = useCallback(
    (result: { url: string; size: number; width: number; height: number }) => {
      latestHandlersRef.current.cropApply(result);
    },
    [],
  );
  const runWatermarkPositionChange = useCallback(
    (id: string, orientation: WatermarkOrientation, pos: WatermarkPosition) => {
      latestHandlersRef.current.watermarkPos(id, orientation, pos);
    },
    [],
  );
  const runWatermarkScaleChange = useCallback(
    (id: string, orientation: WatermarkOrientation, scale: number) => {
      latestHandlersRef.current.watermarkScale(id, orientation, scale);
    },
    [],
  );
  const runRemoveWatermark = useCallback((presetId: string) => {
    latestHandlersRef.current.removeWatermark(presetId);
  }, []);
  const runDatetimeChange = useCallback(
    (id: string, values: DatetimeLogoValues) => {
      latestHandlersRef.current.datetimeChange(id, values);
    },
    [],
  );
  const runGeoInfoChange = useCallback(
    (id: string, values: GeoInfoLogoValues) => {
      latestHandlersRef.current.geoInfoChange(id, values);
    },
    [],
  );
  const runDelete = useCallback((mainId: string, scope: "origin" | "result") => {
    latestHandlersRef.current.deleteOne(mainId, scope);
  }, []);
  const runTabChange = useCallback((tab: PanelTab) => {
    latestHandlersRef.current.tabChange(tab);
  }, []);
  const runSelect = useCallback((mainId: string) => {
    latestHandlersRef.current.selectOne(mainId);
  }, []);
  const runWatermarkCurrent = useCallback(() => {
    latestHandlersRef.current.watermarkCurrent();
  }, []);
  const runSelectPreset = useCallback((preset: WatermarkPreset) => {
    latestHandlersRef.current.selectPreset(preset);
  }, []);
  const runDeletePreset = useCallback((preset: WatermarkPreset) => {
    latestHandlersRef.current.deletePreset(preset);
  }, []);
  const runEditPreset = useCallback((preset: WatermarkPreset) => {
    latestHandlersRef.current.editPreset(preset);
  }, []);
  const runMakeIndependent = useCallback(() => {
    latestHandlersRef.current.makeIndependent();
  }, []);
  const runFollowGlobal = useCallback(() => {
    latestHandlersRef.current.followGlobal();
  }, []);

  /** 预览空态（区分“还没图 / 还没处理 / 处理失败”等场景） */
  const previewEmpty = useMemo(() => {
    if (currentImage) return null;
    if (activeTab === "processed") {
      if (originals.length === 0) {
        return {
          title: "还没有原图",
          text: "先在右侧「原图」中批量添加或拖入图片，再来这里查看处理结果",
        };
      }
      if (currentOrigin) {
        const failedReason = failures[currentOrigin.id];
        if (currentOrigin.id in processed && failedReason) {
          return {
            title: `「${currentOrigin.name}」处理失败`,
            text: `原因：${failedReason}。可调整水印后重新点击「开始处理」。`,
          };
        }
        return {
          title: `「${currentOrigin.name}」还没有处理结果`,
          text: "确认已选择水印预设并「应用到图片」后，点击上方「开始处理」生成结果",
        };
      }
    }
    if (activeTab === "origin" && originals.length === 0) {
      return {
        title: "开始你的第一批照片",
        text: "点击左侧/顶部的「添加图片」，或直接把照片拖进窗口；选好水印后点击「开始处理」",
      };
    }
    return null;
  }, [currentImage, activeTab, originals, currentOrigin, processed, failures]);

  /** 作用范围描述（ToolPanel 顶部提示） */
  const followCount = originals.filter((o) => !(o.id in imagePlans)).length;
  const scopeNote =
    editingTarget === "image"
      ? `正在编辑「${currentOrigin?.name ?? "当前图片"}」的水印，不影响其他图片`
      : currentOrigin
        ? `编辑全局默认方案；${followCount} 张未单独设置的图片将跟随`
        : "当前为全局默认方案";

  /**
   * 右栏「单独」标记的签名：只取决于有哪些图被单独设置（键集合）。
   * 编辑某张独立方案时 imagePlans 对象会每 tick 新建，但键集合不变，
   * 签名不变 → ImagePanel 的 memo 浅比较仍通过，避免列表跟着滑块重渲染。
   */
  const soloSignature = useMemo(
    () => Object.keys(imagePlans).join("\u0000"),
    [imagePlans],
  );

  /** ToolPanel 顶部作用范围提示（对象引用稳定，配合 memo） */
  const scopeInfo = useMemo(
    () => ({ hasImagePlan, label: scopeNote }),
    [hasImagePlan, scopeNote],
  );

  return (
    <div
      className="editor"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <HeaderBar
        onUploadClick={triggerUpload}
        onProcess={runProcess}
        processing={processing}
        exporting={exporting}
        adding={adding}
        onExportSingle={runExportSingle}
        canExport={exportList.length > 0}
        onWatermarkCurrent={runWatermarkCurrent}
      />

      <div className="editor-body">
        <ToolPanel
          presets={watermarkPresets}
          selectedPresetIds={editingPlan.presetIds}
          onSelectPreset={runSelectPreset}
          onDeletePreset={runDeletePreset}
          onEditPreset={runEditPreset}
          datetimeOverrides={datetimeOverrides}
          geoInfoOverrides={geoInfoOverrides}
          scopeInfo={scopeInfo}
          onMakeIndependent={runMakeIndependent}
          onFollowGlobal={runFollowGlobal}
        />
        <PreviewArea
          image={currentImage}
          imageIndex={currentImageIndex}
          onExport={runExportSingle}
          exporting={exporting}
          onCropApplied={runCropApply}
          watermarkPresets={currentEffectivePresets}
          watermarkEnabled={currentPlan.presetIds.length > 0 && activeTab !== "processed"}
          watermarkPositions={currentPlan.positions ?? {}}
          watermarkOrientation={watermarkOrientation}
          onWatermarkOrientationChange={setWatermarkOrientation}
          onWatermarkPositionChange={runWatermarkPositionChange}
          watermarkScales={currentPlan.scales ?? {}}
          onWatermarkScaleChange={runWatermarkScaleChange}
          timeDigitSpacing={timeDigitSpacing}
          onTimeDigitSpacingChange={setTimeDigitSpacing}
          dateDigitSpacing={dateDigitSpacing}
          onDateDigitSpacingChange={setDateDigitSpacing}
          onRemoveWatermark={runRemoveWatermark}
          onWatermarkDatetimeChange={runDatetimeChange}
          onWatermarkGeoInfoChange={runGeoInfoChange}
          emptyTitle={previewEmpty?.title ?? null}
          emptyText={previewEmpty?.text ?? null}
        />
        <ImagePanel
          originals={originals}
          processed={processed}
          failures={failures}
          currentId={currentId}
          activeTab={activeTab}
          processing={processing}
          exporting={exporting}
          adding={adding}
          soloSignature={soloSignature}
          onTabChange={runTabChange}
          onSelect={runSelect}
          onDelete={runDelete}
          onAdd={triggerUpload}
          onProcess={runProcess}
          onExportAll={runExportAll}
          onExportOne={runExportItem}
        />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          handleFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />

      {/* 水印应用范围弹窗 */}
      <Modal
        title="将当前水印应用到"
        open={scopeModalOpen}
        onOk={handleApplyScope}
        onCancel={() => setScopeModalOpen(false)}
        okText="应用"
        cancelText="取消"
        width={460}
      >
        <div className="scope-modal">
          <p className="scope-modal-tip">
            当前生效方案：
            {currentEffectivePresets.map((p) => p.name).join(" + ") || "（未选预设）"}
          </p>
          <Radio.Group
            value={scopeMode}
            onChange={(e) => setScopeMode(e.target.value as ScopeMode)}
            className="scope-radio-group"
          >
            <Radio value="all">
              <span className="scope-radio-label">应用到所有图片</span>
              <span className="scope-radio-desc">
                作为全局默认方案；已单独设置的图片不受影响
              </span>
            </Radio>
            <Radio value="current">
              <span className="scope-radio-label">仅应用到当前图片</span>
              <span className="scope-radio-desc">
                单独设置，后续调整不影响其他图片
              </span>
            </Radio>
            {originals.length > 1 && (
              <Radio value="selected">
                <span className="scope-radio-label">应用到选中的多张图片</span>
              </Radio>
            )}
          </Radio.Group>
          {scopeMode === "selected" && (
            <div className="scope-image-list">
              <Checkbox.Group
                value={scopeSelectedIds}
                onChange={(vals) =>
                  setScopeSelectedIds(vals as string[])
                }
              >
                {originals.map((o) => (
                  <Checkbox key={o.id} value={o.id} className="scope-image-item">
                    <img
                      src={o.thumbUrl ?? o.url}
                      alt=""
                      className="scope-image-thumb"
                      loading="lazy"
                    />
                    <span className="scope-image-name" title={o.name}>
                      {o.name}
                    </span>
                    {o.id in imagePlans && <span className="scope-image-tag">单独</span>}
                  </Checkbox>
                ))}
              </Checkbox.Group>
            </div>
          )}
        </div>
      </Modal>

      {dragActive && (
        <div className="drag-overlay">
          <div className="drag-overlay-inner">
            <CloudUploadOutlined className="drag-overlay-icon" />
            <div className="drag-overlay-title">松开鼠标，上传图片</div>
            <div className="drag-overlay-sub">支持批量拖入多张图片</div>
          </div>
        </div>
      )}
    </div>
  );
}

export default EditorLayout;
