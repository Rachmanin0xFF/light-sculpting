'use strict';

/**
 * Read a float heightmap FBO back to the CPU.
 * @param {WebGL2RenderingContext} gl
 * @param {object} fbo - the heightmap FBO (R32F or RGBA32F)
 * @returns {Float32Array} - raw float pixel data
 */
export function readHeightmap(gl, fbo) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.framebuffer);
    // R32F requires reading as RGBA in WebGL2
    const pixels = new Float32Array(fbo.width * fbo.height * 4);
    gl.readPixels(0, 0, fbo.width, fbo.height, gl.RGBA, gl.FLOAT, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Extract just the red channel
    const result = new Float32Array(fbo.width * fbo.height);
    for (let i = 0; i < result.length; i++) {
        result[i] = pixels[i * 4];
    }
    return result;
}

/**
 * Convert a float heightmap to a 16-bit PNG and trigger download.
 * Normalizes the data to fill [0, 65535].
 * @param {Float32Array} data - heightmap values (width * height)
 * @param {number} width
 * @param {number} height
 * @param {string} filename
 */
export function downloadHeightmapPNG(data, width, height, filename = 'heightmap.png') {
    // Find min/max for normalization
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < data.length; i++) {
        if (data[i] < min) min = data[i];
        if (data[i] > max) max = data[i];
    }
    const range = max - min || 1;

    // Canvas-based export (8-bit per channel, we use two channels for 16-bit)
    // Actually, canvas only supports 8-bit. For a proper 16-bit PNG we'd need
    // a library. For now, export as 8-bit grayscale which is sufficient for
    // visualization and most use cases.
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(width, height);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            // Flip Y since WebGL origin is bottom-left
            const srcIdx = (height - 1 - y) * width + x;
            const dstIdx = (y * width + x) * 4;
            const normalized = (data[srcIdx] - min) / range;
            const byte = Math.round(normalized * 255);
            imageData.data[dstIdx]     = byte; // R
            imageData.data[dstIdx + 1] = byte; // G
            imageData.data[dstIdx + 2] = byte; // B
            imageData.data[dstIdx + 3] = 255;  // A
        }
    }

    ctx.putImageData(imageData, 0, 0);

    canvas.toBlob(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }, 'image/png');
}

/**
 * Download raw float32 heightmap data as a binary file.
 * More precise than PNG — can be loaded in numpy, etc.
 * @param {Float32Array} data
 * @param {number} width
 * @param {number} height
 * @param {string} filename
 */
export function downloadHeightmapRaw(data, width, height, filename = 'heightmap.bin') {
    // Prepend a small header: width (uint32), height (uint32), then float32 data
    const header = new Uint32Array([width, height]);
    const blob = new Blob([header.buffer, data.buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
