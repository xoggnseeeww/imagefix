/**
 * 바이브코딩 v1.2.5 - Image Worker
 * 주요 기능: Step-down 리사이징, EXIF Orientation 초기화 및 주입
 */

self.onmessage = async (e) => {
    const { file, config, originalExif } = e.data;

    try {
        // 1. 이미지 비트맵 생성
        const bitmap = await createImageBitmap(file);
        
        // 2. 리사이즈 수행 (Step-down 알고리즘)
        const canvas = await resizeStepDown(bitmap, config);
        
        // 3. 캔버스에서 Blob 추출
        const blob = await canvas.convertToBlob({
            type: config.format || 'image/jpeg',
            quality: config.quality || 0.85
        });

        let finalBuffer = await blob.arrayBuffer();

        // 4. [v1.2.5 핵심] EXIF 보존 및 이중 회전 방지
        if (originalExif && (config.format === 'image/jpeg' || !config.format)) {
            const cleanExif = resetOrientation(originalExif);
            finalBuffer = injectExif(finalBuffer, cleanExif);
        }

        self.postMessage({ result: finalBuffer }, [finalBuffer]);
    } catch (err) {
        self.postMessage({ error: err.message });
    }
};

/**
 * [v1.2.5] EXIF Orientation 값을 1(정상)로 강제 패칭
 */
function resetOrientation(exifBuffer) {
    const view = new DataView(exifBuffer);
    const isLittleEndian = view.getUint16(0) === 0x4949;
    let offset = view.getUint32(4, isLittleEndian);
    const tags = view.getUint16(offset, isLittleEndian);
    offset += 2;

    for (let i = 0; i < tags; i++) {
        if (view.getUint16(offset, isLittleEndian) === 0x0112) {
            view.setUint16(offset + 8, 1, isLittleEndian); // Orientation = 1
            break;
        }
        offset += 12;
    }
    return exifBuffer;
}

/**
 * 고화질 Step-down 리사이징 알고리즘
 */
async function resizeStepDown(bitmap, config) {
    let width = bitmap.width;
    let height = bitmap.height;
    const targetWidth = config.width || width;

    const offscreen = new OffscreenCanvas(width, height);
    const ctx = offscreen.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);

    // 50%씩 단계적 축소 (Aliasing 방지)
    while (width > targetWidth * 2) {
        width = Math.floor(width / 2);
        height = Math.floor(height / 2);
        const tempCanvas = new OffscreenCanvas(width, height);
        tempCanvas.getContext('2d').drawImage(offscreen, 0, 0, width, height);
        offscreen.width = width;
        offscreen.height = height;
        offscreen.getContext('2d').drawImage(tempCanvas, 0, 0);
    }

    // 최종 사이즈 조정
    const finalCanvas = new OffscreenCanvas(targetWidth, Math.floor(height * (targetWidth / width)));
    finalCanvas.getContext('2d').drawImage(offscreen, 0, 0, finalCanvas.width, finalCanvas.height);
    
    return finalCanvas;
}

// injectExif(binary patching) 함수 생략...
