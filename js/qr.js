// Minimal QR code generator (byte mode, error-correction level M, versions 1-10).
// No dependencies. Enough for URLs up to ~213 bytes, which is all Tatshan needs.

const EC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const NUM_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const MAX_VERSION = 10;

function rawModules(ver) {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const a = Math.floor(ver / 7) + 2;
    n -= (25 * a - 10) * a - 55;
    if (ver >= 7) n -= 36;
  }
  return n;
}

function alignPositions(ver) {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const size = ver * 4 + 17;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const res = [6];
  for (let pos = size - 7; res.length < n; pos -= step) res.splice(1, 0, pos);
  return res;
}

function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 2);
  }
  return result;
}

function rsRemainder(data, divisor) {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor); });
  }
  return result;
}

function buildCodewords(bytes, ver) {
  const raw = Math.floor(rawModules(ver) / 8);
  const ecLen = EC_PER_BLOCK[ver];
  const blocks = NUM_BLOCKS[ver];
  const dataCap = raw - ecLen * blocks;

  const bits = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, ver >= 10 ? 16 : 8);
  bytes.forEach((b) => push(b, 8));
  push(0, Math.min(4, dataCap * 8 - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < dataCap * 8; pad ^= 0xec ^ 0x11) push(pad, 8);

  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    data.push(v);
  }

  const shortBlocks = blocks - (raw % blocks);
  const shortLen = Math.floor(raw / blocks);
  const divisor = rsDivisor(ecLen);
  const parts = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const len = shortLen - ecLen + (i < shortBlocks ? 0 : 1);
    const dat = data.slice(k, k + len);
    k += len;
    parts.push({ dat, ec: rsRemainder(dat, divisor) });
  }
  const out = [];
  for (let i = 0; i < parts[parts.length - 1].dat.length; i++) {
    parts.forEach((p) => { if (i < p.dat.length) out.push(p.dat[i]); });
  }
  for (let i = 0; i < ecLen; i++) parts.forEach((p) => out.push(p.ec[i]));
  return out;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function penalty(m, size) {
  let score = 0;
  const lines = [];
  for (let i = 0; i < size; i++) {
    lines.push(m[i].slice());
    lines.push(m.map((row) => row[i]));
  }
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) run++;
      else { if (run >= 5) score += 3 + (run - 5); run = 1; }
    }
    const s = line.map((v) => (v ? '1' : '0')).join('');
    for (const pat of ['10111010000', '00001011101']) {
      let at = s.indexOf(pat);
      while (at !== -1) { score += 40; at = s.indexOf(pat, at + 1); }
    }
  }
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const v = m[y][x];
      if (v === m[y][x + 1] && v === m[y + 1][x] && v === m[y + 1][x + 1]) score += 3;
    }
  }
  let dark = 0;
  m.forEach((row) => row.forEach((v) => { if (v) dark++; }));
  score += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
  return score;
}

export function qrMatrix(text) {
  const bytes = Array.from(new TextEncoder().encode(text));
  let ver = 1;
  for (; ver <= MAX_VERSION; ver++) {
    const cap = Math.floor(rawModules(ver) / 8) - EC_PER_BLOCK[ver] * NUM_BLOCKS[ver];
    const need = 4 + (ver >= 10 ? 16 : 8) + bytes.length * 8;
    if (need <= cap * 8) break;
  }
  if (ver > MAX_VERSION) throw new Error('QR text too long');

  const size = ver * 4 + 17;
  const grid = () => Array.from({ length: size }, () => new Array(size).fill(false));
  const base = grid();
  const isFn = grid();
  const set = (x, y, dark) => { base[y][x] = dark; isFn[y][x] = true; };

  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx; const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
    }
  }
  const ap = alignPositions(ver);
  ap.forEach((cy, i) => ap.forEach((cx, j) => {
    const onFinder = (i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0);
    if (onFinder) return;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }));

  const formatBits = (mask) => {
    const data = (0 << 3) | mask; // ECC level M = 00
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((data << 10) | rem) ^ 0x5412;
  };
  const bit = (v, i) => ((v >>> i) & 1) !== 0;
  const drawFormat = (target, mask) => {
    const bits = formatBits(mask);
    const put = (x, y, v) => { target[y][x] = v; isFn[y][x] = true; };
    for (let i = 0; i <= 5; i++) put(8, i, bit(bits, i));
    put(8, 7, bit(bits, 6)); put(8, 8, bit(bits, 7)); put(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) put(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) put(size - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) put(8, size - 15 + i, bit(bits, i));
    put(8, size - 8, true);
  };
  drawFormat(base, 0);

  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3); const b = Math.floor(i / 3);
      set(a, b, bit(bits, i)); set(b, a, bit(bits, i));
    }
  }

  const codewords = buildCodewords(bytes, ver);
  const placed = base.map((r) => r.slice());
  let idx = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFn[y][x] && idx < codewords.length * 8) {
          placed[y][x] = bit(codewords[idx >>> 3], 7 - (idx & 7));
          idx++;
        }
      }
    }
  }

  let best = null; let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const m = placed.map((r) => r.slice());
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) if (!isFn[y][x] && MASKS[mask](x, y)) m[y][x] = !m[y][x];
    }
    drawFormat(m, mask);
    const s = penalty(m, size);
    if (s < bestScore) { bestScore = s; best = m; }
  }
  return { size, modules: best };
}

// Returns an SVG string. One <path> for all dark modules, so it stays crisp when printed.
export function qrSvg(text, { margin = 4, fg = '#141413', bg = '#ffffff' } = {}) {
  const { size, modules } = qrMatrix(text);
  const total = size + margin * 2;
  let d = '';
  for (let y = 0; y < size; y++) {
    let x = 0;
    while (x < size) {
      if (!modules[y][x]) { x++; continue; }
      let w = 1;
      while (x + w < size && modules[y][x + w]) w++;
      d += `M${x + margin} ${y + margin}h${w}v1h-${w}z`;
      x += w;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${total}" height="${total}" fill="${bg}"/><path d="${d}" fill="${fg}"/></svg>`;
}
