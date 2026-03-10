const CHARS   = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&<>[]{}|\\.,:;~`^*+-=';
const FONT_SZ = 12;

const canvas = document.getElementById('matrix-canvas');
const ctx    = canvas.getContext('2d');

let cols, drops, animId;

function initMatrix() {
  canvas.width  = canvas.offsetWidth  || canvas.parentElement.offsetWidth;
  canvas.height = canvas.offsetHeight || canvas.parentElement.offsetHeight;
  cols  = Math.max(1, Math.floor(canvas.width / FONT_SZ));
  drops = Array.from({ length: cols }, () => (Math.random() * -40) | 0);
}

function drawMatrix() {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = FONT_SZ + 'px ui-monospace, monospace';

  for (let i = 0; i < drops.length; i++) {
    const char = CHARS[Math.random() * CHARS.length | 0];
    const y    = drops[i] * FONT_SZ;
    ctx.fillStyle = drops[i] > 2
      ? (Math.random() > 0.9 ? '#005f1a' : '#00ff41')
      : '#ccffcc';
    ctx.fillText(char, i * FONT_SZ, y);
    if (y > canvas.height && Math.random() > 0.975) drops[i] = 0;
    drops[i] += 0.5;
  }

  animId = requestAnimationFrame(drawMatrix);
}

export function stopMatrix() {
  cancelAnimationFrame(animId);
}

// Defer first init to ensure layout is complete
requestAnimationFrame(() => {
  initMatrix();
  new ResizeObserver(initMatrix).observe(canvas);
  drawMatrix();


});
