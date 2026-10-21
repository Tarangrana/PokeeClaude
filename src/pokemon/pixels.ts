/**
 * Tiny RGBA image toolkit. Pokémon sprites are pixel art, so everything here
 * is nearest-neighbour and works on plain byte buffers (no canvas needed).
 */

export interface Image {
  readonly width: number;
  readonly height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  readonly data: Uint8Array;
}

export function blank(width: number, height: number): Image {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

/** Smallest box containing any visible pixel across all frames. */
export function unionBounds(frames: readonly Image[], alphaThreshold = 8) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  for (const img of frames) {
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        if ((img.data[(y * img.width + x) * 4 + 3] ?? 0) > alphaThreshold) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, width: frames[0]?.width ?? 0, height: frames[0]?.height ?? 0 };
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function crop(img: Image, box: { x: number; y: number; width: number; height: number }): Image {
  const out = blank(box.width, box.height);
  for (let y = 0; y < box.height; y++) {
    const from = ((box.y + y) * img.width + box.x) * 4;
    out.data.set(img.data.subarray(from, from + box.width * 4), y * box.width * 4);
  }
  return out;
}

/** Nearest-neighbour resize with independent x/y factors. */
export function scale(img: Image, sx: number, sy = sx): Image {
  const width = Math.max(1, Math.round(img.width * sx));
  const height = Math.max(1, Math.round(img.height * sy));
  const out = blank(width, height);
  for (let y = 0; y < height; y++) {
    const srcY = Math.min(img.height - 1, Math.floor(y / sy));
    for (let x = 0; x < width; x++) {
      const srcX = Math.min(img.width - 1, Math.floor(x / sx));
      const s = (srcY * img.width + srcX) * 4;
      const d = (y * width + x) * 4;
      out.data[d] = img.data[s]!;
      out.data[d + 1] = img.data[s + 1]!;
      out.data[d + 2] = img.data[s + 2]!;
      out.data[d + 3] = img.data[s + 3]!;
    }
  }
  return out;
}

export function flipX(img: Image): Image {
  const out = blank(img.width, img.height);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const s = (y * img.width + x) * 4;
      const d = (y * img.width + (img.width - 1 - x)) * 4;
      out.data.set(img.data.subarray(s, s + 4), d);
    }
  }
  return out;
}

/** Rotate around the image centre; the canvas grows to fit. */
export function rotate(img: Image, degrees: number): Image {
  if (degrees === 0) return img;
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const width = Math.ceil(Math.abs(img.width * cos) + Math.abs(img.height * sin));
  const height = Math.ceil(Math.abs(img.width * sin) + Math.abs(img.height * cos));
  const out = blank(width, height);
  const cx = img.width / 2;
  const cy = img.height / 2;
  const ox = width / 2;
  const oy = height / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x + 0.5 - ox;
      const dy = y + 0.5 - oy;
      const srcX = Math.floor(cos * dx + sin * dy + cx);
      const srcY = Math.floor(-sin * dx + cos * dy + cy);
      if (srcX < 0 || srcY < 0 || srcX >= img.width || srcY >= img.height) continue;
      const s = (srcY * img.width + srcX) * 4;
      out.data.set(img.data.subarray(s, s + 4), (y * width + x) * 4);
    }
  }
  return out;
}

/** Wash colours out toward a cool grey: used for the "failed" row. */
export function desaturate(img: Image, amount = 0.75, tint: [number, number, number] = [120, 130, 170]): Image {
  const out = { ...img, data: new Uint8Array(img.data) };
  for (let i = 0; i < out.data.length; i += 4) {
    const r = out.data[i]!;
    const g = out.data[i + 1]!;
    const b = out.data[i + 2]!;
    const grey = 0.3 * r + 0.59 * g + 0.11 * b;
    out.data[i] = Math.round(r * (1 - amount) + ((grey + tint[0]) / 2) * amount);
    out.data[i + 1] = Math.round(g * (1 - amount) + ((grey + tint[1]) / 2) * amount);
    out.data[i + 2] = Math.round(b * (1 - amount) + ((grey + tint[2]) / 2) * amount);
  }
  return out;
}

/**
 * Alpha-blend `src` onto `dst` at (x, y), clipped to the clip rectangle so a
 * sprite can never bleed into a neighbouring atlas cell.
 */
export function blit(dst: Image, src: Image, x: number, y: number, clip = { x: 0, y: 0, width: dst.width, height: dst.height }): void {
  const x0 = Math.max(clip.x, x);
  const y0 = Math.max(clip.y, y);
  const x1 = Math.min(clip.x + clip.width, x + src.width);
  const y1 = Math.min(clip.y + clip.height, y + src.height);
  for (let dy = y0; dy < y1; dy++) {
    for (let dx = x0; dx < x1; dx++) {
      const s = ((dy - y) * src.width + (dx - x)) * 4;
      const a = src.data[s + 3]! / 255;
      if (a === 0) continue;
      const d = (dy * dst.width + dx) * 4;
      const da = dst.data[d + 3]! / 255;
      const outA = a + da * (1 - a);
      for (let c = 0; c < 3; c++) {
        const blended = (src.data[s + c]! * a + dst.data[d + c]! * da * (1 - a)) / outA;
        dst.data[d + c] = Math.round(blended);
      }
      dst.data[d + 3] = Math.round(outA * 255);
    }
  }
}

/** Pick `count` frames spread evenly across an animation. */
export function sampleFrames<T>(frames: readonly T[], count: number, offset = 0): T[] {
  if (frames.length === 0) return [];
  // Short loops (e.g. a 2-frame walk) cycle instead of holding each frame.
  if (frames.length <= count) return Array.from({ length: count }, (_, i) => frames[(i + offset) % frames.length]!);
  return Array.from({ length: count }, (_, i) => frames[Math.floor(((i + offset) * frames.length) / count) % frames.length]!);
}
