// Generates Android launcher icons (mipmap-*) from an inline SVG.
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#05060f"/>
      <stop offset="0.55" stop-color="#151a3a"/>
      <stop offset="1" stop-color="#3a1630"/>
    </linearGradient>
    <linearGradient id="road" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ff9a2e" stop-opacity="0"/>
      <stop offset="1" stop-color="#ffb347"/>
    </linearGradient>
    <linearGradient id="tower" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#7fd8ff"/>
      <stop offset="1" stop-color="#2a6cff"/>
    </linearGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="6" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="512" height="512" rx="96" fill="url(#sky)"/>
  <!-- skyline -->
  <g fill="#0b0e22">
    <rect x="30" y="250" width="50" height="110"/><rect x="85" y="215" width="38" height="145"/>
    <rect x="330" y="230" width="44" height="130"/><rect x="380" y="200" width="56" height="160"/>
    <rect x="440" y="260" width="40" height="100"/>
  </g>
  <!-- Fukuoka Tower -->
  <polygon points="168,360 186,96 204,360" fill="url(#tower)" filter="url(#glow)"/>
  <rect x="183" y="60" width="6" height="40" fill="#bfe9ff"/>
  <!-- expressway -->
  <polygon points="0,512 512,512 300,330 212,330" fill="#101425"/>
  <polygon points="236,512 276,512 260,330 252,330" fill="url(#road)" filter="url(#glow)"/>
  <polyline points="40,512 220,334" stroke="#ffcf7a" stroke-width="6" fill="none" filter="url(#glow)"/>
  <polyline points="472,512 292,334" stroke="#ffcf7a" stroke-width="6" fill="none" filter="url(#glow)"/>
  <!-- R -->
  <text x="256" y="300" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-weight="bold"
        font-style="italic" font-size="210" fill="#ff3b30" stroke="#fff" stroke-width="6" filter="url(#glow)">R</text>
</svg>`;

const sizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [d, px] of Object.entries(sizes)) {
  const out = join(root, 'android', 'res', `mipmap-${d}`, 'ic_launcher.png');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, await sharp(Buffer.from(svg)).resize(px, px).png().toBuffer());
}
const pub = join(root, 'game', 'public', 'icon.png');
mkdirSync(dirname(pub), { recursive: true });
writeFileSync(pub, await sharp(Buffer.from(svg)).resize(256, 256).png().toBuffer());
console.log('icons written');
