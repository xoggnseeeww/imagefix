/**
 * 바이브코딩 v1.2.5 - Environment & Support Guard
 * 역할: 기기 사양 감지 및 iOS Canvas 크래시 방어
 */

const SupportGuard = {
    // iOS 기기 여부 확인
    isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent) || 
           (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),

    /**
     * [v1.2.5 핵심] iOS의 치명적인 캔버스 면적 제한(16,777,216 px) 체크
     * @param {number} width 
     * @param {number} height 
     * @returns {Object} { safe: boolean, factor: number }
     */
    checkCanvasSafety(width, height) {
        const AREA_LIMIT = 16777216; // iOS Safari Max Area
        const currentArea = width * height;

        if (this.isIOS && currentArea > AREA_LIMIT) {
            // 제한을 초과할 경우 안전한 축소 비율 계산
            const factor = Math.sqrt(AREA_LIMIT / currentArea) * 0.95; 
            return { safe: false, recommendedFactor: factor };
        }

        return { safe: true, recommendedFactor: 1 };
    },

    /**
     * 브라우저의 최신 API 지원 여부 확인
     */
    getCapabilities() {
        return {
            offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
            webWorker: typeof Worker !== 'undefined',
            gpuAcceleration: !!window.chrome || !!navigator.gpu
        };
    },

    /**
     * 저사양 모드 진입 여부 결정
     */
    shouldUseLowResPreview() {
        // iOS이거나 메모리 정보가 낮을 때 true 반환 (지원 브라우저 한정)
        return this.isIOS || (navigator.deviceMemory && navigator.navigator.deviceMemory < 4);
    }
};

export default SupportGuard;