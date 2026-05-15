self.onmessage = async (e) => {
    const { id, bitmap, config, originalHeader } = e.data;
    
    try {
        let currentWidth = bitmap.width;
        let currentHeight = bitmap.height;
        const targetWidth = config.targetWidth;
        const targetHeight = config.targetHeight;

        // 1. Step-down 리사이징 (50%씩 단계적 축소로 품질 보존)
        let canvas = new OffscreenCanvas(currentWidth, currentHeight);
        let ctx = canvas.getContext('2d', { alpha: false });

        while (currentWidth > targetWidth * 2) {
            currentWidth = Math.floor(currentWidth * 0.5);
            currentHeight = Math.floor(currentHeight * 0.5);
            const tempCanvas = new OffscreenCanvas(currentWidth, currentHeight);
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(canvas, 0, 0, currentWidth, currentHeight);
            canvas = tempCanvas;
            ctx = tempCtx;
        }

        // 최종 리사이즈
        const finalCanvas = new OffscreenCanvas(targetWidth, targetHeight);
        const finalCtx = finalCanvas.getContext('2d');
        finalCtx.imageSmoothingQuality = 'high';
        finalCtx.drawImage(canvas, 0, 0, targetWidth, targetHeight);

        // 2. Blob 생성
        const resultBlob = await finalCanvas.convertToBlob({
            type: config.format,
            quality: config.quality
        });

        // 3. EXIF 바이너리 주입 (Binary Patching)
        let finalOutput = resultBlob;
        if (originalHeader && config.format === 'image/jpeg') {
            finalOutput = await injectExif(resultBlob, originalHeader);
        }

        self.postMessage({ id, status: 'success', blob: finalOutput }, [await finalOutput.arrayBuffer()]);
    } catch (err) {
        self.postMessage({ id, status: 'error', message: err.message });
    }
};

async function injectExif(blob, headerBuffer) {
    const blobBuffer = await blob.arrayBuffer();
    const newBuffer = new Uint8Array(blobBuffer.byteLength + headerBuffer.byteLength);
    
    // JPEG SOI(FFD8) 직후에 EXIF 데이터 주입
    newBuffer.set(new Uint8Array(blobBuffer.slice(0, 2)), 0);
    newBuffer.set(new Uint8Array(headerBuffer), 2);
    newBuffer.set(new Uint8Array(blobBuffer.slice(2)), 2 + headerBuffer.byteLength);
    
    return new Blob([newBuffer], { type: 'image/jpeg' });
}