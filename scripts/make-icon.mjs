// Draws the PokeeClaude app icon into desktop/icon.png (1024x1024).
//   node scripts/make-icon.mjs
//
// A minimalist Psyduck face on a rounded app tile, drawn as vector shapes so
// it stays sharp at every size (Dock, Finder, tray). Fan art; Psyduck is
// © Nintendo / Creatures / GAME FREAK.
import sharp from "sharp";

const SIZE = 1024;
const TILE = { x: 100, y: 100, size: 824, radius: 186 }; // macOS-style margins
// The face is designed on a 736x736 canvas and scaled onto the tile.
const scale = TILE.size / 736;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <clipPath id="tile">
      <rect x="${TILE.x}" y="${TILE.y}" width="${TILE.size}" height="${TILE.size}" rx="${TILE.radius}"/>
    </clipPath>
    <linearGradient id="yellow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fdd25a"/>
      <stop offset="1" stop-color="#f8c444"/>
    </linearGradient>
    <linearGradient id="beak" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fef0c6"/>
      <stop offset="1" stop-color="#fde6b0"/>
    </linearGradient>
    <filter id="drop" x="-10%" y="-10%" width="120%" height="125%">
      <feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#5a3d00" flood-opacity="0.25"/>
    </filter>
  </defs>

  <g filter="url(#drop)">
    <rect x="${TILE.x}" y="${TILE.y}" width="${TILE.size}" height="${TILE.size}" rx="${TILE.radius}" fill="url(#yellow)"/>
  </g>

  <g clip-path="url(#tile)">
    <g transform="translate(${TILE.x} ${TILE.y}) scale(${scale})">
      <!-- Eyes -->
      <ellipse cx="146" cy="253" rx="130" ry="86" fill="#ffffff"/>
      <ellipse cx="590" cy="253" rx="130" ry="86" fill="#ffffff"/>
      <ellipse cx="195" cy="242" rx="17" ry="13" fill="#8a4b36"/>
      <ellipse cx="540" cy="242" rx="17" ry="13" fill="#8a4b36"/>

      <!-- Beak -->
      <path fill="url(#beak)" d="
        M368 320
        C 330 330, 262 352, 226 370
        L 122 377
        Q 100 379 102 400
        L 108 440
        C 40 520, 12 630, 18 780
        L 718 780
        C 724 630, 696 520, 628 444
        L 634 400
        Q 636 379 614 377
        L 510 370
        C 474 352, 406 330, 368 320 Z"/>

      <!-- Nostrils -->
      <path d="M323 368L340 385M412 368L395 385" stroke="#8a4b36" stroke-width="7" stroke-linecap="round"/>
    </g>
  </g>

  <!-- Soft top highlight for a bit of depth -->
  <rect x="${TILE.x}" y="${TILE.y}" width="${TILE.size}" height="${TILE.size}" rx="${TILE.radius}"
    fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="6"/>
</svg>`;

const out = new URL("../desktop/icon.png", import.meta.url).pathname;
await sharp(Buffer.from(svg), { density: 144 }).resize(SIZE, SIZE).png().toFile(out);
console.log("wrote desktop/icon.png");
