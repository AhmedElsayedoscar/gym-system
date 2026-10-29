'use strict';
// مولّد QR Code بدون أي مكتبات خارجية.
// يدعم: وضع Byte، مستوى تصحيح الأخطاء M، الإصدارات 1 إلى 10 (حتى 213 بايت).

const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const NUM_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const MAX_VERSION = 10;

function rawModules(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}

function dataCodewords(ver) {
  return Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver];
}

// ---------- Reed-Solomon فوق GF(256) ----------
const EXP = new Array(512);
const LOG = new Array(256);
(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gmul(a, b) {
  return a && b ? EXP[LOG[a] + LOG[b]] : 0;
}

function rsDivisor(deg) {
  const res = new Array(deg).fill(0);
  res[deg - 1] = 1;
  let root = 1;
  for (let i = 0; i < deg; i++) {
    for (let j = 0; j < deg; j++) {
      res[j] = gmul(res[j], root);
      if (j + 1 < deg) res[j] ^= res[j + 1];
    }
    root = gmul(root, 2);
  }
  return res;
}

function rsRemainder(data, div) {
  const res = new Array(div.length).fill(0);
  for (const b of data) {
    const f = b ^ res.shift();
    res.push(0);
    for (let i = 0; i < div.length; i++) res[i] ^= gmul(div[i], f);
  }
  return res;
}

// ---------- ترميز البيانات ----------
function encodeData(bytes, ver) {
  const cap = dataCodewords(ver) * 8;
  const bits = [];
  const put = (v, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1);
  };
  put(4, 4); // وضع Byte
  put(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, cap - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    out.push(v);
  }
  return out;
}

function addEccAndInterleave(data, ver) {
  const numBlocks = NUM_BLOCKS[ver];
  const eccLen = ECC_PER_BLOCK[ver];
  const raw = Math.floor(rawModules(ver) / 8);
  const numShort = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);
  const div = rsDivisor(eccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const datLen = shortLen - eccLen + (i < numShort ? 0 : 1);
    const dat = data.slice(k, k + datLen);
    k += datLen;
    const ecc = rsRemainder(dat, div);
    if (i < numShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const out = [];
  for (let i = 0; i < blocks[0].length; i++) {
    for (let j = 0; j < blocks.length; j++) {
      if (i !== shortLen - eccLen || j >= numShort) out.push(blocks[j][i]);
    }
  }
  return out;
}

// ---------- رسم المصفوفة ----------
function alignPositions(ver) {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const res = [6];
  for (let pos = ver * 4 + 10; res.length < n; pos -= step) res.splice(1, 0, pos);
  return res;
}

function buildMatrix(ver, codewords) {
  const size = ver * 4 + 17;
  const mod = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const setFn = (x, y, dark) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    mod[y][x] = !!dark;
    fn[y][x] = true;
  };

  // أنماط التوقيت
  for (let i = 0; i < size; i++) {
    setFn(6, i, i % 2 === 0);
    setFn(i, 6, i % 2 === 0);
  }
  // أنماط البحث
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        setFn(cx + dx, cy + dy, d !== 2 && d !== 4);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  // أنماط المحاذاة
  const ap = alignPositions(ver);
  for (let i = 0; i < ap.length; i++) {
    for (let j = 0; j < ap.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setFn(ap[i] + dx, ap[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }
  // معلومات الإصدار
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFn(a, b, bit);
      setFn(b, a, bit);
    }
  }

  const drawFormat = (mask) => {
    const data = (0 << 3) | mask; // مستوى M = 0
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) setFn(8, i, bit(i));
    setFn(8, 7, bit(6));
    setFn(8, 8, bit(7));
    setFn(7, 8, bit(8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(i));
    setFn(8, size - 8, true);
  };
  drawFormat(0); // حجز أماكن الـ format قبل وضع البيانات

  // وضع البيانات بشكل zigzag
  let bitIdx = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!fn[y][x] && bitIdx < codewords.length * 8) {
          mod[y][x] = ((codewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1) === 1;
          bitIdx++;
        }
      }
    }
  }

  const maskFn = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const applyMask = (m) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!fn[y][x] && maskFn[m](x, y)) mod[y][x] = !mod[y][x];
      }
    }
  };

  let best = 0;
  let bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(m);
    drawFormat(m);
    const s = penalty(mod, size);
    if (s < bestScore) {
      bestScore = s;
      best = m;
    }
    applyMask(m); // إلغاء القناع
  }
  applyMask(best);
  drawFormat(best);
  return mod;
}

function penalty(mod, size) {
  let score = 0;
  // N1: تتابعات من 5 وحدات أو أكثر بنفس اللون
  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a < size; a++) {
      let run = 1;
      for (let b = 1; b < size; b++) {
        const cur = pass === 0 ? mod[a][b] : mod[b][a];
        const prev = pass === 0 ? mod[a][b - 1] : mod[b - 1][a];
        if (cur === prev) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else run = 1;
      }
    }
  }
  // N2: مربعات 2x2 بنفس اللون
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = mod[y][x];
      if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) score += 3;
    }
  }
  // N3: نمط شبيه بأنماط البحث
  const pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a < size; a++) {
      for (let b = 0; b + 11 <= size; b++) {
        let m1 = true;
        let m2 = true;
        for (let k = 0; k < 11 && (m1 || m2); k++) {
          const v = (pass === 0 ? mod[a][b + k] : mod[b + k][a]) ? 1 : 0;
          if (v !== pat1[k]) m1 = false;
          if (v !== pat2[k]) m2 = false;
        }
        if (m1) score += 40;
        if (m2) score += 40;
      }
    }
  }
  // N4: توازن الأسود والأبيض
  let dark = 0;
  for (const row of mod) for (const v of row) if (v) dark++;
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  score += Math.max(0, k) * 10;
  return score;
}

function makeQr(text) {
  const bytes = Array.from(Buffer.from(String(text), 'utf8'));
  let ver = 1;
  while (ver <= MAX_VERSION && 4 + (ver < 10 ? 8 : 16) + 8 * bytes.length > dataCodewords(ver) * 8) ver++;
  if (ver > MAX_VERSION) throw new Error('النص أطول من المسموح لكود QR');
  const codewords = addEccAndInterleave(encodeData(bytes, ver), ver);
  const modules = buildMatrix(ver, codewords);
  return { version: ver, size: modules.length, modules };
}

function toSvg(text, opts = {}) {
  const border = opts.border ?? 4;
  const dark = opts.dark || '#000';
  const light = opts.light || '#fff';
  const { size, modules } = makeQr(text);
  const dim = size + border * 2;
  let d = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules[y][x]) d += `M${x + border},${y + border}h1v1h-1z`;
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${dim * 8}" height="${dim * 8}" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges">` +
    `<rect width="100%" height="100%" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`
  );
}

module.exports = { makeQr, toSvg, toBarcode };

// ==================== مولّد باركود Code128 ====================
// يحول أي نص ASCII إلى باركود Code128 بصيغة SVG — بدون مكتبات خارجية.

// جدول Code128-B (كل حرف ASCII من 32 إلى 126)
const C128B_VALS = (() => {
  const v = {};
  // الأحرف من 32 إلى 126 تأخذ قيم 0..94
  for (let i = 0; i <= 94; i++) v[String.fromCharCode(i + 32)] = i;
  return v;
})();

// أنماط 11-bit لكل قيمة 0..106 في Code128
const C128_PATTERNS = [
  '11011001100','11001101100','11001100110','10010011000','10010001100',
  '10001001100','10011001000','10011000100','10001100100','11001001000',
  '11001000100','11000100100','10110011100','10011011100','10011001110',
  '10111001100','10011101100','10011100110','11001110010','11001011100',
  '11001001110','11011100100','11001110100','11101101110','11101001100',
  '11100101100','11100100110','11101100100','11100110100','11100110010',
  '11011011000','11011000110','11000110110','10100011000','10001011000',
  '10001000110','10110001000','10001101000','10001100010','11010001000',
  '11000101000','11000100010','10110111000','10110001110','10001101110',
  '10111011000','10111000110','10001110110','11101110110','11010001110',
  '11000101110','11011101000','11011100010','11011101110','11101011000',
  '11101000110','11100010110','11101101000','11101100010','11100011010',
  '11101111010','11001000010','11110001010','10100110000','10100001100',
  '10010110000','10010000110','10000101100','10000100110','10110010000',
  '10110000100','10011010000','10011000010','10000110100','10000110010',
  '11000010010','11001010000','11110111010','11000010100','10001111010',
  '10100111100','10010111100','10010011110','10111100100','10011110100',
  '10011110010','11110100100','11110010100','11110010010','11011011110',
  '11011110110','11110110110','10101111000','10100011110','10001011110',
  '10111101000','10111100010','11110101000','11110100010','10111011110',
  '10111101110','11101011110','11110101110',
  '11010000100','11010010000','11010011110', // 103=START_B, 104=START_A, 105=START_C  (نستخدم 104=StartB)
  '11000111010', // 106 = STOP
];

const START_B = 104;
const STOP    = 106;

function encodeCode128(text) {
  const chars = Array.from(text);
  // احسب قيمة كل حرف في Code128-B
  const vals = [START_B];
  let checksum = START_B;
  for (let i = 0; i < chars.length; i++) {
    const v = C128B_VALS[chars[i]];
    if (v === undefined) throw new Error(`الحرف "${chars[i]}" غير مدعوم في Code128-B`);
    vals.push(v);
    checksum += v * (i + 1);
  }
  vals.push(checksum % 103); // check symbol
  vals.push(STOP);
  return vals;
}

function toBarcode(text, opts = {}) {
  const barWidth  = opts.barWidth  ?? 2;    // عرض وحدة الشريط بالبكسل
  const height    = opts.height    ?? 80;   // ارتفاع الشريط
  const quiet     = opts.quiet     ?? 10;   // هامش صامت جانبي
  const showText  = opts.showText  !== false;
  const fontSize  = opts.fontSize  ?? 12;
  const dark      = opts.dark      || '#000000';
  const light     = opts.light     || '#ffffff';
  const textColor = opts.textColor || dark;

  const vals = encodeCode128(String(text));
  // جمع bits كل القيم
  let bits = '';
  for (const v of vals) bits += C128_PATTERNS[v];
  bits += '1'; // الشريط الإضافي الأخير في STOP

  const barsW = bits.length * barWidth;
  const totalW = barsW + quiet * 2;
  const totalH = height + (showText ? fontSize + 4 : 0);

  // بناء مستطيلات الأشرطة الداكنة فقط
  let rects = '';
  let x = quiet;
  for (const bit of bits) {
    if (bit === '1') {
      rects += `<rect x="${x}" y="0" width="${barWidth}" height="${height}" fill="${dark}"/>`;
    }
    x += barWidth;
  }

  const textEl = showText
    ? `<text x="${totalW / 2}" y="${height + fontSize + 1}" text-anchor="middle" font-family="monospace" font-size="${fontSize}" fill="${textColor}">${text}</text>`
    : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}" shape-rendering="crispEdges">` +
    `<rect width="100%" height="100%" fill="${light}"/>` +
    rects +
    textEl +
    `</svg>`
  );
}

