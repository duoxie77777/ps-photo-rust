/**
 * 裁剪 / 旋转 / 翻转 的像素管线。
 *
 * 设计要点：
 * - 「旋转/镜像」会先把原图一次性重绘为一张方向正确的**中间底座**（该图同时用于
 *   裁剪画布显示），几何完全一致，百分比坐标直接映射到中间底座的像素，无偏移风险；
 * - 「应用裁剪」时对中间底座做 1:1 区域复制，输出格式规则与 composeWatermark 一致
 *   （.png 保留 PNG，其余按 JPEG 0.92）。
 * - 中间底座每次从原图重新生成（旋转状态变更时），不会反复编码累积损耗。
 */

/** 顺时针旋转角度 */
export type RotateDeg = 0 | 90 | 180 | 270;

/** 相对原图的变换：镜像作用于“用户当前看到的方向”的对应轴，再叠加旋转 */
export interface ImageTransform {
  rotate: RotateDeg;
  flipH: boolean;
  flipV: boolean;
}

export const IDENTITY_TRANSFORM: ImageTransform = { rotate: 0, flipH: false, flipV: false };

/** 像素矩形（x/y 为左上角） */
export interface CropRectPx {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 输出结果 */
export interface CropResult {
  url: string;
  size: number;
  width: number;
  height: number;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = url;
  });
}

/** 与 composeWatermark 相同的输出格式规则：.png → PNG，其余 → JPEG */
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
      quality,
    );
  });
}

/** 超大图保护上限（与 composeWatermark 的 MAX 一致） */
const MAX_DIM = 8192;

/** 变换后的完整尺寸（旋转 90°/270° 时宽高互换；镜像不改变尺寸） */
export function transformDims(
  baseW: number,
  baseH: number,
  t: ImageTransform,
): { width: number; height: number } {
  return t.rotate % 180 === 0
    ? { width: baseW, height: baseH }
    : { width: baseH, height: baseW };
}

/** 是否什么都没做（无旋转/镜像） */
export function isIdentity(t: ImageTransform): boolean {
  return t.rotate === 0 && !t.flipH && !t.flipV;
}

/** 二维线性矩阵（列主序，正交 90°/镜像群） */
type M2 = [[number, number], [number, number]];

const M_ID: M2 = [
  [1, 0],
  [0, 1],
];
/** 顺时针旋转 90°： (x,y) -> (-y, x) */
const M_ROT90: M2 = [
  [0, -1],
  [1, 0],
];
/** 关于垂直轴镜像（左右翻转）： x -> -x */
const M_FLIP_H: M2 = [
  [-1, 0],
  [0, 1],
];
/** 关于水平轴镜像（上下翻转）： y -> -y */
const M_FLIP_V: M2 = [
  [1, 0],
  [0, -1],
];

function matMul(a: M2, b: M2): M2 {
  return [
    [
      a[0][0] * b[0][0] + a[0][1] * b[1][0],
      a[0][0] * b[0][1] + a[0][1] * b[1][1],
    ],
    [
      a[1][0] * b[0][0] + a[1][1] * b[1][0],
      a[1][0] * b[0][1] + a[1][1] * b[1][1],
    ],
  ];
}

function matEq(a: M2, b: M2): boolean {
  return (
    a[0][0] === b[0][0] &&
    a[0][1] === b[0][1] &&
    a[1][0] === b[1][0] &&
    a[1][1] === b[1][1]
  );
}

/** 变换对应的线性矩阵：先镜像（作用于原图坐标）再旋转 */
function transformToMatrix(t: ImageTransform): M2 {
  let m: M2 = M_ID;
  if (t.flipV) m = matMul(m, M_FLIP_V);
  if (t.flipH) m = matMul(m, M_FLIP_H);
  const times = (t.rotate / 90) % 4;
  for (let i = 0; i < times; i++) m = matMul(M_ROT90, m);
  return m;
}

/** 由矩阵反解回规范形态（群中表示唯一） */
function matrixToTransform(m: M2): ImageTransform {
  for (const rotate of [0, 90, 180, 270] as const) {
    for (const flipH of [false, true]) {
      for (const flipV of [false, true]) {
        const t: ImageTransform = { rotate, flipH, flipV };
        if (matEq(transformToMatrix(t), m)) return t;
      }
    }
  }
  return IDENTITY_TRANSFORM;
}

type DisplayOp = "rotateCW" | "flipH" | "flipV";

/**
 * 在“显示坐标”（用户当前看到的画面）上施加一个操作并返回新的变换。
 * 例：用户点“水平翻转”，镜像的是屏幕上所见的左右方向——不受此前旋转状态干扰。
 */
export function applyDisplayOp(t: ImageTransform, op: DisplayOp): ImageTransform {
  const opMat: M2 =
    op === "rotateCW" ? M_ROT90 : op === "flipH" ? M_FLIP_H : M_FLIP_V;
  return matrixToTransform(matMul(opMat, transformToMatrix(t)));
}

/** 旋转 180°（等价于连续两次顺时针旋转） */
export function applyRotateHalf(t: ImageTransform): ImageTransform {
  return matrixToTransform(matMul(M_ROT90, matMul(M_ROT90, transformToMatrix(t))));
}

/** 把整幅原图按变换绘制到画布并返回新画布（统一走此入口，保证方向一致） */
function paintTransform(img: HTMLImageElement, t: ImageTransform): HTMLCanvasElement {
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const dims = transformDims(W, H, t);
  let cw = dims.width;
  let ch = dims.height;

  // 超大图保护：等比缩小
  if (Math.max(cw, ch) > MAX_DIM) {
    const s = MAX_DIM / Math.max(cw, ch);
    cw = Math.round(cw * s);
    ch = Math.round(ch * s);
  }

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布");

  // 把原图旋转/镜像到画布：先按原图坐标镜像，再整体旋转（与 transformToMatrix 一致）
  ctx.save();
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate((t.rotate * Math.PI) / 180);
  ctx.scale(t.flipH ? -1 : 1, t.flipV ? -1 : 1);
  ctx.drawImage(img, 0, 0, W, H, -cw / 2, -ch / 2, cw, ch);
  ctx.restore();
  return canvas;
}

/**
 * 生成“当前方向”的中间底座：原图按 transform 旋转/镜像后的整幅图。
 * transform 为恒等时直接复用原图 url（不编码）。
 * 每次旋转/镜像都从原图重算，编码不会层层累积。
 */
export async function makeWorkingImage(
  baseUrl: string,
  name: string,
  t: ImageTransform,
): Promise<{ url: string; width: number; height: number }> {
  if (isIdentity(t)) {
    const img = await loadImage(baseUrl);
    return { url: baseUrl, width: img.naturalWidth, height: img.naturalHeight };
  }
  const img = await loadImage(baseUrl);
  const canvas = paintTransform(img, t);
  const mime = pickMime(name);
  // 底座尽量保真（JPEG 0.95），避免中间损耗在最终 JPEG 编码时放大
  const blob = await canvasToBlob(canvas, mime, mime === "image/jpeg" ? 0.95 : undefined);
  return {
    url: URL.createObjectURL(blob),
    width: canvas.width,
    height: canvas.height,
  };
}

/**
 * 对“底座”（当前方向图）做最终 1:1 裁剪。
 * 底座尺寸可能因 MAX_DIM 保护而被等比缩小，裁剪框坐标按底座自身像素计算即可。
 */
export async function applyFinalCrop(
  workingUrl: string,
  name: string,
  rect: CropRectPx,
): Promise<CropResult> {
  const img = await loadImage(workingUrl);
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  if (W === 0 || H === 0) throw new Error("图片尺寸无效");

  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const x0 = clamp(Math.floor(rect.x), 0, W - 1);
  const y0 = clamp(Math.floor(rect.y), 0, H - 1);
  const w = Math.max(1, Math.min(Math.round(rect.width), W - x0));
  const h = Math.max(1, Math.min(Math.round(rect.height), H - y0));

  // 超大图保护：输出超限时等比缩小（与 composeWatermark 一致）
  let outW = w;
  let outH = h;
  if (Math.max(w, h) > MAX_DIM) {
    const s = MAX_DIM / Math.max(w, h);
    outW = Math.round(w * s);
    outH = Math.round(h * s);
  }

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布");
  ctx.drawImage(img, x0, y0, w, h, 0, 0, outW, outH);

  const mime = pickMime(name);
  const blob = await canvasToBlob(canvas, mime, mime === "image/jpeg" ? 0.92 : undefined);
  const url = URL.createObjectURL(blob);
  return { url, size: blob.size, width: w, height: h };
}
