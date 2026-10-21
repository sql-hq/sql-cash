// Canvas2D recreation of the "MASK" ASCII/dither look: the SQL logo is sampled on a 14px grid,
// drawn as ordered-dither cells in green, then layered with bloom, chromatic split, scanlines,
// vignette, film grain, glitch slices and a flicker animation.
import { useEffect, useRef } from 'react';

const P = {
  cellSize: 14, coverage: 96, contrast: 115, edgeEmphasis: 40, tint: [0, 255, 102] as const, tintOpacity: 45,
  bg: '#000', bgOpacity: 90,
  pfx: { vignette: 38, scanLines: 28, chromatic: 40, bloom: 60, filmGrain: 40, glitch: 20 },
  animSpeed: 100, animIntensity: 60,
};
const LOGO: [number, number, number, number][] = [[434,312,81,83],[739,312,80,83],[343,404,91,246],[819,404,92,244],[271,640,78,82],[906,640,78,82],[344,722,91,216],[819,722,92,216],[436,940,77,76],[741,940,77,76],[514,490,75,75],[665,490,75,75],[509,639,235,83]];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);

/** Source "photo": the logo with a soft light falloff, so luminance has real gradients to dither. */
function drawSource(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  const halo = ctx.createRadialGradient(w / 2, h * 0.48, 0, w / 2, h * 0.48, Math.max(w, h) * 0.55);
  halo.addColorStop(0, 'rgba(255,255,255,0.22)'); halo.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = halo; ctx.fillRect(0, 0, w, h);
  const size = Math.min(w, h) * 0.78, s = size / 724, ox = (w - size) / 2 - 266 * s, oy = (h - size) / 2 - 304 * s;
  const light = ctx.createLinearGradient(0, oy + 304 * s, 0, oy + 1028 * s);
  light.addColorStop(0, '#fff'); light.addColorStop(1, '#8a8a8a');
  ctx.fillStyle = light;
  for (const [x, y, rw, rh] of LOGO) ctx.fillRect(ox + x * s, oy + y * s, rw * s, rh * s);
}

const hash = (i: number) => { let x = (i * 2654435761) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; return (x >>> 0) / 4294967295; };

export function AsciiMask({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!; const ctx = canvas.getContext('2d')!;
    const src = document.createElement('canvas'); const sctx = src.getContext('2d', { willReadFrequently: true })!;
    const layer = document.createElement('canvas'); const lctx = layer.getContext('2d')!;
    const grain = document.createElement('canvas'); grain.width = grain.height = 128; const gctx = grain.getContext('2d')!;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let lum: Float32Array = new Float32Array(0), cols = 0, rows = 0, w = 0, h = 0, dpr = 1, raf = 0, last = 0, visible = true;

    const resize = () => {
      const rect = canvas.parentElement!.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.max(200, Math.floor(rect.width)); h = Math.max(200, Math.floor(rect.height));
      for (const c of [canvas, layer]) { c.width = w * dpr; c.height = h * dpr; }
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      src.width = w; src.height = h; drawSource(sctx, w, h);
      // Sample average luminance per cell, apply contrast, then add edge emphasis (Sobel on the cell grid).
      cols = Math.ceil(w / P.cellSize); rows = Math.ceil(h / P.cellSize);
      const data = sctx.getImageData(0, 0, w, h).data; const base = new Float32Array(cols * rows);
      for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
        let sum = 0, n = 0;
        for (let y = cy * P.cellSize; y < Math.min(h, (cy + 1) * P.cellSize); y += 2) for (let x = cx * P.cellSize; x < Math.min(w, (cx + 1) * P.cellSize); x += 2) {
          const i = (y * w + x) * 4; sum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255; n++;
        }
        const v = n ? sum / n : 0; base[cy * cols + cx] = Math.min(1, Math.max(0, (v - 0.5) * (P.contrast / 100) + 0.5));
      }
      lum = new Float32Array(cols * rows);
      const at = (x: number, y: number) => base[Math.min(rows - 1, Math.max(0, y)) * cols + Math.min(cols - 1, Math.max(0, x))];
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
        const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
        lum[y * cols + x] = Math.min(1, base[y * cols + x] + Math.hypot(gx, gy) * (P.edgeEmphasis / 100) * 0.5);
      }
    };

    const drawDither = (t: number) => {
      const c = lctx; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
      const sub = P.cellSize / 4, flick = P.animIntensity / 100;
      const frame = Math.floor(t / (1000 / (6 + P.animSpeed / 10)));
      const [r, g, b] = P.tint;
      for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
        const id = cy * cols + cx;
        if (hash(id) * 100 > P.coverage) continue;
        let v = lum[id];
        if (!reduce) { const f = hash(id * 31 + frame); if (f > 0.985) v *= 1 - flick; else if (f < 0.01) v = Math.min(1, v + flick * 0.5); }
        if (v < 0.03) continue;
        // Tint mixes the luminance-white with green at tintOpacity (overlay-like: brights stay bright).
        const k = P.tintOpacity / 100, lr = 255 * v * (1 - k) + r * k * v, lg = 255 * v * (1 - k) + g * k * v, lb = 255 * v * (1 - k) + b * k * v;
        c.fillStyle = `rgb(${lr | 0},${Math.min(255, lg * 1.15) | 0},${lb | 0})`;
        for (let j = 0; j < 16; j++) if (v > BAYER[j]) c.fillRect(cx * P.cellSize + (j & 3) * sub, cy * P.cellSize + (j >> 2) * sub, sub - 0.6, sub - 0.6);
      }
    };

    const refreshGrain = () => {
      const img = gctx.createImageData(128, 128);
      for (let i = 0; i < img.data.length; i += 4) { const n = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = n; img.data[i + 3] = 255 * (P.pfx.filmGrain / 100) * 0.35; }
      gctx.putImageData(img, 0, 0);
    };

    const render = (t: number) => {
      drawDither(t);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = P.bgOpacity / 100; ctx.fillStyle = P.bg; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.globalAlpha = 1;
      // Chromatic aberration: red and blue ghosts offset either side of the main layer.
      const off = (P.pfx.chromatic / 100) * 3 * dpr;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35; ctx.filter = 'sepia(1) saturate(6) hue-rotate(-50deg)'; ctx.drawImage(layer, -off, 0);
      ctx.filter = 'sepia(1) saturate(6) hue-rotate(160deg)'; ctx.drawImage(layer, off, 0);
      ctx.filter = 'none'; ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(layer, 0, 0);
      // Bloom.
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (P.pfx.bloom / 100) * 0.7; ctx.filter = `blur(${8 * dpr}px)`; ctx.drawImage(layer, 0, 0);
      ctx.filter = 'none'; ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      // Glitch: occasional horizontal slice shifts.
      if (!reduce && Math.random() < (P.pfx.glitch / 100) * 0.25) {
        for (let i = 0; i < 3; i++) {
          const sh = (4 + Math.random() * 18) * dpr, sy = Math.random() * (canvas.height - sh), dx = (Math.random() - 0.5) * 30 * dpr * (P.pfx.glitch / 20);
          ctx.drawImage(canvas, 0, sy, canvas.width, sh, dx, sy, canvas.width, sh);
        }
      }
      // Scan lines.
      ctx.fillStyle = `rgba(0,0,0,${(P.pfx.scanLines / 100) * 0.9})`;
      for (let y = 0; y < canvas.height; y += 3 * dpr) ctx.fillRect(0, y, canvas.width, dpr);
      // Film grain.
      if (!reduce || t === 0) refreshGrain();
      ctx.globalCompositeOperation = 'overlay'; ctx.fillStyle = ctx.createPattern(grain, 'repeat')!; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.globalCompositeOperation = 'source-over';
      // Vignette.
      const vg = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) * 0.25, canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) * 0.72);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(0,0,0,${P.pfx.vignette / 100 * 2})`);
      ctx.fillStyle = vg; ctx.fillRect(0, 0, canvas.width, canvas.height);
    };

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || t - last < 1000 / 24) return; // ~24fps keeps the flicker filmic and cheap
      last = t; render(t);
    };
    resize(); render(0);
    const ro = new ResizeObserver(() => { resize(); render(performance.now()); }); ro.observe(canvas.parentElement!);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }); io.observe(canvas);
    if (!reduce) raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
  }, []);
  return <canvas ref={ref} className={className} aria-hidden />;
}
