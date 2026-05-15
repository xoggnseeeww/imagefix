/**
 * 바이브코딩 v1.2.5 - Resource & Memory Manager
 * 역할: 대용량 이미지 자원의 명시적 해제 및 추적
 */

const MemoryManager = {
    // 추적 중인 Blob URL 리스트
    blobUrls: new Set(),

    /**
     * Blob URL을 생성하고 추적 목록에 등록
     */
    createObjectURL(blob) {
        const url = URL.createObjectURL(blob);
        this.blobUrls.add(url);
        return url;
    },

    /**
     * 특정 URL 하나를 해제
     */
    revoke(url) {
        if (this.blobUrls.has(url)) {
            URL.revokeObjectURL(url);
            this.blobUrls.delete(url);
        }
    },

    /**
     * [v1.2.5 핵심] 현재 등록된 모든 Blob URL을 일괄 해제
     * 주로 전체 삭제 버튼이나 배치 작업 완료 후 호출
     */
    purgeAll() {
        this.blobUrls.forEach(url => {
            URL.revokeObjectURL(url);
        });
        this.blobUrls.clear();
        console.log("All memory resources have been explicitly purged.");
    },

    /**
     * ImageBitmap 자원을 안전하게 닫음
     */
    terminateBitmap(bitmap) {
        if (bitmap && typeof bitmap.close === 'function') {
            bitmap.close();
        }
    }
};

export default MemoryManager;
