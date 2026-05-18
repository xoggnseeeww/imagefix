/**
 * image-process.js — 공유 이미지 처리 모듈
 *
 * Worker와 메인 스레드 양쪽에서 동작.
 * Canvas 생성·Blob 변환은 cf(CanvasFactory)로 추상화:
 *   cf.create(w, h)              → OffscreenCanvas 또는 HTMLCanvasElement
 *   cf.toBlob(canvas, type, q)   → Promise<Blob>
 */

export async function processImage(type, bitmap, config, cf) {
    switch (type) {
        case 'resize':   return opResize(bitmap, config, cf);
        case 'compress': return opCompress(bitmap, config, cf);
        case 'sharpen':  return opSharpen(bitmap, config, cf);
        case 'drawing':  return opDrawing(bitmap, config, cf);
        case 'scan':     return opScan(bitmap, config, cf);
        default: throw new Error(`Unknown type: ${type}`);
    }
}

/* ============================================================
   RESIZE — step-down 알고리즘
   ============================================================ */
async function opResize(bitmap, config, cf) {
    let { targetWidth, targetHeight, format, quality, keepRatio } = config;
    const srcW = bitmap.width, srcH = bitmap.height;

    if (keepRatio) {
        const ratio = Math.min(targetWidth / srcW, targetHeight / srcH);
        targetWidth  = Math.round(srcW * ratio);
        targetHeight = Math.round(srcH * ratio);
    }

    let curW = srcW, curH = srcH;
    let canvas = cf.create(curW, curH);
    let ctx    = canvas.getContext('2d', { alpha: format !== 'image/jpeg' });
    ctx.drawImage(bitmap, 0, 0);

    while (curW > targetWidth * 2 || curH > targetHeight * 2) {
        curW = Math.max(Math.floor(curW * 0.5), targetWidth);
        curH = Math.max(Math.floor(curH * 0.5), targetHeight);
        const tmp = cf.create(curW, curH);
        const tc  = tmp.getContext('2d');
        tc.imageSmoothingQuality = 'high';
        tc.drawImage(canvas, 0, 0, curW, curH);
        canvas = tmp; ctx = tc;
    }

    const out = cf.create(targetWidth, targetHeight);
    const oc  = out.getContext('2d');
    oc.imageSmoothingQuality = 'high';
    oc.drawImage(canvas, 0, 0, targetWidth, targetHeight);
    return cf.toBlob(out, format, quality);
}

/* ============================================================
   COMPRESS — 포맷 변환 + 품질
   ============================================================ */
async function opCompress(bitmap, config, cf) {
    const { format, quality } = config;
    const canvas = cf.create(bitmap.width, bitmap.height);
    canvas.getContext('2d', { alpha: format !== 'image/jpeg' }).drawImage(bitmap, 0, 0);
    return cf.toBlob(canvas, format, quality);
}

/* ============================================================
   SHARPEN — Unsharp Mask (사진용)
   ============================================================ */
async function opSharpen(bitmap, config, cf) {
    const { strength, radius } = config;
    const { width, height }    = bitmap;
    const canvas = cf.create(width, height);
    const ctx    = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const imgData = ctx.getImageData(0, 0, width, height);
    unsharpMask(imgData.data, width, height, radius, strength);
    ctx.putImageData(imgData, 0, 0);
    return cf.toBlob(canvas, 'image/jpeg', 0.93);
}

/* ============================================================
   DRAWING — 도면 선명화
   ============================================================ */
async function opDrawing(bitmap, config, cf) {
    const { strength, binarize, threshold } = config;
    const { width, height } = bitmap;
    const canvas = cf.create(width, height);
    const ctx    = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const imgData = ctx.getImageData(0, 0, width, height);
    const data    = imgData.data;

    // 1. 회색조
    for (let i = 0; i < data.length; i += 4) {
        const g = Math.round(0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2]);
        data[i] = data[i+1] = data[i+2] = g;
    }
    // 2. Unsharp Mask
    unsharpMask(data, width, height, 1, strength);
    // 3. 대비 강화
    for (let i = 0; i < data.length; i += 4) {
        for (let c = 0; c < 3; c++) data[i+c] = clamp((data[i+c] - 128) * 1.6 + 128);
    }
    // 4. 이진화
    if (binarize) {
        for (let i = 0; i < data.length; i += 4) {
            const v = data[i] >= threshold ? 255 : 0;
            data[i] = data[i+1] = data[i+2] = v;
        }
    }

    ctx.putImageData(imgData, 0, 0);
    return cf.toBlob(canvas, binarize ? 'image/png' : 'image/jpeg', 0.95);
}

/* ============================================================
   SCAN — 스캔 문서 보정
   ============================================================ */
async function opScan(bitmap, config, cf) {
    const { mode, contrast } = config;
    const { width, height }  = bitmap;
    const canvas = cf.create(width, height);
    const ctx    = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const imgData = ctx.getImageData(0, 0, width, height);
    const data    = imgData.data;

    // 1. 회색조 (bw/gray)
    if (mode !== 'color') {
        for (let i = 0; i < data.length; i += 4) {
            const g = Math.round(0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2]);
            data[i] = data[i+1] = data[i+2] = g;
        }
    }
    // 2. Auto-levels (백분위 스트레칭)
    autoLevels(data, mode === 'color');
    // 3. 대비
    for (let i = 0; i < data.length; i += 4) {
        for (let c = 0; c < 3; c++) data[i+c] = clamp((data[i+c] - 128) * contrast + 128);
    }
    // 4. 흑백 임계값
    if (mode === 'bw') {
        for (let i = 0; i < data.length; i += 4) {
            const v = data[i] > 155 ? 255 : 0;
            data[i] = data[i+1] = data[i+2] = v;
        }
    }

    ctx.putImageData(imgData, 0, 0);
    return cf.toBlob(canvas, mode === 'bw' ? 'image/png' : 'image/jpeg', 0.95);
}

/* ============================================================
   PRIMITIVES
   ============================================================ */
function unsharpMask(data, width, height, radius, amount) {
    const blurred = separableBoxBlur(data, width, height, Math.max(1, Math.round(radius)));
    for (let i = 0; i < data.length; i += 4) {
        for (let c = 0; c < 3; c++) {
            data[i+c] = clamp(Math.round(data[i+c] + amount * (data[i+c] - blurred[i+c])));
        }
    }
}

function separableBoxBlur(src, width, height, r) {
    const size = 2 * r + 1;
    const tmp  = new Uint8ClampedArray(src.length);
    const out  = new Uint8ClampedArray(src.length);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let rs = 0, gs = 0, bs = 0;
            for (let dx = -r; dx <= r; dx++) {
                const nx = Math.min(width-1, Math.max(0, x+dx));
                const i  = (y * width + nx) * 4;
                rs += src[i]; gs += src[i+1]; bs += src[i+2];
            }
            const i = (y * width + x) * 4;
            tmp[i] = rs/size; tmp[i+1] = gs/size; tmp[i+2] = bs/size; tmp[i+3] = src[i+3];
        }
    }
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let rs = 0, gs = 0, bs = 0;
            for (let dy = -r; dy <= r; dy++) {
                const ny = Math.min(height-1, Math.max(0, y+dy));
                const i  = (ny * width + x) * 4;
                rs += tmp[i]; gs += tmp[i+1]; bs += tmp[i+2];
            }
            const i = (y * width + x) * 4;
            out[i] = rs/size; out[i+1] = gs/size; out[i+2] = bs/size; out[i+3] = tmp[i+3];
        }
    }
    return out;
}

function autoLevels(data, perChannel) {
    if (perChannel) {
        for (let c = 0; c < 3; c++) {
            const vals = [];
            for (let i = c; i < data.length; i += 4) vals.push(data[i]);
            vals.sort((a, b) => a - b);
            const lo = vals[Math.floor(vals.length * 0.02)] ?? 0;
            const hi = vals[Math.floor(vals.length * 0.98)] ?? 255;
            const rng = hi - lo || 1;
            for (let i = c; i < data.length; i += 4) {
                data[i] = clamp(Math.round((data[i] - lo) / rng * 255));
            }
        }
    } else {
        const step = Math.max(1, Math.floor(data.length / (4 * 5000)));
        const samp = [];
        for (let i = 0; i < data.length; i += 4 * step) samp.push(data[i]);
        samp.sort((a, b) => a - b);
        const lo  = samp[Math.floor(samp.length * 0.02)] ?? 0;
        const hi  = samp[Math.floor(samp.length * 0.98)] ?? 255;
        const rng = hi - lo || 1;
        for (let i = 0; i < data.length; i += 4) {
            const v = clamp(Math.round((data[i] - lo) / rng * 255));
            data[i] = data[i+1] = data[i+2] = v;
        }
    }
}

function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }
