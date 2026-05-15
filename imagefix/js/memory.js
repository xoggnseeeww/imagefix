export const Memory = {
    revokeQueue: new Set(),

    // 추적할 URL 등록
    track(url) {
        if (url && url.startsWith('blob:')) {
            this.revokeQueue.add(url);
        }
    },

    // 명시적 자원 해제 (OOM 방어 핵심)
    cleanup() {
        this.revokeQueue.forEach(url => {
            URL.revokeObjectURL(url);
        });
        this.revokeQueue.clear();
        
        // 가비지 컬렉터 힌트
        if (window.gc) window.gc();
    }
};