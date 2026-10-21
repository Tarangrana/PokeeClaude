// Draws the PokeeClaude app icon into desktop/icon.png (1024x1024).
//   node scripts/make-icon.mjs
//
// Flat "map tile" style: a rounded tile with a big P, a Claude-orange road
// and a grass corner, plus a ball-patterned speech bubble (the pet's status
// bubble) bursting out of the top-right corner.
import sharp from "sharp";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <clipPath id="tile">
      <rect x="112" y="176" width="736" height="736" rx="168"/>
    </clipPath>
    <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f4f4f6"/>
      <stop offset="1" stop-color="#c9cbd3"/>
    </linearGradient>
    <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4cc9f6"/>
      <stop offset="1" stop-color="#2fb3ec"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#1b2a3a" flood-opacity="0.28"/>
    </filter>
  </defs>

  <!-- Tile -->
  <g clip-path="url(#tile)" filter="url(#shadow)">
    <rect x="112" y="176" width="736" height="736" fill="url(#ground)"/>
    <!-- Sky-blue upper-left half -->
    <path d="M112 176H848L112 912Z" fill="url(#sky)"/>
    <!-- Grass hill along the bottom -->
    <path d="M300 912L560 640L820 912Z" fill="#5cbf4a"/>
    <path d="M560 640L640 724L560 790L480 724Z" fill="#6fd25a"/>
    <!-- White path crossing the ground -->
    <path d="M520 560L600 560L848 808L848 912L800 912Z" fill="#ffffff"/>
    <!-- Claude-orange road, bottom-left to top-right -->
    <path d="M112 846L782 176L878 176L878 214L170 922L112 922Z" fill="#d97757"/>
    <path d="M112 846L782 176L800 176L112 864Z" fill="#e8916f"/>
  </g>

  <!-- Big P (drawn as shapes, no font needed) -->
  <path fill="#ffffff" fill-rule="evenodd"
    d="M232 300h120a96 96 0 0 1 0 192h-62v126h-58zM290 352v88h58a44 44 0 0 0 0-88z"/>

  <!-- Ball speech bubble -->
  <g filter="url(#shadow)">
    <!-- Bubble body with a tail pointing down-left toward the tile -->
    <path d="M760 96a176 176 0 1 1-72 336.6L598 486l26-94A176 176 0 0 1 760 96z" fill="#f7f5f2"/>
    <!-- Red top half -->
    <path d="M584 272a176 176 0 0 1 352 0z" fill="#ee3a2f"/>
    <!-- Centre band and button -->
    <rect x="584" y="256" width="352" height="32" fill="#3a3a44"/>
    <circle cx="760" cy="272" r="62" fill="#3a3a44"/>
    <circle cx="760" cy="272" r="36" fill="#f7f5f2"/>
    <!-- Shine -->
    <path d="M664 196a118 118 0 0 1 70-62" stroke="#ffffff" stroke-opacity="0.55" stroke-width="22" stroke-linecap="round" fill="none"/>
  </g>
</svg>`;

const out = new URL("../desktop/icon.png", import.meta.url).pathname;
await sharp(Buffer.from(svg)).png().toFile(out);
console.log("wrote desktop/icon.png");
