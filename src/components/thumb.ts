/**
 * 生成图片缩略图（最长边 maxEdge，webp/jpeg），返回 objectURL。
 * - 输入：File / Blob / 图片 objectURL（如裁剪后的新图）
 * - 作用：右侧列表卡片只展示小图，避免一次性解码大量全尺寸大图导致的卡顿与内存暴涨。
 * 解码失败等情况返回 null（调用方保持原样即可，不会抛异常）。
 */
export async function createThumbUrl(
  source: Blob | string,
  maxEdge = 480,
): Promise<string | null> {
  let bitmap: ImageBitmap;
  try {
    if (typeof source === "string") {
      const img = new Image();
      img.decoding = "async";
      img.src = source;
      await img.decode();
      // 显式声明按 EXIF 方向解码，与 <img> 渲染方向保持一致
      bitmap = await createImageBitmap(img, { imageOrientation: "from-image" });
    } else {
      bitmap = await createImageBitmap(source, { imageOrientation: "from-image" });
    }
  } catch {
    return null;
  }

  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return null;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    // 优先 webp（保留透明）；不支持时退回 jpeg
    const candidates: Array<{ type: string; quality?: number }> = [
      { type: "image/webp", quality: 0.82 },
      { type: "image/jpeg", quality: 0.85 },
    ];
    for (const { type, quality } of candidates) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, type, quality),
      );
      if (blob) return URL.createObjectURL(blob);
    }
    return null;
  } catch {
    return null;
  }
}

/** 一次解码生成“缩略图 + 预览大图”，并回传原图真实像素尺寸。
 *
 * 背景：预览区之前每次都直接解码全尺寸原图来显示/合成，超大照片（尤其叠加多个
 * 水印时）一次就能把 WebView2 主线程打满、表现为“点击原图后卡死”。
 * 这里在导入/生成时对同一张原图只完整解码一次，同时产出：
 * - thumbUrl：右栏卡片小图（约 480px）
 * - displayUrl：预览区显示与预览合成用的降采样大图（约 2048px）
 * 导出与批量处理仍然使用全尺寸原图 url，不受影响。
 */
export async function createThumbAndDisplay(
  source: Blob | string,
  thumbMax = 480,
  displayMax = 2048,
): Promise<{
  thumbUrl: string | null;
  displayUrl: string | null;
  width: number;
  height: number;
}> {
  let bitmap: ImageBitmap;
  try {
    if (typeof source === "string") {
      const img = new Image();
      img.decoding = "async";
      img.src = source;
      await img.decode();
      // 显式声明按 EXIF 方向解码，与 <img> 渲染方向保持一致
      bitmap = await createImageBitmap(img, { imageOrientation: "from-image" });
    } else {
      bitmap = await createImageBitmap(source, { imageOrientation: "from-image" });
    }
  } catch {
    return { thumbUrl: null, displayUrl: null, width: 0, height: 0 };
  }

  const width = bitmap.width;
  const height = bitmap.height;
  try {
    const encodeScaled = async (maxEdge: number): Promise<string | null> => {
      const scale = Math.min(1, maxEdge / Math.max(width, height));
      const w = Math.max(1, Math.round(width * scale));
      const h = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, w, h);
      const candidates: Array<{ type: string; quality?: number }> = [
        { type: "image/webp", quality: 0.88 },
        { type: "image/jpeg", quality: 0.9 },
      ];
      for (const { type, quality } of candidates) {
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, type, quality),
        );
        if (blob) return URL.createObjectURL(blob);
      }
      return null;
    };

    const thumbUrl = await encodeScaled(thumbMax);
    const displayUrl = await encodeScaled(displayMax);
    return { thumbUrl, displayUrl, width, height };
  } catch {
    return { thumbUrl: null, displayUrl: null, width, height };
  } finally {
    bitmap.close();
  }
}
