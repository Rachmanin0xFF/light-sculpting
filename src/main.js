'use strict';

import {
    initGL,
    fullscreenPass,
    uploadTexture
} from './gl.js';
import {
    CausticSolver
} from './cascade.js';
import {
    readHeightmap,
    downloadHeightmapPNG,
    downloadHeightmapOBJ,
    downloadHeightmapRaw
} from './export.js';

// =============== State =============== //

let gl = null;
let solver = null;
let targetTexture = null;
let targetMultiplier = null; // This gets passed to the shaders to scale the target brightness!
const destImageExposure = 0.85; // If this is smaller than 1, the solver will have more light to push around than it actually needs.
let sourceTexture = null; // A white texture by default, but could be set to a spotlight or something.
let result = null;

// =============== DOM =============== //

const canvas = document.getElementById('canvas');
const fileInput = document.getElementById('file-input');
const resolutionSelect = document.getElementById('resolution-select');
const transportGainInput = document.getElementById('transport-gain');
const transportGainValue = document.getElementById('transport-gain-value');
const generateBtn = document.getElementById('generate-btn');
const abortBtn = document.getElementById('abort-btn');
const downloadBtn = document.getElementById('download-btn');
const downloadObjBtn = document.getElementById('download-obj-btn');
const downloadRawBtn = document.getElementById('download-raw-btn');
const progressBar = document.getElementById('progress-bar');
const progressFill = document.getElementById('progress-fill');
const statusText = document.getElementById('status-text');
const preview = document.getElementById('preview');

// =============== Init =============== //

function init() {
    gl = initGL(canvas);

    // 2x2 grid: lightmap | displacement / difference | poisson
    canvas.width = 1024;
    canvas.height = 1024;

    // Create a 1x1 white texture as the default uniform source
    const whitePixel = new Uint8Array([255, 255, 255, 255]);
    sourceTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, whitePixel);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, null);

    transportGainValue.textContent = `${parseFloat(transportGainInput.value).toFixed(1)}×`;

    statusText.textContent = 'Upload a target image to begin.';
}

// =============== Image Loading =============== //

/**
 * Resize/crop an image to a square power-of-2 canvas.
 */
function prepareImage(img, targetSize) {
    const size = Math.min(img.width, img.height);
    const sx = (img.width - size) / 2;
    const sy = (img.height - size) / 2;

    const c = document.createElement('canvas');
    c.width = targetSize;
    c.height = targetSize;
    const ctx = c.getContext('2d');

    // Draw the center-cropped region scaled to targetSize
    ctx.drawImage(img, sx, sy, size, size, 0, 0, targetSize, targetSize);

    // Convert to grayscale and compute mean brightness
    const imageData = ctx.getImageData(0, 0, targetSize, targetSize);
    const d = imageData.data;
    let sum = 0;
    const numPixels = targetSize * targetSize;
    for (let i = 0; i < d.length; i += 4) {
        const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        d[i] = d[i + 1] = d[i + 2] = gray;
        sum += gray;
    }
    ctx.putImageData(imageData, 0, 0);

    const meanBrightness = sum / numPixels / 255.0; // 0-1 range
    return {
        canvas: c,
        meanBrightness
    };
}

function loadImage(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = URL.createObjectURL(file);
    });
}

// =============== Solve =============== //

async function runSolve() {
    if (!targetTexture) {
        statusText.textContent = 'Please upload an image first.';
        return;
    }

    const targetRes = parseInt(resolutionSelect.value);
    const transportGain = parseFloat(transportGainInput.value);

    generateBtn.disabled = true;
    abortBtn.disabled = false;
    downloadBtn.disabled = true;
    downloadObjBtn.disabled = true;
    downloadRawBtn.disabled = true;
    progressBar.style.display = 'block';

    // Clean up previous solver
    if (solver) solver.destroy();
    if (result && result.finalLevel) result.finalLevel.destroy();
    result = null;

    solver = new CausticSolver(gl, targetRes);

    statusText.textContent = 'solving...';

    try {
        result = await solver.solve(targetTexture, sourceTexture, {
            targetScale: targetMultiplier,
            transportGain,
            onProgress({
                level,
                resolution,
                iteration,
                totalIterations,
                totalLevels,
                transportLevel
            }) {
                const levelProgress = iteration / totalIterations;
                const overallProgress = (level + levelProgress) / totalLevels;
                progressFill.style.width = `${overallProgress * 100}%`;
                statusText.textContent = `Level ${level + 1}/${totalLevels} (${resolution}x${resolution}): iteration ${iteration}/${totalIterations}`;
                renderPreview(transportLevel);
            },
            onLevelComplete(transportLevel) {
                // Render current lightmap to screen for preview
                renderPreview(transportLevel);
            },
        });

        if (result) {
            statusText.textContent = 'Done! Download the heightmap.';
            downloadBtn.disabled = false;
            downloadObjBtn.disabled = false;
            downloadRawBtn.disabled = false;
            renderPreview(result.finalLevel);
        } else {
            statusText.textContent = 'Aborted.';
        }
    } catch (e) {
        statusText.textContent = `Error: ${e.message}`;
        console.error(e);
    }

    generateBtn.disabled = false;
    abortBtn.disabled = true;
}

function renderPreview(transportLevel) {
    if (!transportLevel || !solver) return;
    const pw = canvas.width / 2;
    const ph = canvas.height / 2;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Clear entire canvas
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Top-left: lightmap
    gl.viewport(0, ph, pw, ph);
    fullscreenPass(gl, solver.programs.display, {
            map: transportLevel.lightmap.texture
        }, {
            gain: 1.0 / targetMultiplier
        },
        null
    );

    // Top-right: displacement field (sine fringe visualization)
    gl.viewport(pw, ph, pw, ph);
    fullscreenPass(gl, solver.programs.displacementViz, {
            map: transportLevel.displacements.texture
        }, {},
        null
    );

    // Bottom-left: difference (target - lightmap), red=positive, blue=negative
    gl.viewport(0, 0, pw, ph);
    fullscreenPass(gl, solver.programs.diffViz, {
            map: transportLevel.difference.texture
        }, {
            gain: 1.5
        },
        null
    );

    // Bottom-right: Poisson solution of difference, red=positive, blue=negative
    gl.viewport(pw, 0, pw, ph);
    fullscreenPass(gl, solver.programs.diffViz, {
            map: transportLevel.poissonResult.texture
        }, {
            gain: 10.5
        },
        null
    );
}

// =============== Event Handlers =============== //

fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
        const img = await loadImage(file);
        const targetRes = parseInt(resolutionSelect.value);
        const {
            canvas: prepared,
            meanBrightness
        } = prepareImage(img, targetRes);

        // Show preview
        preview.src = prepared.toDataURL();
        preview.style.display = 'block';

        // Upload as WebGL texture
        if (targetTexture) gl.deleteTexture(targetTexture);
        targetTexture = uploadTexture(gl, prepared);
        targetMultiplier = destImageExposure / meanBrightness;

        statusText.textContent = `Image loaded (${img.width}x${img.height} → ${targetRes}x${targetRes}, mean=${meanBrightness.toFixed(3)}). Click Generate.`;
        generateBtn.disabled = false;
    } catch (err) {
        statusText.textContent = `Failed to load image: ${err.message}`;
    }
});

resolutionSelect.addEventListener('change', async () => {
    // Re-prepare the image at the new resolution if one is loaded
    if (fileInput.files.length > 0) {
        const file = fileInput.files[0];
        const img = await loadImage(file);
        const targetRes = parseInt(resolutionSelect.value);
        const {
            canvas: prepared,
            meanBrightness
        } = prepareImage(img, targetRes);

        preview.src = prepared.toDataURL();

        if (targetTexture) gl.deleteTexture(targetTexture);
        targetTexture = uploadTexture(gl, prepared);
        targetMultiplier = destImageExposure / meanBrightness;

        statusText.textContent = `Image re-prepared at ${targetRes}x${targetRes}. Click Generate.`;
    }
});

transportGainInput.addEventListener('input', () => {
    const gain = parseFloat(transportGainInput.value);
    transportGainValue.textContent = `${gain.toFixed(1)}×`;
});

generateBtn.addEventListener('click', () => runSolve());

abortBtn.addEventListener('click', () => {
    if (solver) solver.abort();
});

downloadBtn.addEventListener('click', () => {
    if (!result || !result.heightmapFBO) return;
    const data = readHeightmap(gl, result.heightmapFBO);
    const res = result.heightmapFBO.width;
    downloadHeightmapPNG(data, res, res);
});

downloadObjBtn.addEventListener('click', () => {
    if (!result || !result.heightmapFBO) return;
    const data = readHeightmap(gl, result.heightmapFBO);
    const res = result.heightmapFBO.width;
    downloadHeightmapOBJ(data, res, res);
});

downloadRawBtn.addEventListener('click', () => {
    if (!result || !result.heightmapFBO) return;
    const data = readHeightmap(gl, result.heightmapFBO);
    const res = result.heightmapFBO.width;
    downloadHeightmapRaw(data, res, res);
});

init();