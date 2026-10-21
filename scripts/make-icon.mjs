// Draws the PokeeClaude app icon (original art) into desktop/icon.png.
//   node scripts/make-icon.mjs
import sharp from "sharp";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff9a5a"/>
      <stop offset="0.55" stop-color="#e2486f"/>
      <stop offset="1" stop-color="#6b4cf0"/>
    </linearGradient>
  </defs>
  <rect x="64" y="64" width="896" height="896" rx="200" fill="url(#bg)"/>
  <path d="M232 300a96 96 0 0 1 96-96h368a96 96 0 0 1 96 96v232a96 96 0 0 1-96 96H476l-150 120v-120h2a96 96 0 0 1-96-96z" fill="#fff"/>
  <circle cx="392" cy="416" r="46" fill="#2a2140"/>
  <circle cx="512" cy="416" r="46" fill="#2a2140"/>
  <circle cx="632" cy="416" r="46" fill="#2a2140"/>
  <path d="M752 600l-96 168h72l-40 152 136-200h-80l48-120z" fill="#ffd23f" stroke="#2a2140" stroke-width="18" stroke-linejoin="round"/>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile(new URL("../desktop/icon.png", import.meta.url).pathname);
console.log("wrote desktop/icon.png");
