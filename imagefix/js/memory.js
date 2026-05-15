export const Memory = {
    _urls: new Set(),

    track(url) {
        if (typeof url === 'string' && url.startsWith('blob:')) {
            this._urls.add(url);
        }
    },

    cleanup() {
        this._urls.forEach(url => URL.revokeObjectURL(url));
        this._urls.clear();
        // 비표준: 지원 시에만 호출 (Chrome devtools 옵션)
        if (typeof globalThis.gc === 'function') globalThis.gc();
    }
};
