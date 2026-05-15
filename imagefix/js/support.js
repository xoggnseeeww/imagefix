export const Support = {
    // iOS Safari 단일 캔버스 픽셀 한계 (약 16.7MP)
    MAX_PIXELS: 16777216,

    async checkCapability() {
        return {
            offscreen: !!window.OffscreenCanvas,
            worker: !!window.Worker,
            bitmap: !!window.createImageBitmap
        };
    },

    // 안전한 해상도 반환 로직
    getSafeDimensions(width, height) {
        const totalPixels = width * height;
        if (totalPixels > this.MAX_PIXELS) {
            const ratio = Math.sqrt(this.MAX_PIXELS / totalPixels);
            return {
                width: Math.floor(width * ratio),
                height: Math.floor(height * ratio),
                isReduced: true
            };
        }
        return { width, height, isReduced: false };
    }
};