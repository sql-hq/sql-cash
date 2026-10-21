// "Decrypt" text effect: headings arrive as blurred random ciphertext and resolve
// left to right into the real text. Works on text nodes only and restores the
// exact original string, aborting if React rewrites the node mid-animation.

const GLYPHS = '0123456789ABCDEF#%&@$*+=<>/\\|░▒▓';
// Only the hero headline uses the effect.
const REVEAL = '.lp-hero-title';
const HOVER = '.lp-hero-title';
const AMBIENT = '.lp-hero-title';

const running = new WeakMap<Element, () => void>();
const seen = new WeakSet<Element>();

const rand = () => GLYPHS[(Math.random() * GLYPHS.length) | 0];

function textNodes(el: Element): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.nodeValue && n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
}

export function scramble(el: Element, { duration = 900, blur = 7 } = {}) {
  running.get(el)?.();
  const nodes = textNodes(el);
  if (!nodes.length) return;
  const originals = nodes.map(n => n.nodeValue ?? '');
  const total = originals.reduce((sum, s) => sum + s.length, 0) || 1;
  const written = [...originals];
  const style = (el as HTMLElement).style;
  const prevFilter = style.filter;
  let frame = 0, cancelled = false;
  const start = performance.now();

  const finish = (restore: boolean) => {
    cancelled = true; cancelAnimationFrame(frame);
    if (restore) nodes.forEach((n, i) => { if (n.nodeValue === written[i]) n.nodeValue = originals[i]; });
    style.filter = prevFilter;
    running.delete(el);
  };
  running.set(el, () => finish(true));

  const tick = (now: number) => {
    if (cancelled) return;
    const t = Math.min(1, (now - start) / duration);
    const resolved = Math.floor(t * t * (3 - 2 * t) * total * 1.08);
    let offset = 0;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i], src = originals[i];
      if (n.nodeValue !== written[i]) { finish(false); return; } // React changed it: leave React's value.
      let next = '';
      for (let k = 0; k < src.length; k++) {
        const ch = src[k];
        next += ch === ' ' || ch === '\n' || offset + k < resolved ? ch : rand();
      }
      offset += src.length;
      n.nodeValue = next; written[i] = next;
    }
    style.filter = t < 1 ? `blur(${(blur * (1 - t) ** 1.6).toFixed(2)}px)` : prevFilter;
    if (t < 1) frame = requestAnimationFrame(tick);
    else finish(true);
  };
  frame = requestAnimationFrame(tick);
}

export function startScramble() {
  if (typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  const io = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); scramble(e.target, { duration: 1100 }); }
  }, { threshold: 0.35 });

  const scan = (root: ParentNode) => {
    root.querySelectorAll(REVEAL).forEach(el => { if (!seen.has(el)) { seen.add(el); io.observe(el); } });
  };
  scan(document);
  new MutationObserver(records => {
    for (const r of records) r.addedNodes.forEach(n => { if (n instanceof Element) { if (n.matches(REVEAL) && !seen.has(n)) { seen.add(n); io.observe(n); } scan(n); } });
  }).observe(document.body, { childList: true, subtree: true });

  // Hover: controls flicker through ciphertext and settle.
  document.addEventListener('pointerover', event => {
    const target = (event.target as Element | null)?.closest?.(HOVER);
    if (target && !running.has(target) && !(event.relatedTarget instanceof Node && target.contains(event.relatedTarget)))
      scramble(target, { duration: 420, blur: 2 });
  });

  // Ambient: every few seconds one visible heading briefly re-encrypts.
  window.setInterval(() => {
    if (document.hidden) return;
    const visible = [...document.querySelectorAll(AMBIENT)].filter(el => {
      const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && !running.has(el);
    });
    if (visible.length) scramble(visible[(Math.random() * visible.length) | 0], { duration: 700, blur: 4 });
  }, 5200);
}
