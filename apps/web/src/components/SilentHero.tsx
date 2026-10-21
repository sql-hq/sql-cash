import { FrameSequenceHero, type FrameRenderer, type FrameSequenceStep } from './ui/frame-sequence-hero';

const ORANGE = '#ff9f3a', PINK = '#ff6f9c', BLUE = '#5e9bff', VIOLET = '#a37bff';

const steps: FrameSequenceStep[] = [
  { from: 0.02, to: 0.28, color: ORANGE, num: '01', total: '04', icon: '✦', label: 'Encrypt',
    title: 'Names in, ciphertext out.',
    description: 'Enter ENS names and amounts. Each allocation is sealed to the recipient’s key before anything touches the chain.' },
  { from: 0.28, to: 0.55, color: PINK, num: '02', total: '04', icon: '◐', label: 'Shield',
    title: 'One pool. No roster.',
    description: 'Funds enter a shared pool as eight padded envelopes. Observers see a deposit, never who gets paid or how much.' },
  { from: 0.55, to: 0.82, color: BLUE, num: '03', total: '04', icon: '▣', label: 'Prove',
    title: 'Claim with a proof.',
    description: 'Recipients find their envelope locally and claim with a Noir UltraHonk proof that hides which batch it came from.' },
  { from: 0.82, to: 1.01, color: VIOLET, num: '04', total: '04', icon: '⌁', label: 'Withdraw',
    title: 'Exit on your terms.',
    description: 'Withdraw any amount to a fresh wallet. The remainder rolls into a new private note.' },
];

const names = ['alice.eth', 'bob.eth', 'carol.eth', 'dao.eth', 'eve.eth', 'kai.eth', 'mira.eth', 'nova.eth'];
const amounts = ['2,400', '1,150', '3,000', '860', '1,920', '540', '2,210', '700'];
const HEX = '0123456789abcdef';

function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const stars = (() => { const r = rng(7); return Array.from({ length: 140 }, () => ({ x: r(), y: r(), s: r() * 1.2 + .2, a: r() * .5 + .1, tw: r() * 6 })); })();
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const seg = (p: number, a: number, b: number) => clamp((p - a) / (b - a));
const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const easeIO = (t: number) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function scramble(text: string, amount: number, salt: number) {
  const r = rng(salt);
  return [...text].map(ch => (ch !== ' ' && r() < amount ? HEX[Math.floor(r() * 16)] : ch)).join('');
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color); g.addColorStop(1, 'transparent');
  ctx.globalAlpha = alpha; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
}

const render: FrameRenderer = (ctx, p, w, h) => {
  const wide = w > 760;
  const cx = wide ? w * 0.6 : w * 0.5, cy = wide ? h * 0.6 : h * 0.5;
  const R = Math.min(w * (wide ? .26 : .42), h * .3);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#050608'; ctx.fillRect(0, 0, w, h);

  // Starfield drifts slowly with progress.
  for (const s of stars) {
    const x = ((s.x + p * .05 * s.s) % 1) * w, y = s.y * h;
    ctx.globalAlpha = s.a * (.6 + .4 * Math.sin(s.tw + p * 20));
    ctx.fillStyle = '#c9d0ff'; ctx.fillRect(x, y, s.s, s.s);
  }
  ctx.globalAlpha = 1;

  const a = seg(p, 0.0, 0.28), b = seg(p, 0.28, 0.55), c = seg(p, 0.55, 0.82), d = seg(p, 0.82, 1);
  const orb = ease(seg(p, 0.3, 0.5));
  const accent = p < .28 ? ORANGE : p < .55 ? PINK : p < .82 ? BLUE : VIOLET;
  glow(ctx, cx, cy, R * 2.2, accent, .16 + .1 * orb);

  // Source: the organization's payout list, left of centre.
  const sx = cx - R * 1.9, sy = cy;
  const srcFade = 1 - seg(p, 0.45, 0.6);
  if (srcFade > 0) {
    ctx.globalAlpha = srcFade * (.4 + .6 * ease(seg(p, 0, .08)));
    ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(sx - 44, sy - 60, 88, 120, 12); ctx.stroke();
    for (let i = 0; i < 6; i++) { ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(sx - 30, sy - 40 + i * 15, 60 - (i % 3) * 12, 4); }
    ctx.globalAlpha = 1;
  }

  // Eight payout packets: leave the list, scramble into ciphertext, then fall into the pool.
  ctx.font = '600 11px "SFMono-Regular", Consolas, monospace';
  ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  for (let i = 0; i < 8; i++) {
    const ang = -Math.PI / 2 + (i / 8) * Math.PI * 2;
    const ringX = cx + Math.cos(ang) * R * 1.25, ringY = cy + Math.sin(ang) * R * .95;
    const out = ease(seg(a, i * .05, .55 + i * .05));
    const intoPool = easeIO(seg(b, i * .04, .7 + i * .03));
    if (out <= 0) continue;
    const spin = intoPool * Math.PI * 1.4;
    const rr = mix(1, 0, intoPool);
    const tx = cx + Math.cos(ang + spin) * R * 1.25 * rr, ty = cy + Math.sin(ang + spin) * R * .95 * rr;
    const x = mix(sx, ringX, out) * (1 - intoPool) + tx * intoPool;
    const y = mix(sy, ringY, out) * (1 - intoPool) + ty * intoPool;
    const sealed = ease(seg(a, .35 + i * .03, .85 + i * .015));
    const label = scramble(`${names[i]} · ${amounts[i]}`, sealed, i * 97 + Math.floor(p * 60));
    const alpha = (1 - intoPool) * clamp(out * 1.6);
    if (alpha <= .01) continue;
    const tw = ctx.measureText(label).width + 18;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(14,16,22,.82)'; ctx.strokeStyle = sealed > .5 ? `${ORANGE}88` : 'rgba(255,255,255,.18)';
    ctx.beginPath(); ctx.roundRect(x - tw / 2, y - 12, tw, 24, 8); ctx.fill(); ctx.stroke();
    ctx.fillStyle = sealed > .5 ? '#ffc58a' : '#e8eaf2'; ctx.fillText(label, x, y + .5);
    if (sealed > .5) glow(ctx, x, y, 34, ORANGE, .18 * alpha);
    ctx.globalAlpha = 1;
  }

  // The shielded pool: a dark sphere with rotating rims.
  if (orb > 0) {
    const r = R * .42 * orb;
    const g = ctx.createRadialGradient(cx - r * .3, cy - r * .35, r * .1, cx, cy, r);
    g.addColorStop(0, '#2a2140'); g.addColorStop(.6, '#0d0d14'); g.addColorStop(1, '#050608');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 1.5;
    for (let k = 0; k < 3; k++) {
      const rot = p * (6 + k * 3) + k;
      ctx.strokeStyle = [PINK, BLUE, VIOLET][k]; ctx.globalAlpha = .55 * orb;
      ctx.beginPath(); ctx.ellipse(cx, cy, r * (1.15 + k * .16), r * (.34 + k * .08), rot * .2 + k, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Eight padded slots glow on the rim once the batch is sealed.
    const slots = ease(seg(b, .55, .95));
    for (let i = 0; i < 8; i++) {
      const t = i / 8 * Math.PI * 2 + p * 4;
      ctx.globalAlpha = slots * .9; ctx.fillStyle = PINK;
      ctx.beginPath(); ctx.arc(cx + Math.cos(t) * r * 1.02, cy + Math.sin(t) * r * 1.02, 2.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Proof: a commitment tree grows from the pool and one hidden path lights up.
  if (c > 0) {
    const grow = ease(seg(c, 0, .6)), lit = ease(seg(c, .45, 1));
    const levels = 4, top = cy - R * 1.05, span = R * 1.7;
    const nodes: { x: number; y: number }[][] = [];
    for (let l = 0; l < levels; l++) {
      const count = 2 ** l, row: { x: number; y: number }[] = [];
      for (let k = 0; k < count; k++) row.push({ x: cx + (k + .5 - count / 2) * (span / count), y: top + l * R * .2 });
      nodes.push(row);
    }
    const path = [0, 1, 2, 5];
    ctx.lineWidth = 1;
    for (let l = 1; l < levels; l++) for (let k = 0; k < nodes[l].length; k++) {
      const parent = nodes[l - 1][k >> 1], node = nodes[l][k];
      const vis = clamp(grow * levels - l + .3);
      const onPath = path[l] === k;
      ctx.globalAlpha = vis * (onPath ? .35 + .65 * lit : .22);
      ctx.strokeStyle = onPath && lit > 0 ? BLUE : 'rgba(170,190,255,.7)';
      ctx.beginPath(); ctx.moveTo(parent.x, parent.y); ctx.lineTo(mix(parent.x, node.x, vis), mix(parent.y, node.y, vis)); ctx.stroke();
      ctx.fillStyle = onPath && lit > .2 ? BLUE : 'rgba(200,210,255,.5)';
      ctx.beginPath(); ctx.arc(node.x, node.y, onPath ? 3 : 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = grow; ctx.fillStyle = BLUE; ctx.beginPath(); ctx.arc(nodes[0][0].x, nodes[0][0].y, 3.5, 0, Math.PI * 2); ctx.fill();
    // Rotating dashed proof ring around the pool.
    ctx.globalAlpha = lit * (1 - d); ctx.strokeStyle = BLUE; ctx.lineWidth = 2; ctx.setLineDash([4, 9]);
    ctx.beginPath(); ctx.arc(cx, cy, R * .62, p * 30, p * 30 + Math.PI * 2 * lit); ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // Withdrawal: one note leaves for a fresh wallet; private change keeps orbiting.
  if (d > 0) {
    const go = easeIO(seg(d, .05, .8));
    const wx = cx + R * 1.8, wy = cy - R * .2;
    const x = mix(cx, wx, go), y = mix(cy, wy, go) - Math.sin(go * Math.PI) * R * .35;
    glow(ctx, x, y, 40, VIOLET, .6); ctx.fillStyle = '#e6dcff'; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    const wa = ease(seg(d, .5, 1));
    ctx.globalAlpha = wa; ctx.strokeStyle = VIOLET; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(wx - 28, wy - 18, 56, 36, 9); ctx.stroke();
    ctx.fillStyle = '#d9ccff'; ctx.font = '600 10px "SFMono-Regular", Consolas, monospace'; ctx.fillText('0x7f…e2', wx, wy + .5);
    const ct = p * 40;
    ctx.globalAlpha = wa * .9; ctx.fillStyle = VIOLET;
    ctx.beginPath(); ctx.arc(cx + Math.cos(ct) * R * .55, cy + Math.sin(ct) * R * .2, 3, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
};

export function SilentHero() {
  return (
    <FrameSequenceHero
      renderFrame={render}
      scrollHeight="420vh"
      brand={<><span className="fsh-brand-dot" />SQL</>}
      navLinks={[
        { label: 'Docs', href: '#/developers/quickstart' },
        { label: 'Q&A', href: '#/developers/faq' },
        { label: 'AI skill', href: '#/developers/ai' },
        { label: 'Privacy', href: '#/developers/privacy' },
      ]}
      ctaLabel="Open app"
      ctaHref="#/app"
      title={<><span className="fsh-title-dark">Silent</span>{' '}<span className="fsh-title-rainbow">Query Layer</span></>}
      subtitle="Private payouts on Ethereum. Scroll to see how."
      steps={steps}
    />
  );
}
