/* ============================================================
   IMAGE WORKER — 모든 이미지 처리 연산
   Fix: Worker path via import.meta.url (app.js)
   Fix: Blob은 Transferable 없이 copy 전송 (detach 버그 제거)
   ============================================================ */

self.onmessage = async (e) => {
    const { type, id, bitmap, config } = e.data;
    try {
        let blob;
        switch (type) {
            case 'resize':   blob = await opResize(bitmap, config);   break;
            case 'compress': blob = await opCompress(bitmap, config); break;
            case 'sharpen':  blob = await opSharpen(bitmap, config);  break;
            case 'drawing':  blob = await opDrawing(bitmap, config);  break;
            case 'scan':     blob = await opScan(bitmap, config);     break;
            default: throw new Error(`Unknown type: ${type}`);
        }
        // Fix #4: Blob은 구조적 복사(copy)로 전송 — ArrayBuffer transfer 금지
        self.postMessage({ id, status: 'success', blob });
    } catch (err) {
        self.postMessage({ id, status: 'error', message: err.message });
    }
};

/* ============================================================
   OP: RESIZE — step-down 알고리즘 (품질 보존)
   ============================================================ */
async function opResize(bitmap, config) {
    let { targetWidth, targetHeight, format, quality, keepRatio } = config;
    const srcW = bitmap.width;
    const srcH = bitmap.height;

    if (keepRatio) {
        const ratio = Math.min(targetWidth / srcW, targetHeight / srcH);
        targetWidth  = Math.round(srcW * ratio);
        targetHeight = Math.round(srcH * ratio);
    }

    // Step-down: 한 번에 50% 이상 축소 시 품질 저하 → 단계적 처리
    let curW = srcW, curH = srcH;
    let canvas = new OffscreenCanvas(curW, curH);
    let ctx = canvas.getContext('2d', { alpha: format !== 'image/jpeg' });
    ctx.drawImage(bitmap, 0, 0); // Bug fix: 최초 draw 누락 수정

    while (curW > targetWidth * 2 || curH > targetHeight * 2) {
        curW = Math.max(Math.floor(curW * 0.5), targetWidth);
        curH = Math.max(Math.floor(curH * 0.5), targetHeight);
        const tmp = new OffscreenCanvas(curW, curH);
        const tc  = tmp.getContext('2d');
        tc.imageSmoothingQuality = 'high';
        tc.drawImage(canvas, 0, 0, curW, curH);
        canvas = tmp; ctx = tc;
    }

    const out = new OffscreenCanvas(targetWidth, targetHeight);
    const oc  = out.getContext('2d');
    oc.imageSmoothingQuality = 'high';
    oc.drawImage(canvas, 0, 0, targetWidth, targetHeight);
    return out.convertToBlob({ type: format, quality });
}

/* ============================================================
   OP: COMPRESS — 포맷 변환 + 품질 조정
   ============================================================ */
async function opCompress(bitmap, config) {
    const { format, quality } = config;
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx    = canvas.getContext('2d', { alpha: format !== 'image/jpeg' });
    ctx.drawImage(bitmap, 0, 0);
    return canvas.convertToBlob({ type: format, quality });
}

/* ============================================================
   OP: SHARPEN — Unsharp Mask (사진용)
   ============================================================ */
async function opSharpen(bitmap, config) {
    const { strength, radius } = config;
    const { width, height } = bitmap;
    const canvas = new OffscreenCanvas(width, height);
    const ctx    = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const imgData = ctx.getImageData(0, 0, width, height);

    unsharpMask(imgData.data, width, height, radius, strength);

    ctx.putImageData(imgData, 0, 0);
    return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.93 });
}

/* ============================================================
   OP: DRAWING — 도면 선명화 (회색조 + 고대비 + 이진화 옵션)
   ============================================================ */
async function opDrawing(bitmap, config) {
    const { strength, binarize, threshold } = config;
    const { width, height } = bitmap;
    const canvas = new OffscreenCanvas(width, height);
    const ctx    = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const imgData = ctx.getImageData(0, 0, width, height);
    const data    = imgData.data;

    // 1. 회색조 변환
    for (let i = 0; i < data.length; i += 4) {
        const g = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
        data[i] = data[i + 1] = data[i + 2] = g;
    }

    // 2. Unsharp Mask (강도 높게)
    unsharpMask(data, width, height, 1, strength);

    // 3. 대비 강화
    const cf = 1.6;
    for (let i = 0; i < data.length; i += 4) {
        for (let c = 0; c < 3; c++) {
            data[i + c] = clamp((data[i + c] - 128) * cf + 128);
        }
    }

    // 4. 이진화 (라인 추출)
    if (binarize) {
        for (let i = 0; i < data.length; i += 4) {
            const v = data[i] >= threshold ? 255 : 0;
            data[i] = data[i + 1] = data[i + 2] = v;
        }
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas.convertToBlob({ type: binarize ? 'image/png' : 'image/jpeg', quality: 0.95 });
}

/* ============================================================
   OP: SCAN — 스캔 문서 보정
   Auto-levels (percentile) + 대비 + 모드별 출력
   ============================================================ */
async function opScan(bitmap, config) {
    const { mode, contrast } = config;
    const { width, height } = bitmap;
    const canvas = new OffscreenCanvas(width, height);
    const ctx    = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const imgData = ctx.getImageData(0, 0, width, height);
    const data    = imgData.data;

    // 1. 회색조 (bw/gray 모드)
    if (mode !== 'color') {
        for (let i = 0; i < data.length; i += 4) {
            const g = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
            data[i] = data[i + 1] = data[i + 2] = g;
        }
    }

    // 2. Auto-levels — percentile 방식 (극단값 이상치 제거)
    autoLevels(data, mode === 'color');

    // 3. 대비 조정
    for (let i = 0; i < data.length; i += 4) {
        for (let c = 0; c < 3; c++) {
            data[i + c] = clamp((data[i + c] - 128) * contrast + 128);
        }
    }

    // 4. 흑백 임계값 (bw 모드)
    if (mode === 'bw') {
        for (let i = 0; i < data.length; i += 4) {
            const v = data[i] > 155 ? 255 : 0;
            data[i] = data[i + 1] = data[i + 2] = v;
        }
    }

    ctx.putImageData(imgData, 0, 0);
    const fmt = mode === 'bw' ? 'image/png' : 'image/jpeg';
    return canvas.convertToBlob({ type: fmt, quality: 0.95 });
}

/* ============================================================
   IMAGE PROCESSING PRIMITIVES
   ============================================================ */

/**
 * Unsharp Mask = original + amount × (original − blurred)
 * 분리형 박스 블러(2-pass) 사용 → O(n) 복잡도
 */
function unsharpMask(data, width, height, radius, amount) {
    const blurred = separableBoxBlur(data, width, height, Math.max(1, Math.round(radius)));
    for (let i = 0; i < data.length; i += 4) {
        for (let c = 0; c < 3; c++) {
            data[i + c] = clamp(Math.round(data[i + c] + amount * (data[i + c] - blurred[i + c])));
        }
    }
}

/**
 * 분리형 Box Blur (수평 + 수직 패스)
 * 가우시안 근사로 충분한 품질, Worker에서 빠름
 */
function separableBoxBlur(src, width, height, r) {
    const size = 2 * r + 1;
    const tmp  = new Uint8ClampedArray(src.length);
    const out  = new Uint8ClampedArray(src.length);

    // 수평 패스
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let rS = 0, gS = 0, bS = 0;
            for (let dx = -r; dx <= r; dx++) {
                const nx = Math.min(width - 1, Math.max(0, x + dx));
                const i  = (y * width + nx) * 4;
                rS += src[i]; gS += src[i + 1]; bS += src[i + 2];
            }
            const i = (y * width + x) * 4;
            tmp[i] = rS / size; tmp[i + 1] = gS / size; tmp[i + 2] = bS / size; tmp[i + 3] = src[i + 3];
        }
    }

    // 수직 패스
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let rS = 0, gS = 0, bS = 0;
            for (let dy = -r; dy <= r; dy++) {
                const ny = Math.min(height - 1, Math.max(0, y + dy));
                const i  = (ny * width + x) * 4;
                rS += tmp[i]; gS += tmp[i + 1]; bS += tmp[i + 2];
            }
            const i = (y * width + x) * 4;
            out[i] = rS / size; out[i + 1] = gS / size; out[i + 2] = bS / size; out[i + 3] = src[i + 3];
        }
    }
    return out;
}

/**
 * Auto-levels: 2%~98% 백분위수로 히스토그램 스트레칭
 * 이상치(먼지, 빛 번짐) 제거 후 정규화
 */
function autoLevels(data, perChannel) {
    if (perChannel) {
        // 컬러 모드: 채널별 스트레칭 (색온도 보정)
        for (let c = 0; c < 3; c++) {
            const vals = [];
            for (let i = c; i < data.length; i += 4) vals.push(data[i]);
            vals.sort((a, b) => a - b);
            const lo  = vals[Math.floor(vals.length * 0.02)] ?? 0;
            const hi  = vals[Math.floor(vals.length * 0.98)] ?? 255;
            const rng = hi - lo || 1;
            for (let i = c; i < data.length; i += 4) {
                data[i] = clamp(Math.round((data[i] - lo) / rng * 255));
            }
        }
    } else {
        // 회색조 모드: 휘도 기준 스트레칭
        const step = Math.max(1, Math.floor(data.length / (4 * 5000)));
        const samp = [];
        for (let i = 0; i < data.length; i += 4 * step) samp.push(data[i]);
        samp.sort((a, b) => a - b);
        const lo  = samp[Math.floor(samp.length * 0.02)] ?? 0;
        const hi  = samp[Math.floor(samp.length * 0.98)] ?? 255;
        const rng = hi - lo || 1;
        for (let i = 0; i < data.length; i += 4) {
            const v = clamp(Math.round((data[i] - lo) / rng * 255));
            data[i] = data[i + 1] = data[i + 2] = v;
        }
    }
}

function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }
