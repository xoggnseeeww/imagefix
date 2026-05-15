importScripts('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');

self.onmessage = async function(e) {
    const { action, files, filename } = e.data;

    if (action === 'createZip') {
        const zip = new JSZip();
        files.forEach((f, i) => zip.file(f.name || `image_${i}.jpg`, f.blob));

        const zipBlob = await zip.generateAsync({ 
            type: 'blob', 
            compression: 'DEFLATE',
            level: 6 
        }, (meta) => {
            self.postMessage({ status: 'progress', percent: meta.percent.toFixed(1) });
        });

        self.postMessage({ status: 'success', blob: zipBlob, filename });
    }
};
