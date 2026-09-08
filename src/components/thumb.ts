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
