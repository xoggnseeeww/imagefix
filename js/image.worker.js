self.onmessage = async function(e) {
    const { file, options, taskId } = e.data;

    try {
        // 1. EXIF 버퍼 백업 (Worker 내부에서 직접 처리)
        const exifBuffer = await extractExifBuffer(file);

        // 2. [최적화] 네이티브 고품질 리사이징
        const bitmap = await createImageBitmap(file, {
            resizeWidth: options.targetWidth,
            resizeQuality: 'high'
        });

        // 3. 비트맵을 캔버스로 변환
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);

        // 4. Blob 생성
        const mimeType = options.format || file.type;
        let processedBlob = await canvas.convertToBlob({
            type: mimeType,
            quality: options.quality || 0.8
        });

        // 5. EXIF 정보 복원 (JPEG 간 변환일 때만)
        if (exifBuffer && mimeType === 'image/jpeg') {
            processedBlob = await injectExifBuffer(processedBlob, exifBuffer);
        }

        bitmap.close(); // 메모리 해제

        self.postMessage({ status: 'success', taskId, blob: processedBlob, originalName: file.name });
    } catch (error) {
        self.postMessage({ status: 'error', taskId, reason: error.message });
    }
};

// --- Helper Functions (Binary Patching) ---
async function extractExifBuffer(file) {
    if (file.type !== 'image/jpeg') return null;
    const slice = file.slice(0, 65536);
    const buffer = await slice.arrayBuffer();
    const view = new DataView(buffer);
    if (view.getUint16(0) !== 0xFFD8) return null;
    let offset = 2;
    while (offset < view.byteLength) {
        const marker = view.getUint16(offset);
        const length = view.getUint16(offset + 2);
        if (marker === 0xFFE1) return buffer.slice(offset, offset + 2 + length);
        offset += 2 + length;
    }
    return null;
}

async function injectExifBuffer(blob, exifBuffer) {
    const buffer = await blob.arrayBuffer();
    return new Blob([buffer.slice(0, 2), exifBuffer, buffer.slice(2)], { type: 'image/jpeg' });
}
