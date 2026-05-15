/**
 * image.worker.js — Web Worker 엔트리
 * OffscreenCanvas 환경에서만 실행됨.
 * 처리 로직은 image-process.js 공유 모듈에서 import.
 */
import { processImage } from './image-process.js';

// Worker용 CanvasFactory
const cf = {
    create: (w, h) => new OffscreenCanvas(w, h),
    toBlob: (canvas, type, quality) => canvas.convertToBlob({ type, quality })
};

self.onmessage = async ({ data }) => {
    const { type, id, bitmap, config } = data;
    try {
        const blob = await processImage(type, bitmap, config, cf);
        // Fix: Blob은 copy 전송 (Transferable 사용 시 detach 버그)
        self.postMessage({ id, status: 'success', blob });
    } catch (err) {
        self.postMessage({ id, status: 'error', message: err.message });
    }
};
