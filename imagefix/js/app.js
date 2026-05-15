import { Support } from './support.js';
import { Memory } from './memory.js';

class AppController {
    constructor() {
        this.queue = [];
        this.worker = new Worker('js/image.worker.js', { type: 'module' });
        this.initEvents();
    }

    initEvents() {
        const zone = document.getElementById('upload-zone');
        const input = document.getElementById('file-input');
        const startBtn = document.getElementById('start-batch-btn');

        zone.onclick = () => input.click();
        input.onchange = (e) => this.handleFiles(e.target.files);
        startBtn.onclick = () => this.processBatch();
    }

    async handleFiles(files) {
        for (const file of files) {
            this.queue.push({
                id: crypto.randomUUID(),
                file,
                name: file.name.split('.')[0],
                config: { targetWidth: 1920, targetHeight: 1080, format: 'image/jpeg', quality: 0.85 }
            });
        }
        this.renderQueue();
    }

    async processBatch() {
        const zip = new JSZip();
        for (const item of this.queue) {
            try {
                // 1. EXIF 헤더 추출 (Binary 레벨)
                const originalHeader = await this.extractExif(item.file);
                
                // 2. 비트맵 생성 및 워커 전송 (Transferables 사용)
                const bitmap = await createImageBitmap(item.file);
                this.worker.postMessage({
                    id: item.id,
                    bitmap,
                    config: item.config,
                    originalHeader
                }, [bitmap, originalHeader]);

                const result = await this.waitForWorker(item.id);
                zip.file(`${item.name}_vibe.jpg`, result.blob);
                
            } catch (error) {
                console.error(`실패: ${item.name}`, error); // 에러 격리 [cite: 175]
            } finally {
                Memory.cleanup(); // 파일별 처리 후 즉각 메모리 해제 [cite: 150]
            }
        }
        const content = await zip.generateAsync({ type: "blob" });
        this.saveAs(content, "vibecoding_final.zip");
    }

    async extractExif(file) {
        const buffer = await file.arrayBuffer();
        const view = new DataView(buffer);
        if (view.getUint16(0) !== 0xFFD8) return null; // JPEG 체크
        
        let offset = 2;
        while (offset < view.byteLength) {
            if (view.getUint16(offset) === 0xFFE1) { // EXIF APP1 마커
                const length = view.getUint16(offset + 2) + 2;
                return buffer.slice(offset, offset + length);
            }
            offset += 2 + view.getUint16(offset + 2);
        }
        return null;
    }

    // Helper functions (waitForWorker, saveAs, renderQueue... 생략)
}

new AppController();