'use strict';

// =============== WebGL2 Utility Layer =============== //

/**
 * Initialize a WebGL2 context with required extensions for float blending.
 */
export function initGL(canvas) {
    const gl = canvas.getContext('webgl2', {
        antialias: false,
        premultipliedAlpha: false
    });
    if (!gl) throw new Error('WebGL2 not supported');

    const extFloat = gl.getExtension('EXT_color_buffer_float');
    if (!extFloat) throw new Error('EXT_color_buffer_float not supported');

    const extBlend = gl.getExtension('EXT_float_blend');
    if (!extBlend) throw new Error('EXT_float_blend not supported');

    const extLinear = gl.getExtension('OES_texture_float_linear');
    if (!extLinear) throw new Error('OES_texture_float_linear not supported');

    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);

    return gl;
}

/**
 * Compile and link a shader program. Returns { program, uniforms }.
 * `uniforms` is a Map of name → WebGLUniformLocation.
 */
export function createProgram(gl, vertSrc, fragSrc) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        throw new Error('Program link failed:\n' + log);
    }

    gl.deleteShader(vs);
    gl.deleteShader(fs);

    const uniforms = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
        const info = gl.getActiveUniform(program, i);
        uniforms[info.name] = gl.getUniformLocation(program, info.name);
    }

    return {
        program,
        uniforms
    };
}

function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        const typeName = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
        throw new Error(`${typeName} shader compile failed:\n${log}\n\nSource:\n${addLineNumbers(source)}`);
    }
    return shader;
}

function addLineNumbers(source) {
    return source.split('\n').map((line, i) => `${i + 1}: ${line}`).join('\n');
}

// =============== FBO =============== //

/**
 * Format presets mapping short names to WebGL2 internal/format/type combos.
 */
const FORMAT_PRESETS = {
    'R32F': {
        internalFormat: 0x822E,
        format: 0x1903,
        type: 0x1406
    }, // gl.R32F, gl.RED, gl.FLOAT
    'RG32F': {
        internalFormat: 0x8230,
        format: 0x8227,
        type: 0x1406
    }, // gl.RG32F, gl.RG, gl.FLOAT
    'RGBA32F': {
        internalFormat: 0x8814,
        format: 0x1908,
        type: 0x1406
    }, // gl.RGBA32F, gl.RGBA, gl.FLOAT
};

/**
 * Create a framebuffer + texture pair.
 * preset: 'R32F', 'RG32F', or 'RGBA32F'
 * filter: gl.NEAREST or gl.LINEAR
 */
export function createFBO(gl, width, height, preset = 'RGBA32F', filter = gl.LINEAR) {
    const fmt = FORMAT_PRESETS[preset];
    if (!fmt) throw new Error(`Unknown format preset: ${preset}`);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internalFormat, width, height, 0, fmt.format, fmt.type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`FBO incomplete: ${status} for ${preset} ${width}x${height}`);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);

    return {
        framebuffer,
        texture,
        width,
        height
    };
}

/**
 * Create an MSAA framebuffer for rendering, with a resolve target for reading.
 * Used for the transport step (additive blending of displaced mesh triangles).
 */
export function createMSAAFBO(gl, width, height, preset = 'RGBA32F', samples = 16) {
    const fmt = FORMAT_PRESETS[preset];
    if (!fmt) throw new Error(`Unknown format preset: ${preset}`);

    // Clamp to max supported samples
    const maxSamples = gl.getParameter(gl.MAX_SAMPLES);
    samples = Math.min(samples, maxSamples);

    // MSAA renderbuffer for rendering
    const renderbuffer = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, fmt.internalFormat, width, height);

    const msaaFramebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, msaaFramebuffer);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, renderbuffer);

    let status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`MSAA FBO incomplete: ${status}`);
    }

    // Resolve target (regular texture FBO)
    const resolve = createFBO(gl, width, height, preset, gl.LINEAR);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);

    return {
        framebuffer: msaaFramebuffer,
        resolveFramebuffer: resolve.framebuffer,
        texture: resolve.texture,
        renderbuffer,
        width,
        height,
        /** Blit MSAA renderbuffer to resolve texture */
        resolve() {
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, msaaFramebuffer);
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, resolve.framebuffer);
            gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.LINEAR);
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
        },
        destroy() {
            gl.deleteRenderbuffer(renderbuffer);
            gl.deleteFramebuffer(msaaFramebuffer);
            destroyFBO(gl, resolve);
        }
    };
}

/**
 * Destroy an FBO and its texture.
 */
export function destroyFBO(gl, fbo) {
    if (fbo.texture) gl.deleteTexture(fbo.texture);
    if (fbo.framebuffer) gl.deleteFramebuffer(fbo.framebuffer);
}

// =============== VAOs =============== //

let fullscreenTriVAO = null;

/**
 * Get (or create) the fullscreen triangle VAO. Shared across all passes.
 * The vertex shader generates position/UV from gl_VertexID — no buffers needed.
 */
export function getFullscreenTriVAO(gl) {
    if (!fullscreenTriVAO) {
        fullscreenTriVAO = gl.createVertexArray();
    }
    return fullscreenTriVAO;
}

/**
 * Create a grid mesh VAO with (resolution+1)^2 vertices.
 * Vertex positions are in [0, 1] range.
 * Index buffer: two triangles per cell (matching density shader triangulation).
 */
export function createGridVAO(gl, resolution) {
    const n = resolution + 1;
    const positions = new Float32Array(n * n * 2);
    for (let j = 0; j <= resolution; j++) {
        for (let i = 0; i <= resolution; i++) {
            const idx = (j * n + i) * 2;
            positions[idx] = i / resolution;
            positions[idx + 1] = j / resolution;
        }
    }

    // Two triangles per cell: (i,j)-(i+1,j)-(i+1,j+1) and (i,j)-(i+1,j+1)-(i,j+1)
    const indices = new Uint32Array(resolution * resolution * 6);
    let ptr = 0;
    for (let j = 0; j < resolution; j++) {
        for (let i = 0; i < resolution; i++) {
            const v00 = j * n + i;
            const v10 = j * n + (i + 1);
            const v01 = (j + 1) * n + i;
            const v11 = (j + 1) * n + (i + 1);
            indices[ptr++] = v00;
            indices[ptr++] = v10;
            indices[ptr++] = v11;
            indices[ptr++] = v00;
            indices[ptr++] = v11;
            indices[ptr++] = v01;
        }
    }

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const idxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    gl.bindVertexArray(null);

    const indexCount = indices.length;
    return {
        vao,
        posBuf,
        idxBuf,
        indexCount
    };
}

/**
 * Destroy a grid VAO and its buffers.
 */
export function destroyGridVAO(gl, grid) {
    gl.deleteBuffer(grid.posBuf);
    gl.deleteBuffer(grid.idxBuf);
    gl.deleteVertexArray(grid.vao);
}

// =============== Draw Passes =============== //

/**
 * Set uniforms on a program. Handles float, int, vec2 (array of 2), sampler2D (int).
 * `textures` is an object { uniformName: WebGLTexture }
 * `values` is an object { uniformName: number | [number, number] }
 */
function bindUniforms(gl, prog, textures, values) {
    let texUnit = 0;
    for (const [name, tex] of Object.entries(textures)) {
        const loc = prog.uniforms[name];
        if (loc == null) continue;
        gl.activeTexture(gl.TEXTURE0 + texUnit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(loc, texUnit);
        texUnit++;
    }
    for (const [name, val] of Object.entries(values)) {
        const loc = prog.uniforms[name];
        if (loc == null) continue;
        if (Array.isArray(val)) {
            if (val.length === 2) gl.uniform2f(loc, val[0], val[1]);
            else if (val.length === 3) gl.uniform3f(loc, val[0], val[1], val[2]);
            else if (val.length === 4) gl.uniform4f(loc, val[0], val[1], val[2], val[3]);
        } else {
            gl.uniform1f(loc, val);
        }
    }
}

/**
 * Run a fullscreen fragment shader pass.
 * target: FBO object (or null for screen). Uses target.width/height for viewport.
 * textures: { uniformName: WebGLTexture }
 * values: { uniformName: number }
 */
export function fullscreenPass(gl, prog, textures, values, target) {
    gl.useProgram(prog.program);

    if (target) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
        gl.viewport(0, 0, target.width, target.height);
    } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        // Don't override viewport — caller sets it (e.g. for split-screen previews)
    }

    bindUniforms(gl, prog, textures, values);

    gl.bindVertexArray(getFullscreenTriVAO(gl));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
}

/**
 * Run a grid mesh draw pass (for transport rendering).
 * clear: if true, clears the target to black first.
 * blendAdditive: if true, enables additive blending for the draw.
 */
export function gridPass(gl, prog, textures, values, target, gridVAO, {
    clear = true,
    blendAdditive = false
} = {}) {
    gl.useProgram(prog.program);

    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);

    if (clear) {
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
    }

    if (blendAdditive) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
    }

    bindUniforms(gl, prog, textures, values);

    gl.bindVertexArray(gridVAO.vao);
    gl.drawElements(gl.TRIANGLES, gridVAO.indexCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);

    if (blendAdditive) {
        gl.disable(gl.BLEND);
    }
}

// =============== Texture Loading =============== //

/**
 * Load an image as a WebGL texture. Returns a promise.
 */
export function loadTexture(gl, url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.bindTexture(gl.TEXTURE_2D, null);
            resolve(tex);
        };
        img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
        img.src = url;
    });
}

/**
 * Upload an HTMLImageElement or HTMLCanvasElement as a WebGL texture.
 */
export function uploadTexture(gl, source) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
}