export const Memory = {
    cleanup() {
        if (typeof globalThis.gc === 'function') globalThis.gc();
    }
};
