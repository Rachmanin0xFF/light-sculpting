'use strict';

import {
    encode as encodePNG
} from 'https://unpkg.com/@jsquash/png?module';

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
export async function downloadHeightmapPNG(data, width, height, filename = 'heightmap.png') {
    // Find min/max for normalization
    let min = Infinity,
        max = -Infinity;
    for (let i = 0; i < data.length; i++) {
        if (data[i] < min) min = data[i];
        if (data[i] > max) max = data[i];
    }
    const range = max - min || 1;

    // 16-bit RGBA, Y-flipped, big-endian (PNG byte order)
    const buf = new ArrayBuffer(width * height * 4 * 2);
    const view = new DataView(buf);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const srcIdx = (height - 1 - y) * width + x;
            const dstOffset = (y * width + x) * 8; // 4 channels * 2 bytes
            const value = Math.round(((data[srcIdx] - min) / range) * 65535);
            view.setUint16(dstOffset, value, false); // R (big-endian)
            view.setUint16(dstOffset + 2, value, false); // G
            view.setUint16(dstOffset + 4, value, false); // B
            view.setUint16(dstOffset + 6, 65535, false); // A
        }
    }
    const pixels = new Uint16Array(buf);

    const png = await encodePNG({
        data: pixels,
        width,
        height
    }, {
        bitDepth: 16
    });
    const blob = new Blob([png], {
        type: 'image/png'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * Export heightmap as a watertight OBJ mesh (top surface + walls + bottom).
 * Vertices in [0,1] x [0,1], height as Z. Normalized so min height = 0.
 * @param {Float32Array} data - heightmap values (width * height)
 * @param {number} width
 * @param {number} height
 * @param {string} filename
 */
export function downloadHeightmapOBJ(data, width, height, filename = 'heightmap.obj') {
    let min = Infinity,
        max = -Infinity;
    for (let i = 0; i < data.length; i++) {
        if (data[i] < min) min = data[i];
        if (data[i] > max) max = data[i];
    }
    const range = max - min || 1;

    const lines = ['# Caustic lens heightmap'];

    // --- Top surface vertices (1-indexed: 1 .. width*height) ---
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            const z = (data[idx] - min) / range;
            lines.push(`v ${x / (width - 1)} ${y / (height - 1)} ${z}`);
        }
    }

    // --- Bottom surface vertices (width*height+1 .. 2*width*height) ---
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            lines.push(`v ${x / (width - 1)} ${y / (height - 1)} 0`);
        }
    }

    const topBase = 1; // 1-indexed
    const botBase = width * height + 1;

    // --- Top surface faces ---
    for (let y = 0; y < height - 1; y++) {
        for (let x = 0; x < width - 1; x++) {
            const v00 = topBase + y * width + x;
            const v10 = v00 + 1;
            const v01 = v00 + width;
            const v11 = v01 + 1;
            lines.push(`f ${v00} ${v10} ${v11}`);
            lines.push(`f ${v00} ${v11} ${v01}`);
        }
    }

    // --- Bottom surface faces (flipped winding) ---
    for (let y = 0; y < height - 1; y++) {
        for (let x = 0; x < width - 1; x++) {
            const v00 = botBase + y * width + x;
            const v10 = v00 + 1;
            const v01 = v00 + width;
            const v11 = v01 + 1;
            lines.push(`f ${v00} ${v11} ${v10}`);
            lines.push(`f ${v00} ${v01} ${v11}`);
        }
    }

    // --- Side walls ---
    // Bottom edge (y=0)
    for (let x = 0; x < width - 1; x++) {
        const t0 = topBase + x,
            t1 = t0 + 1;
        const b0 = botBase + x,
            b1 = b0 + 1;
        lines.push(`f ${t0} ${b0} ${b1}`);
        lines.push(`f ${t0} ${b1} ${t1}`);
    }
    // Top edge (y=height-1)
    for (let x = 0; x < width - 1; x++) {
        const t0 = topBase + (height - 1) * width + x,
            t1 = t0 + 1;
        const b0 = botBase + (height - 1) * width + x,
            b1 = b0 + 1;
        lines.push(`f ${t0} ${t1} ${b1}`);
        lines.push(`f ${t0} ${b1} ${b0}`);
    }
    // Left edge (x=0)
    for (let y = 0; y < height - 1; y++) {
        const t0 = topBase + y * width,
            t1 = t0 + width;
        const b0 = botBase + y * width,
            b1 = b0 + width;
        lines.push(`f ${t0} ${t1} ${b1}`);
        lines.push(`f ${t0} ${b1} ${b0}`);
    }
    // Right edge (x=width-1)
    for (let y = 0; y < height - 1; y++) {
        const t0 = topBase + y * width + (width - 1),
            t1 = t0 + width;
        const b0 = botBase + y * width + (width - 1),
            b1 = b0 + width;
        lines.push(`f ${t0} ${b0} ${b1}`);
        lines.push(`f ${t0} ${b1} ${t1}`);
    }

    const blob = new Blob([lines.join('\n')], {
        type: 'text/plain'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
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
    const blob = new Blob([header.buffer, data.buffer], {
        type: 'application/octet-stream'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}