/**
 * 바이브코딩 v1.2.5 - Master Controller
 * 주요 기능: 배치 큐 관리, 워커 오케스트레이션, PDF/ZIP 생성, UI 인터락
 */

let queue = [];
let isEditorOpen = false;
let imageWorker = new Worker('js/image.worker.js');
const usedNames = new Set(); // 파일명 중복 방지용

// [v1.2.5] 페이지 이탈 방지
window.addEventListener('beforeunload', (e) => {
    if (queue.length > 0) {
        e.preventDefault();
        e.returnValue = '';
    }
});

// 드롭존 및 버튼 이벤트 연결
document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const startBatchBtn = document.getElementById('startBatchBtn');
    const exportPdfBtn = document.getElementById('exportPdfBtn');

    dropZone.onclick = () => fileInput.click();
    fileInput.onchange = (e) => handleFiles(e.target.files);
    
    startBatchBtn.onclick = () => startBatchProcessing();
    exportPdfBtn.onclick = () => handlePDFExport();

    // 테마 토글 로직 등...
});

/**
 * [v1.2.5] 파일 처리 로직 (중복 네이밍 방지 포함)
 */
function handleFiles(files) {
    for (const file of files) {
        const uniqueName = generateUniqueName(file.name, usedNames);
        const item = {
            id: Date.now() + Math.random(),
            file: file,
            name: uniqueName,
            status: 'ready',
            processedBlob: null
        };
        queue.push(item);
        renderQueueItem(item);
    }
}

/**
 * [v1.2.5] 워커 타임아웃 래퍼 (시스템 강건성)
 */
function processWithTimeout(worker, message, timeoutMs = 15000) {
    return Promise.race([
        new Promise((resolve, reject) => {
            const handler = (e) => {
                worker.removeEventListener('message', handler);
                resolve(e.data);
            };
            worker.addEventListener('message', handler);
            worker.postMessage(message, message.originalExif ? [message.originalExif] : []);
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), timeoutMs))
    ]);
}

/**
 * [v1.2.5] 원자적 배치 처리 (Atomic Batch)
 */
async function startBatchProcessing() {
    if (isEditorOpen) return alert("편집을 먼저 완료해주세요.");
    
    showLoading("이미지 변환 중...");
    const zip = new JSZip();
    let successCount = 0;

    for (const item of queue) {
        try {
            updateStatus(item.id, 'processing');
            
            const result = await processWithTimeout(imageWorker, {
                file: item.file,
                config: getGlobalConfig()
            });

            item.processedBlob = new Blob([result.result], { type: item.file.type });
            zip.file(item.name, item.processedBlob);
            updateStatus(item.id, 'success');
            successCount++;
        } catch (err) {
            console.error(err);
            updateStatus(item.id, 'failed');
        }
    }

    if (successCount > 0) {
        const content = await zip.generateAsync({ type: "blob" });
        saveAs(content, `vibecoding_${Date.now()}.zip`);
    }
    
    hideLoading();
    alert(`작업 완료! (성공: ${successCount} / 실패: ${queue.length - successCount})`);
}

/**
 * [v1.2.5] PDF 메모리 세이프가드
 */
async function handlePDFExport() {
    const MAX_SAFE_SIZE = 200 * 1024 * 1024;
    let totalSize = queue.reduce((acc, curr) => acc + (curr.processedBlob?.size || 0), 0);

    if (totalSize > MAX_SAFE_SIZE && !confirm("용량이 너무 커서 브라우저가 멈출 수 있습니다. 진행할까요?")) return;

    // jsPDF 병합 로직...
}

// 헬퍼 함수들 (generateUniqueName, updateStatus 등) 생략...
