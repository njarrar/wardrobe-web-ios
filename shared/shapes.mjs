// Drawn garments on a 600 x 600 canvas, used by the sample closet and the
// starter pieces you can add without a photo. Pure strings, no Node modules.
export const shade = (hex, amount) => {
  const value = parseInt(hex.slice(1), 16);
  const channel = (shift) => Math.max(0, Math.min(255, Math.round(((value >> shift) & 255) * amount)));
  return `#${[16, 8, 0].map((shift) => channel(shift).toString(16).padStart(2, "0")).join("")}`;
};

// Each shape is drawn on a 600 x 600 canvas with a soft fold shadow.
export const SHAPES = {
  tee: (c) => `<path d="M210 120 L150 140 L80 230 L140 280 L180 240 L180 500 L420 500 L420 240 L460 280 L520 230 L450 140 L390 120 Q300 175 210 120 Z" fill="${c}"/>
    <path d="M250 125 Q300 160 350 125" fill="none" stroke="${shade(c, 0.8)}" stroke-width="10"/>`,
  stripedTee: (c) => `<defs><clipPath id="t"><path d="M210 120 L150 140 L80 230 L140 280 L180 240 L180 500 L420 500 L420 240 L460 280 L520 230 L450 140 L390 120 Q300 175 210 120 Z"/></clipPath></defs>
    <g clip-path="url(#t)"><rect width="600" height="600" fill="#f2efe8"/>${Array.from({ length: 14 }, (_, i) => `<rect y="${120 + i * 28}" width="600" height="12" fill="${c}"/>`).join("")}</g>`,
  shirt: (c) => `<path d="M220 110 L150 140 L95 330 L150 345 L185 250 L185 510 L415 510 L415 250 L450 345 L505 330 L450 140 L380 110 L300 150 Z" fill="${c}" stroke="${shade(c, 0.86)}" stroke-width="3"/>
    <path d="M220 110 L300 150 L260 190 Z M380 110 L300 150 L340 190 Z" fill="${shade(c, 0.93)}"/>
    <line x1="300" y1="150" x2="300" y2="510" stroke="${shade(c, 0.85)}" stroke-width="4"/>
    ${[200, 260, 320, 380, 440].map((y) => `<circle cx="312" cy="${y}" r="5" fill="${shade(c, 0.75)}"/>`).join("")}`,
  sweater: (c) => `<path d="M215 115 L140 145 L95 450 L150 460 L185 260 L185 500 L415 500 L415 260 L450 460 L505 450 L460 145 L385 115 Q300 160 215 115 Z" fill="${c}"/>
    <rect x="185" y="480" width="230" height="22" fill="${shade(c, 0.85)}"/>
    <path d="M245 120 Q300 165 355 120" fill="none" stroke="${shade(c, 0.8)}" stroke-width="16"/>`,
  jacket: (c) => `<path d="M215 105 L140 135 L90 470 L150 478 L180 270 L180 515 L420 515 L420 270 L450 478 L510 470 L460 135 L385 105 L300 160 Z" fill="${c}"/>
    <path d="M215 105 L300 160 L255 300 L235 170 Z M385 105 L300 160 L345 300 L365 170 Z" fill="${shade(c, 0.85)}"/>
    <line x1="300" y1="160" x2="300" y2="515" stroke="${shade(c, 0.7)}" stroke-width="5"/>
    <rect x="205" y="360" width="60" height="50" rx="6" fill="${shade(c, 0.9)}"/><rect x="335" y="360" width="60" height="50" rx="6" fill="${shade(c, 0.9)}"/>`,
  coat: (c) => `<path d="M220 80 L145 110 L100 500 L160 505 L185 260 L170 550 L430 550 L415 260 L440 505 L500 500 L455 110 L380 80 L300 140 Z" fill="${c}"/>
    <path d="M220 80 L300 140 L250 300 L225 150 Z M380 80 L300 140 L350 300 L375 150 Z" fill="${shade(c, 0.88)}"/>
    <rect x="175" y="330" width="250" height="22" fill="${shade(c, 0.8)}"/>
    ${[220, 290, 380].map((y) => `<circle cx="275" cy="${y}" r="7" fill="${shade(c, 0.6)}"/><circle cx="325" cy="${y}" r="7" fill="${shade(c, 0.6)}"/>`).join("")}`,
  trousers: (c) => `<path d="M205 70 L395 70 L425 540 L325 540 L300 200 L275 540 L175 540 Z" fill="${c}"/>
    <rect x="205" y="70" width="190" height="26" fill="${shade(c, 0.85)}"/>
    <line x1="245" y1="110" x2="225" y2="530" stroke="${shade(c, 0.88)}" stroke-width="3"/><line x1="355" y1="110" x2="375" y2="530" stroke="${shade(c, 0.88)}" stroke-width="3"/>`,
  jeans: (c) => `<path d="M200 70 L400 70 L430 540 L330 540 L300 210 L270 540 L170 540 Z" fill="${c}"/>
    <rect x="200" y="70" width="200" height="28" fill="${shade(c, 0.85)}"/>
    <path d="M215 100 Q240 150 290 150 M385 100 Q360 150 310 150" fill="none" stroke="#c99a4a" stroke-width="4"/>`,
  sneakers: (c) => `<path d="M90 380 Q100 300 190 290 L280 300 Q340 330 420 340 Q500 350 510 400 L510 430 L90 430 Z" fill="${c}" stroke="#cfcac0" stroke-width="4"/>
    <rect x="90" y="420" width="420" height="34" rx="12" fill="#e9e5dc"/>
    ${[310, 335, 360].map((x) => `<line x1="${x - 40}" y1="${x - 5}" x2="${x}" y2="${x - 20}" stroke="#bdb7aa" stroke-width="5"/>`).join("")}`,
  loafers: (c) => `<path d="M90 400 Q95 330 180 320 L320 330 Q430 340 500 380 Q520 400 505 430 L95 430 Z" fill="${c}"/>
    <rect x="95" y="425" width="410" height="22" rx="8" fill="${shade(c, 0.6)}"/>
    <path d="M300 345 Q360 350 400 370" fill="none" stroke="${shade(c, 0.7)}" stroke-width="8"/>`,
  boots: (c) => `<path d="M200 120 L330 120 L340 360 Q440 370 490 420 L490 460 L180 460 L180 380 Z" fill="${c}"/>
    <rect x="180" y="450" width="310" height="26" rx="8" fill="${shade(c, 0.55)}"/>
    <rect x="200" y="120" width="130" height="24" fill="${shade(c, 0.8)}"/>`,
  tote: (c) => `<path d="M230 220 Q230 120 300 120 Q370 120 370 220" fill="none" stroke="${shade(c, 0.75)}" stroke-width="16"/>
    <path d="M150 220 L450 220 L480 500 L120 500 Z" fill="${c}"/>`,
  abaya: (c) => `<path d="M235 60 L365 60 L405 100 L525 400 L460 428 L412 310 L445 560 L155 560 L188 310 L140 428 L75 400 L195 100 Z" fill="${c}"/>
    <path d="M255 62 Q300 110 345 62" fill="none" stroke="${shade(c, 0.8)}" stroke-width="8"/>
    <line x1="300" y1="100" x2="300" y2="560" stroke="${shade(c, 0.78)}" stroke-width="4"/>
    <path d="M140 428 L75 400 M460 428 L525 400" stroke="${shade(c, 0.78)}" stroke-width="6"/>`,
  thobe: (c) => `<path d="M232 60 L368 60 L430 100 L492 400 L436 414 L404 250 L422 560 L178 560 L196 250 L164 414 L108 400 L170 100 Z" fill="${c}" stroke="${shade(c, 0.86)}" stroke-width="3"/>
    <path d="M262 60 L300 96 L338 60 L338 84 L300 118 L262 84 Z" fill="${shade(c, 0.9)}"/>
    <line x1="300" y1="118" x2="300" y2="300" stroke="${shade(c, 0.82)}" stroke-width="4"/>
    ${[150, 200, 250].map((y) => `<circle cx="300" cy="${y}" r="5" fill="${shade(c, 0.72)}"/>`).join("")}
    <rect x="325" y="170" width="46" height="52" rx="5" fill="none" stroke="${shade(c, 0.86)}" stroke-width="3"/>`,
  hijab: (c) => `<path fill-rule="evenodd" d="M300 80 Q165 80 160 250 Q156 400 110 510 L490 510 Q444 400 440 250 Q435 80 300 80 Z M300 140 Q228 140 226 240 Q226 330 300 334 Q374 330 374 240 Q372 140 300 140 Z" fill="${c}"/>
    <path d="M226 280 Q260 420 190 510 M374 280 Q350 400 420 510" fill="none" stroke="${shade(c, 0.85)}" stroke-width="6"/>`,
  shemagh: (c) => `<defs><clipPath id="g"><path d="M300 90 Q170 90 160 250 Q156 400 100 520 L500 520 Q444 400 440 250 Q430 90 300 90 Z"/></clipPath></defs>
    <g clip-path="url(#g)"><rect width="600" height="600" fill="#f4f1ea"/>
    ${Array.from({ length: 16 }, (_, i) => `<rect x="${90 + i * 28}" width="9" height="600" fill="${c}"/><rect y="${80 + i * 28}" width="600" height="9" fill="${c}"/>`).join("")}</g>
    <path d="M178 170 Q300 120 422 170 M176 196 Q300 146 424 196" fill="none" stroke="#1c1c1c" stroke-width="14" stroke-linecap="round"/>`,
  bisht: (c) => `<path d="M215 70 L385 70 L530 520 L335 548 L300 170 L265 548 L70 520 Z" fill="${c}"/>
    <path d="M215 70 L300 170 L265 548 M385 70 L300 170 L335 548" fill="none" stroke="#c9a24a" stroke-width="10" stroke-linejoin="round"/>
    <path d="M250 300 L262 300 M338 300 L350 300" stroke="#c9a24a" stroke-width="8" stroke-linecap="round"/>`,
  scarf: (c) => `<path d="M180 140 Q300 220 420 140 L440 200 Q300 290 160 200 Z" fill="${c}"/>
    <path d="M330 230 L400 230 L420 500 L350 500 Z" fill="${shade(c, 0.9)}"/>
    ${[360, 380, 400].map((x) => `<line x1="${x}" y1="500" x2="${x}" y2="530" stroke="${c}" stroke-width="6"/>`).join("")}`,
};

export function shapeSvg(shape, color) {
  const draw = SHAPES[shape];
  if (!draw) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">${draw(color)}</svg>`;
}
