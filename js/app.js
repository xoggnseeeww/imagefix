/**
 * Worker Pool 매니저
 */
class WorkerPool {
    constructor(path, concurrency) {
        this.path = path;
        this.concurrency = concurrency;
        this.workers = Array.from({ length: concurrency }, () => new Worker(path));
        this.queue = [];
    }

    enqueue(data) {
        return new Promise((resolve, reject) => {
            this.queue.push({ data, resolve, reject });
            this.processNext();
        });
    }

    processNext() {
        if (!this.queue.length || !this.workers.length) return;
        const { data, resolve, reject } = this.queue.shift();
        const worker = this.workers.pop();

        const cleanUp = () => {
            worker.removeEventListener('message', handleMsg);
            worker.removeEventListener('error', handleErr);
            this.workers.push(worker);
            this.processNext();
        };

        const handleMsg = (e) => {
            if (e.data.status === 'success') resolve(e.data);
            else reject(new Error(e.data.reason));
            cleanUp();
        };

        const handleErr = (err) => {
            reject(err);
            cleanUp();
        };

        worker.addEventListener('message', handleMsg);
        worker.addEventListener('error', handleErr);
        worker.postMessage(data);
    }
}

// 초기화
const concurrency = (/iPad|iPhone|iPod/.test(navigator.userAgent)) ? 1 : Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) / 2));
const resizePool = new WorkerPool('js/image.worker.js', concurrency);
const exportWorker = new Worker('js/export.worker.js');

let processedFiles = [];

/**
 * 메인 실행 함수
 */
async function startProcessing(files, options) {
    processedFiles = [];
    document.getElementById('progress-container').classList.remove('hidden');

    const tasks = files.map(async (file, index) => {
        try {
            const result = await resizePool.enqueue({ file, options, taskId: index });
            processedFiles.push({ blob: result.blob, name: result.originalName });
            updateUIProgress(index, files.length);
        } catch (e) {
            console.error(e);
        }
    });

    await Promise.all(tasks);
    alert('모든 처리 완료!');
}

/**
 * ZIP 다운로드 호출
 */
function handleZipDownload() {
    exportWorker.postMessage({ action: 'createZip', files: processedFiles, filename: 'vibecoding_final.zip' });
    exportWorker.onmessage = (e) => {
        if (e.data.status === 'success') {
            const url = URL.createObjectURL(e.data.blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = e.data.filename;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 60000); // 1분 후 메모리 해제
        }
    };
}

function updateUIProgress(current, total) {
    const percent = ((current + 1) / total) * 100;
    document.getElementById('overall-progress').style.width = `${percent}%`;
}
