import { Memory }       from './memory.js';
import { processImage } from './image-process.js';

/* ============================================================
   환경 감지
   ============================================================ */
const HAS_OFFSCREEN = typeof OffscreenCanvas !== 'undefined';
const IS_TOUCH      = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
const IS_IOS        = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const uuid = typeof crypto.randomUUID === 'function'
    ? () => crypto.randomUUID()
    : () => ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));

const esc = s => String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');

const MAIN_CF = {
    create(w, h) { const c = document.createElement('canvas'); c.width=w; c.height=h; return c; },
    toBlob: (canvas, type, quality) => new Promise(res => canvas.toBlob(res, type, quality))
};

const WORKER_TIMEOUT_MS = 12000;
function withTimeout(promise, ms = WORKER_TIMEOUT_MS) {
    return Promise.race([
        promise,
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
    ]);
}

/* ============================================================
   THEME
   ============================================================ */
const ICONS = { dark:'☀️', light:'🌙' };
function getTheme()    { return document.documentElement.getAttribute('data-theme') || 'dark'; }
function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('imagefix-theme', t);
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = ICONS[t];
}
function toggleTheme() { applyTheme(getTheme() === 'dark' ? 'light' : 'dark'); }

/* ============================================================
   SETTINGS PERSISTENCE
   ============================================================ */
const CFG_KEY = tab => `imagefix-cfg-${tab}`;
function saveOpts(tab) {
    const panel = document.getElementById('options-panel');
    if (!panel) return;
    const cfg = {};
    panel.querySelectorAll('input,select').forEach(el => {
        if (!el.id) return;
        cfg[el.id] = el.type === 'checkbox' ? el.checked : el.value;
    });
    try { localStorage.setItem(CFG_KEY(tab), JSON.stringify(cfg)); } catch {}
}
function restoreOpts(tab) {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(CFG_KEY(tab))); } catch {}
    if (!saved) return;
    const panel = document.getElementById('options-panel');
    if (!panel) return;
    panel.querySelectorAll('input,select').forEach(el => {
        if (!el.id || !(el.id in saved)) return;
        if (el.type === 'checkbox') el.checked = saved[el.id];
        else {
            el.value = saved[el.id];
            if (el.type === 'range') {
                const span = panel.querySelector(`[data-for="${el.id}"]`);
                if (span) span.textContent = fmtRangeVal(el.value, el.dataset.fmt || '');
            }
        }
    });
}

/* ============================================================
   TAB CONFIG
   ============================================================ */
const SEL = (v, l, sel=false) => ({ v, l, sel });
const VALID_IMG = new Set(['image/jpeg','image/png','image/webp','image/gif']);

const TAB_CONFIG = {
    resize: {
        accept:'image/*', hint:'JPEG · PNG · WebP', multi:true, hasPreview:true,
        opts:[
            { type:'number', id:'opt-width',   label:'너비 px', value:1920, min:1, max:8000 },
            { type:'number', id:'opt-height',  label:'높이 px', value:1080, min:1, max:8000 },
            { type:'select', id:'opt-format',  label:'형식',
              options:[SEL('image/jpeg','JPEG',true), SEL('image/webp','WebP'), SEL('image/png','PNG')] },
            { type:'range',  id:'opt-quality', label:'품질',  min:0.1, max:1, step:0.05, value:0.85, fmt:'pct' },
            { type:'check',  id:'opt-ratio',   label:'비율 유지', checked:true },
        ],
        getConfig: g => ({ targetWidth:g.int('opt-width')||1920, targetHeight:g.int('opt-height')||1080,
                           format:g.str('opt-format')||'image/jpeg', quality:g.float('opt-quality')||0.85,
                           keepRatio:g.bool('opt-ratio') }),
    },
    compress: {
        accept:'image/*', hint:'JPEG · PNG · WebP', multi:true, hasPreview:true,
        opts:[
            { type:'select', id:'opt-format', label:'형식',
              options:[SEL('image/jpeg','JPEG',true), SEL('image/webp','WebP'), SEL('image/png','PNG (무손실)')] },
            { type:'range',  id:'opt-quality', label:'품질', min:0.1, max:1, step:0.05, value:0.7, fmt:'pct' },
        ],
        getConfig: g => ({ format:g.str('opt-format')||'image/jpeg', quality:g.float('opt-quality')||0.7 }),
    },
    sharpen: {
        accept:'image/*', hint:'JPEG · PNG · WebP', multi:true, hasPreview:true,
        opts:[
            { type:'range', id:'opt-strength', label:'선명도', min:0.5, max:3,   step:0.1, value:1.5 },
            { type:'range', id:'opt-radius',   label:'반경',   min:1,   max:5,   step:1,   value:2,   fmt:'px' },
        ],
        getConfig: g => ({ strength:g.float('opt-strength')||1.5, radius:g.int('opt-radius')||2 }),
    },
    drawing: {
        accept:'image/*', hint:'JPEG · PNG · WebP', multi:true, hasPreview:true,
        opts:[
            { type:'range', id:'opt-strength',  label:'선명도', min:1,  max:5,   step:0.1, value:2.5 },
            { type:'check', id:'opt-binarize',  label:'흑백 변환 (라인 추출)' },
            { type:'range', id:'opt-threshold', label:'임계값', min:64, max:220, step:4,   value:128 },
        ],
        getConfig: g => ({ strength:g.float('opt-strength')||2.5, binarize:g.bool('opt-binarize'),
                           threshold:g.int('opt-threshold')||128 }),
    },
    scan: {
        accept:'image/*', hint:'JPEG · PNG · WebP', multi:true, hasPreview:true,
        opts:[
            { type:'select', id:'opt-mode', label:'출력 모드',
              options:[SEL('bw','흑백 (문서용)',true), SEL('gray','회색조'), SEL('color','컬러 보정')] },
            { type:'range', id:'opt-contrast', label:'대비', min:0.8, max:3, step:0.1, value:1.6 },
        ],
        getConfig: g => ({ mode:g.str('opt-mode')||'bw', contrast:g.float('opt-contrast')||1.6 }),
    },
    pdf2jpg: {
        accept:'.pdf', hint:'PDF 파일', multi:true, hasPreview:false,
        opts:[
            { type:'select', id:'opt-dpi', label:'해상도',
              options:[SEL('72','72 DPI'), SEL('96','96 DPI'), SEL('150','150 DPI — 권장',true),
                       SEL('200','200 DPI'), SEL('300','300 DPI — 인쇄용')] },
            { type:'range', id:'opt-quality', label:'JPEG 품질', min:0.5, max:1, step:0.05, value:0.92, fmt:'pct' },
        ],
        getConfig: g => ({ dpi:g.int('opt-dpi')||150, quality:g.float('opt-quality')||0.92 }),
    },
    jpg2pdf: {
        accept:'image/*', hint:'JPEG · PNG · WebP — 선택 순서 = 페이지 순서', multi:true, hasPreview:false,
        opts:[
            { type:'select', id:'opt-pagesize', label:'페이지 크기',
              options:[SEL('original','원본 크기',true), SEL('a4','A4 (210×297mm)'), SEL('letter','Letter (216×279mm)')] },
        ],
        getConfig: g => ({ pageSize:g.str('opt-pagesize')||'original' }),
    },
};

function fmtRangeVal(v, fmt) {
    if (fmt === 'pct') return Math.round(parseFloat(v) * 100) + '%';
    if (fmt === 'px')  return v + 'px';
    return v;
}
function renderOpts(opts) {
    return '<div class="opts-grid">' + opts.map(o => {
        switch (o.type) {
            case 'number':
                return `<label><span class="lbl">${o.label}</span><input type="number" id="${o.id}" value="${o.value}" min="${o.min}" max="${o.max}"></label>`;
            case 'select':
                return `<label><span class="lbl">${o.label}</span><select id="${o.id}">${o.options.map(op=>`<option value="${op.v}"${op.sel?' selected':''}>${op.l}</option>`).join('')}</select></label>`;
            case 'range':
                return `<label><span class="lbl">${o.label}</span><input type="range" id="${o.id}" min="${o.min}" max="${o.max}" step="${o.step}" value="${o.value}" data-fmt="${o.fmt||''}"><span class="range-val" data-for="${o.id}">${fmtRangeVal(o.value, o.fmt)}</span></label>`;
            case 'check':
                return `<label class="checkbox-label"><input type="checkbox" id="${o.id}"${o.checked?' checked':''}> ${o.label}</label>`;
        }
    }).join('') + '</div>';
}
function makeGetter() {
    const el = id => document.getElementById(id);
    return {
        str:   id => el(id)?.value ?? null,
        float: id => parseFloat(el(id)?.value),
        int:   id => parseInt(el(id)?.value),
        bool:  id => el(id)?.checked ?? false,
    };
}

/* ============================================================
   IMAGE PROCESSOR
   ============================================================ */
class ImageProcessor {
    constructor() {
        this._worker  = null;
        this._pending = new Map();
        this.mode     = HAS_OFFSCREEN ? 'worker' : 'fallback';
        if (HAS_OFFSCREEN) {
            try {
                this._worker = new Worker(new URL('./image.worker.js', import.meta.url), { type:'module' });
                this._worker.onmessage = ({ data }) => {
                    const cb = this._pending.get(data.id);
                    if (!cb) return;
                    this._pending.delete(data.id);
                    data.status === 'success' ? cb.resolve(data.blob) : cb.reject(new Error(data.message));
                };
                this._worker.onerror = () => { this.mode='fallback'; this._worker=null; };
            } catch { this.mode='fallback'; }
        }
    }
    async run(type, file, config) {
        const bitmap = await createImageBitmap(file);
        if (this.mode === 'worker' && this._worker) {
            const p = new Promise((resolve, reject) => {
                const id = uuid();
                this._pending.set(id, { resolve, reject });
                this._worker.postMessage({ type, id, bitmap, config }, [bitmap]);
            });
            try { return await withTimeout(p); }
            catch(e) {
                if (e.message === 'timeout') throw new Error('처리 시간 초과 (12초) — 파일이 손상되었거나 너무 클 수 있습니다');
                throw e;
            }
        }
        await new Promise(r => setTimeout(r, 0));
        return processImage(type, bitmap, config, MAIN_CF);
    }
}

/* ============================================================
   COMPARE SLIDER
   ============================================================ */
class CompareSlider {
    constructor() {
        this.$section = document.getElementById('preview-section');
        this.$wrap    = document.getElementById('compare-wrap');
        this._drag    = false; this._ac = null;
        this._blobBefore = null; this._blobAfter = null;

        this.$wrap.innerHTML = `
            <div class="compare-loading hidden" id="compare-loading"><div class="spinner"></div>미리보기 생성 중…</div>
            <img class="compare-img"               id="compare-before" alt="원본">
            <img class="compare-img compare-after" id="compare-after"  alt="처리 후">
            <div class="compare-line"   id="compare-line"></div>
            <div class="compare-handle" id="compare-handle"><div class="handle-knob">⇔</div></div>
            <span class="compare-label cl">원본</span>
            <span class="compare-label cr">처리 후</span>`;

        this.$before  = document.getElementById('compare-before');
        this.$after   = document.getElementById('compare-after');
        this.$line    = document.getElementById('compare-line');
        this.$handle  = document.getElementById('compare-handle');
        this.$loading = document.getElementById('compare-loading');
        this._apply(50); this._bindEvents();
    }
    async set(beforeFile, afterBlob, fname, stats) {
        this.$section.classList.remove('hidden');
        this.$loading.classList.remove('hidden');
        if (this._blobBefore) URL.revokeObjectURL(this._blobBefore);
        if (this._blobAfter)  URL.revokeObjectURL(this._blobAfter);
        this._blobBefore = URL.createObjectURL(beforeFile);
        this._blobAfter  = URL.createObjectURL(afterBlob);
        await Promise.all([this._loadImg(this.$before, this._blobBefore), this._loadImg(this.$after, this._blobAfter)]);
        this.$loading.classList.add('hidden');
        await new Promise(r => requestAnimationFrame(r));
        const wrapW = this.$wrap.offsetWidth || this.$wrap.getBoundingClientRect().width || 600;
        this.$wrap.style.height = Math.round(wrapW * this.$before.naturalHeight / (this.$before.naturalWidth || 1)) + 'px';
        this._apply(50);
        document.getElementById('preview-fname').textContent = fname;
        this._renderStats(stats);
    }
    _loadImg(el, src) { return new Promise((res, rej) => { el.onload=res; el.onerror=rej; el.src=src; }); }
    _renderStats(s) {
        const el = document.getElementById('preview-stats');
        if (!s) { el.innerHTML=''; return; }
        const cls   = s.afterSize < s.beforeSize ? 'better' : 'worse';
        const delta = s.beforeSize > 0 ? Math.round((s.afterSize - s.beforeSize) / s.beforeSize * 100) : 0;
        el.innerHTML = `
            <div class="preview-stat"><span class="stat-label">원본</span><span class="stat-val">${fmtSize(s.beforeSize)}</span></div>
            <div class="preview-stat"><span class="stat-label">처리 후</span><span class="stat-val ${cls}">${fmtSize(s.afterSize)} (${delta>0?'+':''}${delta}%)</span></div>
            ${s.beforeDim?`<div class="preview-stat"><span class="stat-label">크기</span><span class="stat-val">${s.beforeDim} → ${s.afterDim}</span></div>`:''}`;
    }
    _bindEvents() {
        if (this._ac) this._ac.abort();
        this._ac = new AbortController();
        const sig = { signal: this._ac.signal };
        const w   = this.$wrap;
        w.addEventListener('mousedown', e => { this._drag=true; this._move(e.clientX); }, sig);
        window.addEventListener('mousemove', e => { if (this._drag) this._move(e.clientX); }, sig);
        window.addEventListener('mouseup',   () => { this._drag=false; }, sig);
        w.addEventListener('touchstart', e => { this._drag=true; this._move(e.touches[0].clientX); }, { passive:true,  signal:this._ac.signal });
        w.addEventListener('touchmove',  e => { if (!this._drag) return; e.preventDefault(); this._move(e.touches[0].clientX); }, { passive:false, signal:this._ac.signal });
        window.addEventListener('touchend', () => { this._drag=false; }, sig);
    }
    _move(clientX) {
        const rect = this.$wrap.getBoundingClientRect();
        this._apply(Math.min(100, Math.max(0, (clientX - rect.left) / rect.width * 100)));
    }
    _apply(pct) {
        const p = pct.toFixed(2);
        if (this.$after)  this.$after.style.clipPath = `inset(0 ${(100-pct).toFixed(2)}% 0 0)`;
        if (this.$line)   this.$line.style.left      = p + '%';
        if (this.$handle) this.$handle.style.left    = p + '%';
    }
}

/* ============================================================
   7순위: ETA (예상 처리 시간)
   파일 크기 기반으로 실측 처리량을 누적해 남은 시간 계산
   ============================================================ */
class ETA {
    constructor(mode) {
        // 경험적 기준: MB당 처리 시간 (ms) — Worker 모드 vs fallback
        this._msPerByte = mode === 'worker' ? 180 / 1048576 : 600 / 1048576;
        this._startTime   = 0;
        this._doneBytes   = 0;
        this._totalBytes  = 0;
        this.$wrap  = document.getElementById('progress-wrap');
        this.$bar   = document.getElementById('progress-bar');
        this.$eta   = document.getElementById('eta-label');
    }

    start(files) {
        this._totalBytes = files.reduce((s, f) => s + f.size, 0);
        this._doneBytes  = 0;
        this._startTime  = performance.now();
        this.$wrap.classList.remove('hidden');
        this._render(0, this._totalBytes);
    }

    tick(file) {
        this._doneBytes += file.size;
        const elapsed   = performance.now() - this._startTime;
        const rate      = elapsed / this._doneBytes;   // ms per byte (실측)
        const remaining = this._totalBytes - this._doneBytes;
        const etaMs     = remaining * (rate || this._msPerByte);
        const pct       = Math.round(this._doneBytes / this._totalBytes * 100);
        this._render(pct, etaMs);
    }

    _render(pct, etaMs) {
        if (this.$bar) this.$bar.style.width = pct + '%';
        if (this.$eta) {
            if (pct >= 100 || etaMs <= 0) {
                this.$eta.textContent = '완료';
            } else {
                const s = Math.ceil(etaMs / 1000);
                this.$eta.textContent = s >= 60
                    ? `약 ${Math.floor(s/60)}분 ${s%60}초`
                    : `약 ${s}초`;
            }
        }
    }

    done() {
        if (this.$bar) this.$bar.style.width = '100%';
        if (this.$eta) this.$eta.textContent = '완료';
        setTimeout(() => { this.$wrap?.classList.add('hidden'); }, 1500);
    }
}

/* ============================================================
   8순위: 완료 통계 배너
   ============================================================ */
function showStatsBanner(queue, results) {
    const banner = document.getElementById('stats-banner');
    if (!banner) return;

    const done      = queue.filter(i => i.status === 'done');
    const errors    = queue.filter(i => i.status === 'error');
    const cancelled = queue.filter(i => i.status === 'cancelled');
    const total     = queue.length;

    const totalIn  = done.reduce((s, i) => s + i.file.size, 0);
    const totalOut = done.reduce((s, i) => s + (i.blob?.size || 0), 0);
    const saved    = totalIn - totalOut;
    const savePct  = totalIn > 0 ? Math.round(saved / totalIn * 100) : 0;
    const isSmaller = saved >= 0;

    // 아이콘 상태
    const iconCls = errors.length > 0 ? 'error' : cancelled.length > 0 ? 'warn' : 'ok';
    const iconTxt = iconCls === 'ok' ? '✓' : iconCls === 'warn' ? '!' : '✕';

    // 통계 셀
    const cells = [
        { label:'완료', value: done.length, sub:`/ ${total}개`, cls: done.length === total ? 'green' : '' },
        { label:'오류', value: errors.length, sub:'개', cls: errors.length > 0 ? 'red' : '' },
        totalIn > 0 ? { label:'원본 용량', value: fmtSize(totalIn), sub:'', cls:'' } : null,
        totalOut > 0 ? { label:'처리 후 용량', value: fmtSize(totalOut), sub:'', cls: isSmaller ? 'green' : 'red' } : null,
    ].filter(Boolean);

    // 절약 바 (용량 변화가 있을 때만)
    const showBar = totalIn > 0 && totalOut > 0;
    const barPct  = Math.min(100, Math.abs(savePct));
    const barCls  = isSmaller ? 'saved' : 'larger';
    const barLabel = isSmaller
        ? `${fmtSize(totalIn)} → ${fmtSize(totalOut)}`
        : `${fmtSize(totalIn)} → ${fmtSize(totalOut)}`;
    const barBadge = isSmaller
        ? `▼ ${savePct}% 절약 (${fmtSize(Math.abs(saved))})`
        : `▲ ${Math.abs(savePct)}% 증가`;

    banner.innerHTML = `
        <div class="stats-banner-header">
            <div class="stats-banner-title">
                <span class="stats-banner-icon ${iconCls}">${iconTxt}</span>
                처리 완료 요약
            </div>
            <button class="stats-dismiss" title="닫기" id="stats-dismiss-btn">×</button>
        </div>
        <div class="stats-grid">
            ${cells.map(c => `
            <div class="stats-cell">
                <div class="stats-cell-label">${c.label}</div>
                <div class="stats-cell-value ${c.cls}">${c.value}<span style="font-size:12px;font-weight:400;color:var(--text-2);"> ${c.sub}</span></div>
            </div>`).join('')}
        </div>
        ${showBar ? `
        <div class="savings-bar-wrap">
            <div class="savings-bar-label">
                <span>${barLabel}</span>
                <span style="color:${isSmaller?'var(--success)':'var(--warn)'};font-weight:600;">${barBadge}</span>
            </div>
            <div class="savings-bar-track">
                <div class="savings-bar-fill ${barCls}" style="width:0%" data-target="${barPct}"></div>
            </div>
        </div>` : ''}`;

    banner.classList.remove('hidden');

    // 닫기 버튼
    document.getElementById('stats-dismiss-btn')?.addEventListener('click', () => {
        banner.classList.add('hidden');
    });

    // 절약 바 애니메이션 (rAF으로 0 → target)
    if (showBar) {
        const fill = banner.querySelector('.savings-bar-fill');
        if (fill) {
            const target = parseFloat(fill.dataset.target);
            requestAnimationFrame(() => { fill.style.width = target + '%'; });
        }
    }
}

/* ============================================================
   UTILITIES
   ============================================================ */
const fmtSize = b =>
    b < 1024 ? b+' B' : b < 1048576 ? (b/1024).toFixed(1)+' KB' : (b/1048576).toFixed(2)+' MB';

const statusLabel = s =>
    ({ pending:'대기', processing:'처리중…', done:'완료', error:'오류', cancelled:'취소' })[s] ?? s;

const mimeExt = m =>
    ({ 'image/jpeg':'jpg','image/webp':'webp','image/png':'png','application/pdf':'pdf' })[m] ?? 'jpg';

const baseName = f => f.name.replace(/\.[^.]+$/, '');

function friendlyError(e) {
    const m = (e?.message||'').toLowerCase();
    if (m.includes('timeout'))                          return '처리 시간 초과 — 파일이 손상되었거나 너무 클 수 있습니다';
    if (m.includes('memory')||m.includes('oom'))        return '메모리 부족 — 파일을 줄이거나 적게 처리하세요';
    if (m.includes('network')||m.includes('fetch'))     return '네트워크 오류 — 연결을 확인하세요';
    if (m.includes('password')||m.includes('encrypt'))  return 'PDF가 암호로 보호되어 있습니다';
    if (m.includes('invalid')&&m.includes('pdf'))       return '손상되거나 지원되지 않는 PDF 형식입니다';
    if (m.includes('embed')||m.includes('unsupported')) return '지원하지 않는 이미지 형식입니다';
    return '처리 실패: '+(e?.message||'알 수 없는 오류').slice(0,50);
}

let _toastTimer;
function toast(msg, type='warn') {
    let t = document.getElementById('toast');
    if (!t) { t=document.createElement('div'); t.id='toast'; document.body.appendChild(t); }
    t.textContent=msg; t.className=`toast ${type} show`;
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

function getImageDim(blob) {
    if (!(blob instanceof Blob)) return Promise.resolve(null);
    return new Promise(res => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload  = () => { res(`${img.naturalWidth}×${img.naturalHeight}`); URL.revokeObjectURL(url); };
        img.onerror = () => { res(null); URL.revokeObjectURL(url); };
        img.src     = url;
    });
}

function saveBlobIOS(blob, name) {
    const file = new File([blob], name, { type:blob.type });
    if (navigator.canShare?.({ files:[file] })) {
        navigator.share({ files:[file], title:name }).catch(e => {
            if (e.name !== 'AbortError') _saveBlobFallback(blob, name);
        });
        return;
    }
    _saveBlobFallback(blob, name);
}
function _saveBlobFallback(blob, name) {
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), { href:url, download:name, target:'_blank' }).click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function saveBlobPC(blob, name) {
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), { href:url, download:name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function showIOSDownloadModal(results, names) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal-sheet">
            <div class="modal-title">파일 다운로드</div>
            <div class="modal-sub">파일을 개별로 저장하세요 · 완료 후 창을 닫으세요</div>
            <div class="modal-file-list">
                ${results.map((b,i) => `
                <div class="modal-file-item">
                    <span class="modal-file-name" title="${esc(names[i])}">${esc(names[i])}</span>
                    <span class="modal-file-size">${fmtSize(b.size)}</span>
                    <button class="modal-dl-btn" data-idx="${i}">저장</button>
                </div>`).join('')}
            </div>
            <button class="modal-close">닫기</button>
        </div>`;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('.modal-dl-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const i = parseInt(btn.dataset.idx);
            saveBlobIOS(results[i], names[i]);
            btn.textContent='✓ 저장됨'; btn.disabled=true;
        });
    });
    const close = () => overlay.remove();
    overlay.querySelector('.modal-close').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target===overlay) close(); });
}

/* ============================================================
   APP
   ============================================================ */
class App {
    constructor() {
        this.proc       = new ImageProcessor();
        this.slider     = new CompareSlider();
        this.eta        = new ETA(this.proc.mode);
        this.tab        = 'resize';
        this.queue      = [];
        this.results    = [];
        this.resNames   = [];
        this._busy      = false;
        this._cancelled = false;
        this._dragId    = null;
        this._previewingId = null;

        this.$drop      = document.getElementById('drop-zone');
        this.$input     = document.getElementById('file-input');
        this.$opts      = document.getElementById('options-panel');
        this.$qsect     = document.getElementById('queue-section');
        this.$qlist     = document.getElementById('queue-list');
        this.$qcount    = document.getElementById('queue-count');
        this.$startBtn  = document.getElementById('start-btn');
        this.$cancelBtn = document.getElementById('cancel-btn');
        this.$retryBtn  = document.getElementById('retry-btn');
        this.$dlBtn     = document.getElementById('download-btn');
        this.$prevBtn   = document.getElementById('preview-btn');
        this.$addBtn    = document.getElementById('add-file-btn');
        this.$envBadge  = document.getElementById('env-badge');

        this._initTheme();
        this._showEnvBadge();
        this._initTabs();
        this._initDrop();
        this._initButtons();
        this._initRangeLabels();
        this._initOptsSave();
        this._initKeyboard();
        this._renderOptions();
    }

    _initTheme() {
        applyTheme(getTheme());
        document.getElementById('theme-toggle').addEventListener('click', () => toggleTheme());
    }

    _setBusy(flag) {
        this._busy = flag;
        document.querySelectorAll('.tab').forEach(b => {
            b.style.pointerEvents = flag ? 'none' : '';
            b.style.opacity       = flag ? '0.4'  : '';
        });
        document.getElementById('clear-btn').disabled    = flag;
        document.getElementById('add-file-btn').disabled = flag;
        this.$prevBtn.disabled = flag;
        this.$startBtn.classList.toggle('hidden',  flag);
        this.$cancelBtn.classList.toggle('hidden', !flag);
    }

    _showEnvBadge() {
        const b = this.$envBadge;
        b.classList.remove('hidden');
        if (this.proc.mode==='worker') { b.classList.add('worker'); b.textContent='Worker 모드'; }
        else { b.classList.add('fallback'); b.textContent='호환 모드'; }
    }

    _initTabs() {
        document.querySelectorAll('.tab').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.dataset.tab === this.tab) return;
                if (this._busy) { toast('처리 중에는 탭을 이동할 수 없습니다','warn'); return; }
                if (this.queue.length > 0 &&
                    !confirm(`대기열에 파일 ${this.queue.length}개가 있습니다.\n탭을 이동하면 목록이 초기화됩니다. 계속할까요?`)) return;
                this.tab = btn.dataset.tab;
                document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this._resetState();
                this._renderOptions();
                this._renderQueue();
            });
        });
    }

    _initDrop() {
        const zone = this.$drop;
        zone.addEventListener('click', () => this.$input.click());
        this.$input.addEventListener('change', e => { this._handleFiles(Array.from(e.target.files)); e.target.value=''; });
        zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
        zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag-over'); this._handleFiles(Array.from(e.dataTransfer.files)); });
        if (IS_TOUCH) document.getElementById('drop-hint').textContent = '탭하여 파일을 선택하세요';
    }

    _initButtons() {
        this.$startBtn.addEventListener('click',  () => this._start());
        this.$dlBtn.addEventListener('click',     () => this._download());
        this.$prevBtn.addEventListener('click',   () => this._runPreview());
        this.$addBtn.addEventListener('click',    () => this.$input.click());
        this.$cancelBtn.addEventListener('click', () => {
            if (!this._busy) return;
            this._cancelled = true;
            this.$cancelBtn.disabled = true;
            this.$cancelBtn.textContent = '중단 중…';
            toast('처리를 중단합니다…','warn');
        });
        this.$retryBtn.addEventListener('click', () => {
            if (this._busy) return;
            this.queue.forEach(item => { item.status='pending'; item.blob=null; item.errMsg=null; });
            this.results=[]; this.resNames=[]; this._previewingId=null;
            this.$dlBtn.classList.add('hidden');
            this.$retryBtn.classList.add('hidden');
            document.getElementById('stats-banner').classList.add('hidden');
            document.getElementById('preview-section').classList.add('hidden');
            this._renderQueue();
            toast('대기열을 초기화했습니다. 처리 시작을 눌러주세요');
        });
        document.getElementById('clear-btn').addEventListener('click', () => {
            if (!this.queue.length) return;
            if (!confirm(`대기열의 파일 ${this.queue.length}개를 모두 삭제할까요?`)) return;
            this._resetState(); this._renderQueue();
        });
    }

    _initOptsSave() {
        const panel = document.getElementById('options-panel');
        panel.addEventListener('change', () => saveOpts(this.tab));
        panel.addEventListener('input',  () => saveOpts(this.tab));
    }

    _initRangeLabels() {
        document.addEventListener('input', e => {
            if (e.target.type !== 'range') return;
            const span = document.querySelector(`[data-for="${e.target.id}"]`);
            if (span) span.textContent = fmtRangeVal(e.target.value, e.target.dataset.fmt || '');
        });
    }

    _initKeyboard() {
        document.addEventListener('keydown', e => {
            if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                if (!this._busy && this.queue.length > 0) this._start();
            }
            if (e.key === 'Escape' && this._busy && !this._cancelled) {
                this._cancelled = true;
                this.$cancelBtn.disabled = true;
                this.$cancelBtn.textContent = '중단 중…';
                toast('처리를 중단합니다…','warn');
            }
        });
    }

    _resetState() {
        this.queue=[]; this.results=[]; this.resNames=[]; this._previewingId=null;
        this.$dlBtn.classList.add('hidden');
        this.$retryBtn.classList.add('hidden');
        document.getElementById('preview-section').classList.add('hidden');
        document.getElementById('stats-banner').classList.add('hidden');
        document.getElementById('shortcut-hint').classList.add('hidden');
    }

    _renderOptions() {
        const cfg = TAB_CONFIG[this.tab];
        this.$input.accept   = cfg.accept;
        this.$input.multiple = cfg.multi;
        document.getElementById('drop-sub').textContent = cfg.hint;
        this.$opts.innerHTML = renderOpts(cfg.opts);
        restoreOpts(this.tab);
        this.$prevBtn.style.display = cfg.hasPreview ? '' : 'none';
    }

    _getConfig() { return TAB_CONFIG[this.tab].getConfig(makeGetter()); }

    _handleFiles(files) {
        const isPDF = this.tab === 'pdf2jpg';
        const valid = files.filter(f => isPDF ? f.type==='application/pdf' : VALID_IMG.has(f.type));
        const rej   = files.length - valid.length;
        if (!valid.length) { toast(isPDF ? 'PDF 파일만 지원합니다' : '이미지 파일만 지원합니다 (JPEG · PNG · WebP)','error'); return; }
        if (rej > 0) toast(`${rej}개 파일은 지원하지 않는 형식으로 제외됐습니다`);
        valid.forEach(f => this.queue.push({ id:uuid(), file:f, status:'pending', blob:null, errMsg:null }));
        this._renderQueue();
        document.getElementById('shortcut-hint').classList.remove('hidden');
    }

    _renderQueue() {
        const n = this.queue.length;
        this.$qcount.textContent = n;
        if (!n) { this.$qsect.classList.add('hidden'); return; }
        this.$qsect.classList.remove('hidden');
        const isPDF2     = this.tab === 'jpg2pdf';
        const hasPreview = TAB_CONFIG[this.tab].hasPreview;

        this.$qlist.innerHTML = this.queue.map((item, idx) => {
            const isClickable  = hasPreview && item.status === 'done' && item.blob;
            const isPreviewing = item.id === this._previewingId;
            return `
            <div class="queue-item ${isClickable?'clickable':''} ${isPreviewing?'previewing':''}"
                 data-id="${item.id}" ${isClickable?'role="button" tabindex="0"':''}>
                <div class="q-main">
                    ${isPDF2?`<span class="q-handle" title="드래그하여 순서 변경">⠿</span><span class="q-order">${idx+1}</span>`:''}
                    <span class="q-name" title="${esc(item.file.name)}">${esc(item.file.name)}</span>
                    <span class="q-size">${fmtSize(item.file.size)}</span>
                    ${isPDF2?`<div class="q-move-btns">
                        <button class="q-move-btn" data-dir="up"   data-id="${item.id}" ${idx===0   ?'disabled':''}>▲</button>
                        <button class="q-move-btn" data-dir="down" data-id="${item.id}" ${idx===n-1 ?'disabled':''}>▼</button>
                    </div>`:''}
                    <span class="q-badge ${item.status}">${statusLabel(item.status)}</span>
                </div>
                ${item.errMsg?`<span class="q-err">⚠ ${esc(item.errMsg)}</span>`:''}
            </div>`;
        }).join('');

        this.$qlist.querySelectorAll('.q-move-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                if (this._busy) return;
                const idx = this.queue.findIndex(q => q.id === btn.dataset.id);
                const to  = btn.dataset.dir === 'up' ? idx-1 : idx+1;
                if (idx < 0 || to < 0 || to >= this.queue.length) return;
                [this.queue[idx], this.queue[to]] = [this.queue[to], this.queue[idx]];
                this._renderQueue();
            });
        });

        if (hasPreview) {
            this.$qlist.querySelectorAll('.queue-item.clickable').forEach(el => {
                const handler = async () => {
                    const item = this.queue.find(i => i.id === el.dataset.id);
                    if (item?.blob) await this._showItemPreview(item);
                };
                el.addEventListener('click', handler);
                el.addEventListener('keydown', e => { if (e.key === 'Enter') handler(); });
            });
        }

        if (isPDF2 && !IS_TOUCH) this._bindDragReorder(this.$qlist);
    }

    async _showItemPreview(item) {
        if (this._busy) return;
        this._previewingId = item.id;
        this._renderQueue();
        const note = document.getElementById('preview-note');
        if (note) note.textContent = `${item.file.name} 미리보기 · 설정 변경 후 [미리보기] 버튼으로 업데이트`;
        const [bd, ad] = await Promise.all([getImageDim(item.file), getImageDim(item.blob)]);
        await this.slider.set(item.file, item.blob, item.file.name,
            { beforeSize:item.file.size, afterSize:item.blob.size, beforeDim:bd, afterDim:ad });
        document.getElementById('preview-section').scrollIntoView({ behavior:'smooth', block:'nearest' });
    }

    _updateItem(id, status, blob=null, errMsg=null) {
        const item = this.queue.find(i => i.id===id);
        if (!item) return;
        item.status=status; if (blob) item.blob=blob; if (errMsg) item.errMsg=errMsg;
        const el = this.$qlist.querySelector(`[data-id="${id}"]`);
        if (!el) return;
        const hasPreview = TAB_CONFIG[this.tab].hasPreview;
        el.classList.toggle('clickable', hasPreview && status==='done' && !!blob);
        if (hasPreview && status==='done' && blob) {
            el.setAttribute('role','button'); el.setAttribute('tabindex','0');
            el.onclick = () => { const it=this.queue.find(i=>i.id===id); if(it?.blob) this._showItemPreview(it); };
        }
        el.querySelector('.q-badge').className   = `q-badge ${status}`;
        el.querySelector('.q-badge').textContent = statusLabel(status);
        if (blob) el.querySelector('.q-size').textContent = `${fmtSize(item.file.size)} → ${fmtSize(blob.size)}`;
        let errEl = el.querySelector('.q-err');
        if (errMsg) {
            if (!errEl) { errEl=document.createElement('span'); errEl.className='q-err'; el.appendChild(errEl); }
            errEl.textContent = `⚠ ${esc(errMsg)}`;
        } else if (errEl) errEl.remove();
    }

    async _runPreview() {
        const first = this.queue[0];
        if (!first) { toast('파일을 먼저 추가하세요','warn'); return; }
        this.$prevBtn.disabled=true; this.$prevBtn.textContent='생성 중…';
        try {
            const afterBlob = await this.proc.run(this.tab, first.file, this._getConfig());
            const [bd, ad]  = await Promise.all([getImageDim(first.file), getImageDim(afterBlob)]);
            this._previewingId = null; this._renderQueue();
            const note = document.getElementById('preview-note');
            if (note) note.textContent = '첫 번째 파일 기준 · 설정 변경 후 다시 누르면 업데이트';
            await this.slider.set(first.file, afterBlob, first.file.name,
                { beforeSize:first.file.size, afterSize:afterBlob.size, beforeDim:bd, afterDim:ad });
            document.getElementById('preview-section').scrollIntoView({ behavior:'smooth', block:'nearest' });
        } catch(e) {
            toast('미리보기 실패: '+friendlyError(e),'error');
        } finally {
            this.$prevBtn.disabled=false; this.$prevBtn.textContent='미리보기';
        }
    }

    async _start() {
        if (!this.queue.length || this._busy) return;
        this._setBusy(true);
        this._cancelled = false;
        this.$dlBtn.classList.add('hidden');
        this.$retryBtn.classList.add('hidden');
        document.getElementById('stats-banner').classList.add('hidden');
        this.results=[]; this.resNames=[];

        const config   = this._getConfig();
        const total    = this.queue.length;
        let   errors   = 0;
        let   cancelled = 0;

        // 7순위: ETA 시작
        this.eta.start(this.queue.map(i => i.file));

        try {
            if (this.tab === 'jpg2pdf') {
                await this._runJPGtoPDF(config, total);
            } else if (this.tab === 'pdf2jpg') {
                for (const item of this.queue) {
                    if (this._cancelled) { this._updateItem(item.id,'cancelled'); cancelled++; this.eta.tick(item.file); continue; }
                    this._updateItem(item.id,'processing');
                    try {
                        const blobs = await withTimeout(this._runPDFtoJPG(item.file, config));
                        blobs.forEach((b,i) => { this.results.push(b); this.resNames.push(`${baseName(item.file)}_p${String(i+1).padStart(3,'0')}.jpg`); });
                        this._updateItem(item.id,'done',blobs[0]);
                    } catch(e) { errors++; this._updateItem(item.id,'error',null,friendlyError(e)); }
                    this.eta.tick(item.file); Memory.cleanup();
                }
            } else {
                for (const item of this.queue) {
                    if (this._cancelled) { this._updateItem(item.id,'cancelled'); cancelled++; this.eta.tick(item.file); continue; }
                    this._updateItem(item.id,'processing');
                    try {
                        const blob = await this.proc.run(this.tab, item.file, config);
                        this.results.push(blob); this.resNames.push(`${baseName(item.file)}_fix.${mimeExt(blob.type)}`);
                        this._updateItem(item.id,'done',blob);
                    } catch(e) { errors++; this._updateItem(item.id,'error',null,friendlyError(e)); }
                    this.eta.tick(item.file); Memory.cleanup();
                }
            }
        } finally {
            this._setBusy(false);
            this.$cancelBtn.disabled=false;
            this.$cancelBtn.textContent='중단';
            this.eta.done();
        }

        const ok = this.results.length;

        // 8순위: 완료 통계 배너
        showStatsBanner(this.queue, this.results);

        if (ok > 0) {
            this.$dlBtn.classList.remove('hidden');
            this.$retryBtn.classList.remove('hidden');
        }

        // 첫 완료 아이템 자동 미리보기
        if (ok > 0 && TAB_CONFIG[this.tab].hasPreview) {
            const first = this.queue.find(i => i.status==='done' && i.blob);
            if (first) this._showItemPreview(first);
        }
    }

    async _runPDFtoJPG(file, config) {
        const pdfjsLib = await (async () => {
            const _scripts = {};
            const load = src => _scripts[src] || (_scripts[src] = new Promise((res,rej) => { const s=document.createElement('script'); s.src=src; s.onload=res; s.onerror=rej; document.head.appendChild(s); }));
            await load('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            return window.pdfjsLib;
        })();
        const pdf=await pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;
        const scale=config.dpi/72; const canvas=document.createElement('canvas'); const blobs=[];
        for (let i=1;i<=pdf.numPages;i++) {
            const page=await pdf.getPage(i); const vp=page.getViewport({scale});
            canvas.width=Math.round(vp.width); canvas.height=Math.round(vp.height);
            await page.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
            blobs.push(await new Promise(res=>canvas.toBlob(res,'image/jpeg',config.quality)));
        }
        return blobs;
    }

    async _runJPGtoPDF(config, total) {
        const load = src => new Promise((res,rej)=>{ const s=document.createElement('script'); s.src=src; s.onload=res; s.onerror=rej; document.head.appendChild(s); });
        if (!window.PDFLib) await load('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js');
        const PDFLib=window.PDFLib; const pdfDoc=await PDFLib.PDFDocument.create();
        const PAGE_SIZES={a4:[595.28,841.89],letter:[612,792]}; let done=0;
        for (const item of this.queue) {
            if (this._cancelled) { this._updateItem(item.id,'cancelled'); done++; this.eta.tick(item.file); continue; }
            this._updateItem(item.id,'processing');
            try {
                const image=await this._embedImage(pdfDoc,item.file); const dims=image.scale(1); const ps=PAGE_SIZES[config.pageSize];
                if (ps) { const r=Math.min(ps[0]/dims.width,ps[1]/dims.height); const pw=Math.round(dims.width*r),ph=Math.round(dims.height*r); pdfDoc.addPage(ps).drawImage(image,{x:(ps[0]-pw)/2,y:(ps[1]-ph)/2,width:pw,height:ph}); }
                else { pdfDoc.addPage([dims.width,dims.height]).drawImage(image,{x:0,y:0,width:dims.width,height:dims.height}); }
                this._updateItem(item.id,'done');
            } catch(e) { this._updateItem(item.id,'error',null,friendlyError(e)); }
            done++; this.eta.tick(item.file);
        }
        if (!this.queue.some(i=>i.status==='done')) return;
        const blob=new Blob([await pdfDoc.save()],{type:'application/pdf'});
        this.results.push(blob); this.resNames.push('imagefix_combined.pdf');
    }

    async _embedImage(pdfDoc,file) {
        const bytes=await file.arrayBuffer();
        if (file.type==='image/png')  return pdfDoc.embedPng(bytes);
        if (file.type==='image/jpeg') return pdfDoc.embedJpg(bytes);
        const bmp=await createImageBitmap(file); const c=MAIN_CF.create(bmp.width,bmp.height);
        c.getContext('2d').drawImage(bmp,0,0);
        return pdfDoc.embedJpg(await(await MAIN_CF.toBlob(c,'image/jpeg',0.92)).arrayBuffer());
    }

    _bindDragReorder(listEl) {
        listEl.querySelectorAll('.queue-item').forEach(item => {
            const handle=item.querySelector('.q-handle'); if(!handle) return;
            handle.addEventListener('mousedown',()=>{item.draggable=true;});
            item.addEventListener('dragend',()=>{item.draggable=false;item.classList.remove('dragging');listEl.querySelectorAll('.queue-item').forEach(i=>i.classList.remove('drag-over-top','drag-over-bottom'));this._dragId=null;});
            item.addEventListener('dragstart',e=>{this._dragId=item.dataset.id;item.classList.add('dragging');e.dataTransfer.effectAllowed='move';});
            item.addEventListener('dragover',e=>{e.preventDefault();if(!this._dragId||this._dragId===item.dataset.id)return;e.dataTransfer.dropEffect='move';const rect=item.getBoundingClientRect();item.classList.remove('drag-over-top','drag-over-bottom');item.classList.add(e.clientY<rect.top+rect.height/2?'drag-over-top':'drag-over-bottom');});
            item.addEventListener('dragleave',()=>item.classList.remove('drag-over-top','drag-over-bottom'));
            item.addEventListener('drop',e=>{e.preventDefault();if(!this._dragId||this._dragId===item.dataset.id)return;const from=this.queue.findIndex(q=>q.id===this._dragId);let to=this.queue.findIndex(q=>q.id===item.dataset.id);const rect=item.getBoundingClientRect();if(e.clientY>=rect.top+rect.height/2)to++;if(from<0||from===to)return;const[moved]=this.queue.splice(from,1);this.queue.splice(from<to?to-1:to,0,moved);item.classList.remove('drag-over-top','drag-over-bottom');this._renderQueue();});
        });
    }

    async _download() {
        if (!this.results.length) return;
        if (IS_IOS) {
            this.results.length===1
                ?(saveBlobIOS(this.results[0],this.resNames[0]),toast('저장 화면을 확인하세요','ok'))
                :showIOSDownloadModal(this.results,this.resNames);
            return;
        }
        if (this.results.length===1) { saveBlobPC(this.results[0],this.resNames[0]); toast('다운로드를 시작합니다','ok'); return; }
        toast('ZIP 파일로 묶는 중…');
        const zip=new JSZip(); this.results.forEach((b,i)=>zip.file(this.resNames[i],b));
        saveBlobPC(await zip.generateAsync({type:'blob'}),'imagefix_results.zip');
        toast('ZIP 다운로드를 시작합니다','ok');
    }
}

new App();
