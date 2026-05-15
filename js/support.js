export const Support = {
    isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent) || 
           (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),

    getCapabilities() {
        // [수정] navigator.navigator... 중첩 객체 호출 오류 해결
        const memory = navigator.deviceMemory || 4; 
        const cores = navigator.hardwareConcurrency || 2;
        
        return {
            isLowEnd: memory < 4 || this.isIOS,
            memory: memory,
            cores: cores,
            supportOffscreen: !!window.OffscreenCanvas
        };
    },

    shouldUseLowResPreview() {
        const caps = this.getCapabilities();
        return caps.isLowEnd;
    }
};
