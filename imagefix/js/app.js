import { Memory } from './memory.js';

/* ============================================================
   TAB METADATA
   ============================================================ */
const TAB_CONFIG = {
    resize:  { accept: 'image/*', hint: 'JPEG · PNG · WebP', multi: true },
    compress:{ accept: 'image/*', hint: 'JPEG · PNG · WebP', multi: true },
    sharpen: { accept: 'image/*', hint: 'JPEG · PNG · WebP', multi: true },
    drawing: { accept: 'image/*', hint: 'JPEG · PNG · WebP', multi: true },
    scan:    { accept: 'image/*', hint: 'JPEG · PNG · WebP', multi: true },
    pdf2jpg: { accept: '.pdf',    hint: 'PDF 파일',           multi: true },
    jpg2pdf: { accept: 'image/*', hint: 'JPEG · PNG · WebP · 순서대로 선택', multi: true },
};

function getOptionsHTML(tab) {
    switch (tab) {
        case 'resize': return `
<div class="opts-grid">
  <label><span class="lbl">너비 px</span><input type="number" id="opt-width" value="1920" min="1" max="8000"></label>
  <label><span class="lbl">높이 px</span><input type="number" id="opt-height" value="1080" min="1" max="8000"></label>
  <label><span class="lbl">형식</span>
    <select id="opt-format">
      <option value="image/jpeg">JPEG</option>
      <option value="image/webp">WebP</option>
      <option value="image/png">PNG</option>
    </select>
  </label>
  <label><span class="lbl">품질</span>
    <input type="range" id="opt-quality" min="0.1" max="1" step="0.05" value="0.85">
    <span class="range-val" data-for="opt-quality">85%</span>
  </label>
  <label class="checkbox-label">
    <input type="checkbox" id="opt-ratio" checked> 비율 유지 (Fit)
  </label>
</div>`;
        case 'compress': return `
<div class="opts-grid">
  <label><span class="lbl">형식</span>
    <select id="opt-format">
      <option value="image/jpeg">JPEG</option>
      <option value="image/webp">WebP</option>
      <option value="image/png">PNG (무손실)</option>
    </select>
  </label>
  <label><span class="lbl">품질</span>
    <input type="range" id="opt-quality" min="0.1" max="1" step="0.05" value="0.7">
    <span class="range-val" data-for="opt-quality">70%</span>
  </label>
</div>`;
        case 'sharpen': return `
<div class="opts-grid">
  <label><span class="lbl">선명도</span>
    <input type="range" id="opt-strength" min="0.5" max="3" step="0.1" value="1.5">
    <span class="range-val" data-for="opt-strength">1.5</span>
  </label>
  <label><span class="lbl">반경</span>
    <input type="range" id="opt-radius" min="1" max="5" step="1" value="2">
    <span class="range-val" data-for="opt-radius">2px</span>
  </label>
</div>`;
        case 'drawing': return `
<div class="opts-grid">
  <label><span class="lbl">선명도</span>
    <input type="range" id="opt-strength" min="1" max="5" step="0.1" value="2.5">
    <span class="range-val" data-for="opt-strength">2.5</span>
  </label>
  <label class="checkbox-label">
    <input type="checkbox" id="opt-binarize"> 흑백 변환 (라인 추출)
  </label>
  <label><span class="lbl">임계값</span>
    <input type="range" id="opt-threshold" min="64" max="220" step="4" value="128">
    <span class="range-val" data-for="opt-threshold">128</span>
  </label>
</div>`;
        case 'scan': return `
<div class="opts-grid">
  <label><span class="lbl">출력 모드</span>
    <select id="opt-mode">
      <option value="bw">흑백 (문서용)</option>
      <option value="gray">회색조</option>
      <option value="color">컬러 보정</option>
    </select>
  </label>
  <label><span class="lbl">대비</span>
    <input type="range" id="opt-contrast" min="0.8" max="3" step="0.1" value="1.6">
    <span class="range-val" data-for="opt-contrast">1.6</span>
  </label>
</div>`;
        case 'pdf2jpg': return `
<div class="opts-grid">
  <label><span class="lbl">해상도</span>
    <select id="opt-dpi">
      <option value="72">72 DPI — 저화질</option>
      <option value="96">96 DPI</option>
      <option value="150" selected>150 DPI — 권장</option>
      <option value="200">200 DPI — 고화질</option>
      <option value="300">300 DPI — 인쇄용</option>
    </select>
  </label>
  <label><span class="lbl">JPEG 품질</span>
    <input type="range" id="opt-quality" min="0.5" max="1" step="0.05" value="0.92">
    <span class="range-val" data-for="opt-quality">92%</span>
  </label>
</div>`;
        case 'jpg2pdf': return `
<div class="opts-grid">
  <label><span class="lbl">페이지 크기</span>
    <select id="opt-pagesize">
      <option value="original">원본 크기</option>
      <option value="a4">A4 (210×297mm)</option>
      <option value="letter">Letter (216×279mm)</option>
    </select>
  </label>
</div>`;
    }
    return '';
}

/* ============================================================
   IMAGE WORKER WRAPPER  (Bug fixes: path, pending map, no null Transfer)
   ============================================================ */
class ImageWorker {
    constructor() {
        // Fix #2: use import.meta.url so GitHub Pages subdirectory works
        this.worker = new Worker(
            new URL('./image.worker.js', import.meta.url),
            { type: 'module' }
        );
        this.pending = new Map();

        this.worker.onmessage = ({ data }) => {
            const cb = this.pending.get(data.id);
            if (!cb) return;
            this.pending.delete(data.id);
            if (data.status === 'success') cb.resolve(data.blob);
            else cb.reject(new Error(data.message));
        };

        this.worker.onerror = (e) => {
            console.error('Worker error:', e.message);
        };
    }

    run(type, file, config) {
        return new Promise(async (resolve, reject) => {
            try {
                const id = crypto.randomUUID();
                const bitmap = await createImageBitmap(file);
                // Fix #3: never include null in Transferable list
                this.pending.set(id, { resolve, reject });
                this.worker.postMessage({ type, id, bitmap, config }, [bitmap]);
            } catch (err) {
                reject(err);
            }
        });
    }
}

/* ============================================================
   LAZY PDF SCRIPT LOADERS
   ============================================================ */
const _loaded = {};
function loadScript(src) {
    if (_loaded[src]) return _loaded[src];
    _loaded[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error(`스크립트 로드 실패: ${src}`));
        document.head.appendChild(s);
    });
    return _loaded[src];
}

async function loadPDFJS() {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    return window.pdfjsLib;
}

async function loadPDFLib() {
    await loadScript('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js');
    return window.PDFLib;
}

/* ============================================================
   UTILITIES
   ============================================================ */
function fmtSize(bytes) {
    if (bytes < 1024)       return bytes + ' B';
    if (bytes < 1048576)    return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(2) + ' MB';
}

function statusLabel(s) {
    return { pending: '대기', processing: '처리중…', done: '완료', error: '오류' }[s] ?? s;
}

function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function ext(mimeOrFile) {
    if (typeof mimeOrFile === 'string') {
        const m = { 'image/jpeg':'jpg','image/webp':'webp','image/png':'png','application/pdf':'pdf' };
        return m[mimeOrFile] ?? 'jpg';
    }
    return mimeOrFile.name.replace(/^.*\./, '').toLowerCase();
}

function baseName(file) {
    return file.name.replace(/\.[^.]+$/, '');
}

/* ============================================================
   APP CONTROLLER
   ============================================================ */
class App {
    constructor() {
        this.imgWorker  = new ImageWorker();
        this.tab        = 'resize';
        this.queue      = [];   // [{ id, file, status, blob }]
        this.results    = [];   // Blob[]
        this.resNames   = [];   // string[]

        this.$drop      = document.getElementById('drop-zone');
        this.$input     = document.getElementById('file-input');
        this.$opts      = document.getElementById('options-panel');
        this.$qsect     = document.getElementById('queue-section');
        this.$qlist     = document.getElementById('queue-list');
        this.$qcount    = document.getElementById('queue-count');
        this.$startBtn  = document.getElementById('start-btn');
        this.$dlBtn     = document.getElementById('download-btn');
        this.$progress  = document.getElementById('global-progress');
        this.$bar       = document.getElementById('progress-bar');

        this._initTabs();
        this._initDrop();
        this._initButtons();
        this._initRangeLabels();
        this._renderOptions();
    }

    _initTabs() {
        document.querySelectorAll('.tab').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.dataset.tab === this.tab) return;
                this.tab = btn.dataset.tab;
                document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.queue = [];
                this.results = [];
                this.resNames = [];
                this.$dlBtn.classList.add('hidden');
                this._renderOptions();
                this._renderQueue();
            });
        });
    }

    _initDrop() {
        const zone = this.$drop;
        zone.addEventListener('click', () => this.$input.click());
        this.$input.addEventListener('change', e => {
            this._handleFiles(Array.from(e.target.files));
            e.target.value = '';
        });
        zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
        zone.addEventListener('drop', e => {
            e.preventDefault();
            zone.classList.remove('drag-over');
            this._handleFiles(Array.from(e.dataTransfer.files));
        });
    }

    _initButtons() {
        this.$startBtn.addEventListener('click', () => this._start());
        this.$dlBtn.addEventListener('click', () => this._download());
        document.getElementById('clear-btn').addEventListener('click', () => {
            this.queue = [];
            this.results = [];
            this.resNames = [];
            this.$dlBtn.classList.add('hidden');
            this._renderQueue();
        });
    }

    _initRangeLabels() {
        // Event delegation for dynamically rendered range inputs
        document.addEventListener('input', e => {
            if (e.target.type !== 'range') return;
            const span = document.querySelector(`[data-for="${e.target.id}"]`);
            if (!span) return;
            const v = parseFloat(e.target.value);
            if (e.target.id.includes('quality')) span.textContent = Math.round(v * 100) + '%';
            else if (e.target.id === 'opt-radius') span.textContent = v + 'px';
            else span.textContent = v;
        });
    }

    _renderOptions() {
        const cfg = TAB_CONFIG[this.tab];
        this.$input.accept   = cfg.accept;
        this.$input.multiple = cfg.multi;
        document.getElementById('drop-sub').textContent = cfg.hint;
        this.$opts.innerHTML = getOptionsHTML(this.tab);
    }

    _handleFiles(files) {
        const isPDF = this.tab === 'pdf2jpg';
        const valid = files.filter(f =>
            isPDF ? f.type === 'application/pdf' : f.type.startsWith('image/')
        );
        if (valid.length === 0) return;
        valid.forEach(f => this.queue.push({ id: crypto.randomUUID(), file: f, status: 'pending', blob: null }));
        this._renderQueue();
    }

    _renderQueue() {
        const n = this.queue.length;
        this.$qcount.textContent = n;
        if (n === 0) { this.$qsect.classList.add('hidden'); return; }
        this.$qsect.classList.remove('hidden');
        this.$qlist.innerHTML = this.queue.map(item => `
            <div class="queue-item" data-id="${item.id}">
                <span class="q-name" title="${item.file.name}">${item.file.name}</span>
                <span class="q-size">${fmtSize(item.file.size)}</span>
                <span class="q-badge ${item.status}">${statusLabel(item.status)}</span>
            </div>`).join('');
    }

    _updateItem(id, status, blob = null) {
        const item = this.queue.find(i => i.id === id);
        if (!item) return;
        item.status = status;
        if (blob) item.blob = blob;
        const el = this.$qlist.querySelector(`[data-id="${id}"]`);
        if (!el) return;
        el.querySelector('.q-badge').className = `q-badge ${status}`;
        el.querySelector('.q-badge').textContent = statusLabel(status);
        if (blob) el.querySelector('.q-size').textContent = `${fmtSize(item.file.size)} → ${fmtSize(blob.size)}`;
    }

    _setProgress(done, total) {
        const pct = total > 0 ? Math.round(done / total * 100) : 0;
        this.$progress.classList.remove('hidden');
        this.$bar.style.width = pct + '%';
        if (done >= total) setTimeout(() => {
            this.$progress.classList.add('hidden');
            this.$bar.style.width = '0%';
        }, 1200);
    }

    _getConfig() {
        const v  = id => { const el = document.getElementById(id); return el?.value ?? null; };
        const vf = id => parseFloat(v(id));
        const vi = id => parseInt(v(id));
        const vc = id => document.getElementById(id)?.checked ?? false;

        switch (this.tab) {
            case 'resize':  return { targetWidth: vi('opt-width') || 1920, targetHeight: vi('opt-height') || 1080,
                                     format: v('opt-format') || 'image/jpeg', quality: vf('opt-quality') || 0.85,
                                     keepRatio: vc('opt-ratio') };
            case 'compress':return { format: v('opt-format') || 'image/jpeg', quality: vf('opt-quality') || 0.7 };
            case 'sharpen': return { strength: vf('opt-strength') || 1.5, radius: vi('opt-radius') || 2 };
            case 'drawing': return { strength: vf('opt-strength') || 2.5, binarize: vc('opt-binarize'),
                                     threshold: vi('opt-threshold') || 128 };
            case 'scan':    return { mode: v('opt-mode') || 'bw', contrast: vf('opt-contrast') || 1.6 };
            case 'pdf2jpg': return { dpi: vi('opt-dpi') || 150, quality: vf('opt-quality') || 0.92 };
            case 'jpg2pdf': return { pageSize: v('opt-pagesize') || 'original' };
        }
    }

    /* ---- MAIN ENTRY ---- */
    async _start() {
        if (this.queue.length === 0) return;
        this.$startBtn.disabled = true;
        this.$dlBtn.classList.add('hidden');
        this.results  = [];
        this.resNames = [];

        const config = this._getConfig();
        const total  = this.queue.length;
        let   done   = 0;

        try {
            if (this.tab === 'jpg2pdf') {
                await this._runJPGtoPDF(config);
            } else if (this.tab === 'pdf2jpg') {
                for (const item of this.queue) {
                    this._updateItem(item.id, 'processing');
                    try {
                        const blobs = await this._runPDFtoJPG(item.file, config);
                        blobs.forEach((b, i) => {
                            this.results.push(b);
                            this.resNames.push(`${baseName(item.file)}_p${String(i + 1).padStart(3, '0')}.jpg`);
                        });
                        this._updateItem(item.id, 'done', blobs[0]);
                    } catch (e) {
                        this._updateItem(item.id, 'error');
                        console.error(item.file.name, e);
                    }
                    this._setProgress(++done, total);
                    Memory.cleanup();
                }
            } else {
                for (const item of this.queue) {
                    this._updateItem(item.id, 'processing');
                    try {
                        const blob = await this.imgWorker.run(this.tab, item.file, config);
                        this.results.push(blob);
                        const outExt = ext(blob.type);
                        this.resNames.push(`${baseName(item.file)}_fix.${outExt}`);
                        this._updateItem(item.id, 'done', blob);
                    } catch (e) {
                        this._updateItem(item.id, 'error');
                        console.error(item.file.name, e);
                    }
                    this._setProgress(++done, total);
                    Memory.cleanup();
                }
            }
        } finally {
            this.$startBtn.disabled = false;
        }

        if (this.results.length > 0) this.$dlBtn.classList.remove('hidden');
    }

    /* ---- PDF → JPG (main thread, PDF.js) ---- */
    async _runPDFtoJPG(file, config) {
        const pdfjsLib = await loadPDFJS();
        const buf = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        const scale = config.dpi / 72;
        const blobs = [];

        for (let i = 1; i <= pdf.numPages; i++) {
            const page     = await pdf.getPage(i);
            const viewport = page.getViewport({ scale });
            const canvas   = document.createElement('canvas');
            canvas.width   = Math.round(viewport.width);
            canvas.height  = Math.round(viewport.height);
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
            const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', config.quality));
            blobs.push(blob);
        }
        return blobs;
    }

    /* ---- JPG → PDF (main thread, pdf-lib) ---- */
    async _runJPGtoPDF(config) {
        const PDFLib  = await loadPDFLib();
        const pdfDoc  = await PDFLib.PDFDocument.create();

        for (const item of this.queue) {
            this._updateItem(item.id, 'processing');
            try {
                const image = await this._embedImage(pdfDoc, PDFLib, item.file);
                const dims  = image.scale(1);
                let pw = dims.width, ph = dims.height;

                if (config.pageSize === 'a4') {
                    // Fit image to A4, preserve ratio
                    const ratio = Math.min(595.28 / pw, 841.89 / ph);
                    pw = Math.round(pw * ratio);
                    ph = Math.round(ph * ratio);
                    const page = pdfDoc.addPage([595.28, 841.89]);
                    page.drawImage(image, { x: (595.28 - pw) / 2, y: (841.89 - ph) / 2, width: pw, height: ph });
                } else if (config.pageSize === 'letter') {
                    const ratio = Math.min(612 / pw, 792 / ph);
                    pw = Math.round(pw * ratio);
                    ph = Math.round(ph * ratio);
                    const page = pdfDoc.addPage([612, 792]);
                    page.drawImage(image, { x: (612 - pw) / 2, y: (792 - ph) / 2, width: pw, height: ph });
                } else {
                    const page = pdfDoc.addPage([dims.width, dims.height]);
                    page.drawImage(image, { x: 0, y: 0, width: dims.width, height: dims.height });
                }
                this._updateItem(item.id, 'done');
            } catch (e) {
                this._updateItem(item.id, 'error');
                console.error(item.file.name, e);
            }
        }

        const bytes = await pdfDoc.save();
        const blob  = new Blob([bytes], { type: 'application/pdf' });
        this.results.push(blob);
        this.resNames.push('imagefix_combined.pdf');
        this._setProgress(1, 1);
    }

    async _embedImage(pdfDoc, PDFLib, file) {
        const bytes = await file.arrayBuffer();
        if (file.type === 'image/png') return pdfDoc.embedPng(bytes);
        if (file.type === 'image/jpeg') return pdfDoc.embedJpg(bytes);
        // WebP or other → convert to JPEG via canvas
        const bmp    = await createImageBitmap(file);
        const canvas = Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
        canvas.getContext('2d').drawImage(bmp, 0, 0);
        const blob  = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.92));
        return pdfDoc.embedJpg(await blob.arrayBuffer());
    }

    /* ---- DOWNLOAD ---- */
    async _download() {
        if (this.results.length === 0) return;
        if (this.results.length === 1) {
            saveBlob(this.results[0], this.resNames[0]);
            return;
        }
        const zip = new JSZip();
        this.results.forEach((b, i) => zip.file(this.resNames[i], b));
        const zblob = await zip.generateAsync({ type: 'blob' });
        saveBlob(zblob, 'imagefix_results.zip');
    }
}

new App();
