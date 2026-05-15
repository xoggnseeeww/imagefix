export const Support = {
    MAX_PIXELS: 16_777_216, // iOS Safari 단일 캔버스 한계 (~16.7MP)

    async check() {
        return {
            offscreen: typeof OffscreenCanvas !== 'undefined',
            worker:    typeof Worker !== 'undefined',
            bitmap:    typeof createImageBitmap !== 'undefined',
        };
    },

    safeDimensions(w, h) {
        const total = w * h;
        if (total <= this.MAX_PIXELS) return { width: w, height: h, reduced: false };
        const r = Math.sqrt(this.MAX_PIXELS / total);
        return { width: Math.floor(w * r), height: Math.floor(h * r), reduced: true };
    }
};
