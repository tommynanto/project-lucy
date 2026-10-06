// Pen-sketch golden retriever head (side profile, facing left), drawn in currentColor.
// Used on the welcome screen; icon.svg / icon-180.png are the same drawing.
const OUT = 'M36 120L38 100C41 90 45 81 48 73C44 67 38 64 32 63C27 62.5 23 61.5 20 60C16 58 13.5 55.5 12.5 52C11.5 48.5 12 45.5 14 44C17 42 24 40.5 30 39C33 38 35 36 37 33C40 25.5 47 18.5 57 17.5C68 16.5 77 22 80 32C82 40 83 48 86 56C90 66 95 80 99 96L100 120';
const EAR = 'M49 27C55 21 65 19.5 71 22.5C74 24 74.5 27.5 73 31C71.5 35 72 38 70 41.5C68.5 44.5 69 47 67 50C65.5 53 65.5 55.5 63 58.5C61 61 60 63.5 57 65.5C54.5 67 52.5 65.5 52 63C51 57 50 50 49 43C48.2 37 47.8 31 49 27Z';
const DETAIL = [
  'M51 26.5C56 23.5 63 22.5 69 24',                                   // ear fold
  'M70 41.5C72.5 43 73.5 45 73.5 47.5', 'M67 50C69.5 51.5 70.5 53.5 70.5 56', 'M63 58.5C65.5 60 66.5 62 66.5 64.5', // ear feathering
  'M53.5 42C54.5 48 55.5 53 57.5 58', 'M58 33C59.5 39 61 43 63 47',  // fur inside the ear
  'M15.5 54C20 55.5 25 56.3 30 56', 'M36.5 29C39 27.5 42 27.5 44.5 28.5', // mouth, brow
  'M25 60.5C27.5 63.5 30 64.5 33 64.5', 'M38 64C40 66.5 42 67.5 44.5 68',  // jowl and throat fluff
  'M49 80C47.5 85 47 89.5 48 94', 'M55 89C54 93 54.5 96.5 56 99.5',        // chest
  'M86 60C89 67 91 73 92 80', 'M90 76C92.5 82 94 87 94.5 93', 'M76.5 30C78 35 78.5 40 78 45', // neck
];

function strokes(width, withDetail) {
  const paths = [OUT, EAR, ...(withDetail ? DETAIL : [])].map(d => `<path d="${d}"/>`).join('');
  return `<g fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${paths}</g>`;
}

export const retrieverSketch = () => `
  <svg class="logo" viewBox="8 12 92 92" aria-hidden="true">
    <defs><clipPath id="logo-clip"><rect width="100" height="100"/></clipPath></defs>
    <g clip-path="url(#logo-clip)">
      <g transform="translate(0.9 0.7)" opacity=".28">${strokes(1.6, false)}</g>
      ${strokes(1.8, true)}
      <ellipse cx="41" cy="31.5" rx="2.1" ry="1.7" fill="currentColor"/>
      <ellipse cx="14.3" cy="46.2" rx="3.3" ry="2.8" fill="currentColor"/>
    </g>
  </svg>`;
