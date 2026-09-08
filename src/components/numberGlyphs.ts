import n0 from "../assets/0.png";
import n1 from "../assets/1.png";
import n2 from "../assets/2.png";
import n3 from "../assets/3.png";
import n4 from "../assets/4.png";
import n5 from "../assets/5.png";
import n6 from "../assets/6.png";
import n7 from "../assets/7.png";
import n8 from "../assets/8.png";
import n9 from "../assets/9.png";

/** 0-9 数字字形图（等宽 240×280，白色粗体、透明背景），供预览 DOM 直接引用 */
export const NUMBER_GLYPH_SRC: Record<string, string> = {
  "0": n0,
  "1": n1,
  "2": n2,
  "3": n3,
  "4": n4,
  "5": n5,
  "6": n6,
  "7": n7,
  "8": n8,
  "9": n9,
};

const isDigitChar = (ch: string) => /^[0-9]$/.test(ch);

/** 取字符串里的数字字符集合（去重，保持出现顺序），用于按需加载 */
export function digitCharsOf(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ch of text) {
    if (isDigitChar(ch) && !seen.has(ch)) {
      seen.add(ch);
      out.push(ch);
    }
  }
  return out;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`数字字形加载失败: ${url}`));
    img.src = url;
  });
}

/** 数字字形解码缓存：批量合成时每张图只 decode 一次 */
const glyphCache = new Map<string, Promise<HTMLImageElement>>();

/** 加载单个数字字形（0-9）；重复调用命中缓存 */
export function loadNumberGlyph(digit: string): Promise<HTMLImageElement> {
  const src = NUMBER_GLYPH_SRC[digit];
  if (!src) return Promise.reject(new Error(`不支持的字符: ${digit}`));
  let p = glyphCache.get(digit);
  if (!p) {
    p = loadImage(src);
    glyphCache.set(digit, p);
  }
  return p;
}
