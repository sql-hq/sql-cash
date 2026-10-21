import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import './frame-sequence-hero.css';

export type FrameSequenceStep = {
  from: number;
  to: number;
  color: string;
  num: string;
  total: string;
  icon?: React.ReactNode;
  title: string;
  description: string;
  label: string;
};

/** Draw one frame for scroll progress `p` (0..1) onto a canvas sized w×h CSS pixels. */
export type FrameRenderer = (ctx: CanvasRenderingContext2D, p: number, w: number, h: number) => void;

export type FrameSequenceHeroProps = {
  /** Image-sequence mode: number of frames and a 1-based path builder. */
  frameCount?: number;
  framePath?: (i: number) => string;
  eagerCount?: number;
  /** Canvas mode: draws each frame procedurally instead of loading images. */
  renderFrame?: FrameRenderer;
  scrollHeight?: string;
  brand?: React.ReactNode;
  navLinks?: { label: string; href: string }[];
  ctaLabel?: string;
  ctaHref?: string;
  title: React.ReactNode;
  subtitle?: string;
  steps: FrameSequenceStep[];
  className?: string;
};

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function FrameSequenceHero({
  frameCount = 1, framePath, eagerCount = 140, renderFrame, scrollHeight = '420vh',
  brand, navLinks = [], ctaLabel, ctaHref = '#', title, subtitle, steps, className,
}: FrameSequenceHeroProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const loadedRef = useRef(0);
  const targetRef = useRef(0);
  const displayRef = useRef(0);
  const lastShownRef = useRef(-1);
  const rafRef = useRef(false);
  const canvasMode = !!renderFrame;

  const [loadPct, setLoadPct] = useState(canvasMode ? 100 : 0);
  const [loaderDone, setLoaderDone] = useState(canvasMode);
  const [navScrolled, setNavScrolled] = useState(false);
  const [subHidden, setSubHidden] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [progress, setProgress] = useState(0);
  const [stepLocal, setStepLocal] = useState(0);
  const [currentSrc, setCurrentSrc] = useState(() => framePath?.(1) ?? '');

  const draw = (p: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !renderFrame) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderFrame(ctx, p, w, h);
  };

  const show = (value: number) => {
    if (canvasMode) { draw(value); return; }
    const i = Math.max(0, Math.min(frameCount - 1, Math.round(value)));
    if (i === lastShownRef.current || !framePath) return;
    setCurrentSrc(framePath(i + 1));
    lastShownRef.current = i;
  };

  const loop = () => {
    if (rafRef.current) return;
    rafRef.current = true;
    const tick = () => {
      const diff = targetRef.current - displayRef.current;
      const eps = canvasMode ? 0.0004 : 0.08;
      if (Math.abs(diff) < eps || reducedMotion()) displayRef.current = targetRef.current;
      else displayRef.current += diff * 0.2;
      show(displayRef.current);
      if (displayRef.current !== targetRef.current) requestAnimationFrame(tick);
      else rafRef.current = false;
    };
    requestAnimationFrame(tick);
  };

  useEffect(() => {
    if (canvasMode || !framePath) return;
    const eager = Math.min(eagerCount, frameCount);
    const loadOne = (i: number) => {
      const img = new Image();
      img.decoding = 'async';
      img.src = framePath(i + 1);
      const settle = () => {
        loadedRef.current += 1;
        setLoadPct(Math.round((loadedRef.current / frameCount) * 100));
        if (loadedRef.current === eager) {
          setLoaderDone(true);
          for (let j = eager; j < frameCount; j++) loadOne(j);
        }
      };
      img.onload = settle; img.onerror = settle;
    };
    for (let i = 0; i < eager; i++) loadOne(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameCount, eagerCount, canvasMode]);

  useEffect(() => {
    const onScroll = () => {
      const root = rootRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      const total = Math.max(1, rect.height - window.innerHeight);
      const p = Math.max(0, Math.min(1, -rect.top / total));
      targetRef.current = canvasMode ? p : p * (frameCount - 1);
      loop();
      setProgress(p);
      setNavScrolled(-rect.top > 4);
      setSubHidden(-rect.top > 8);
      let idx = -1, local = 0;
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        if (p >= s.from && p < s.to) { idx = i; local = (p - s.from) / (s.to - s.from); break; }
      }
      setActiveIdx(idx);
      setStepLocal(Math.max(0, Math.min(1, local)));
    };
    const onResize = () => { onScroll(); show(displayRef.current); };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    onScroll(); show(displayRef.current);
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onResize); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps, frameCount, canvasMode]);

  return (
    <div ref={rootRef} className={cx('fsh-root', className)}>
      {!canvasMode && <div aria-hidden className={cx('fsh-loader', loaderDone && 'fsh-loader-done')}>
        <div className="fsh-loader-text">{loadPct < 100 ? `Loading · ${loadPct}%` : 'Ready'}</div>
        <div className="fsh-loader-track"><span className="fsh-loader-fill" style={{ width: `${loadPct}%` }} /></div>
      </div>}

      <div className="fsh-stage">
        <nav className={cx('fsh-nav', navScrolled && 'fsh-nav-scrolled')} aria-label="Primary">
          <div className="fsh-brand">{brand}</div>
          {navLinks.length > 0 && <div className="fsh-nav-links">{navLinks.map(l => <a key={l.label} href={l.href}>{l.label}</a>)}</div>}
          {ctaLabel && <a href={ctaHref} className="fsh-cta">{ctaLabel}</a>}
        </nav>

        <div className="fsh-canvas-wrap">
          {canvasMode
            ? <canvas ref={canvasRef} className="fsh-canvas" aria-hidden />
            : <img src={currentSrc} alt="" className="fsh-canvas" draggable={false} />}
        </div>

        <div className="fsh-copy">
          <h1 className="fsh-title">{title}</h1>
          {subtitle && <p className={cx('fsh-sub', subHidden && 'fsh-sub-hidden')}>{subtitle}</p>}
        </div>

        <div className="fsh-cards">
          {steps.map((s, i) => {
            const isActive = activeIdx === i;
            const isPrev = activeIdx >= 0 && i < activeIdx;
            return (
              <article key={i} style={{ ['--c' as string]: s.color } as React.CSSProperties}
                className={cx('fsh-card', isActive && 'fsh-card-active', isPrev && 'fsh-card-prev')} aria-hidden={!isActive}>
                <div className="fsh-card-inner">
                  <span aria-hidden className="fsh-card-glow" />
                  <div className="fsh-card-head">
                    <span className="fsh-card-num"><strong>{s.num}</strong> / {s.total}</span>
                    <span aria-hidden className="fsh-card-icon">{s.icon ?? '✦'}</span>
                  </div>
                  <h3 className="fsh-card-title">{s.title}</h3>
                  <p className="fsh-card-desc">{s.description}</p>
                  <div className="fsh-card-foot">
                    <div className="fsh-ticks">
                      {steps.map((_, j) => {
                        const done = j < activeIdx, cur = j === activeIdx;
                        return <i key={j} className="fsh-tick"><span style={{
                          transform: `scaleX(${done ? 1 : cur ? stepLocal : 0})`,
                          transition: done ? 'none' : 'transform 160ms linear',
                        }} /></i>;
                      })}
                    </div>
                    <span className="fsh-card-label">{s.label}</span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        <div className="fsh-progress"><span className="fsh-progress-fill" style={{ width: `${progress * 100}%` }} /></div>
      </div>

      <div className="fsh-spacer" style={{ height: scrollHeight }} />
    </div>
  );
}
