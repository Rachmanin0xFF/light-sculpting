'use strict';

import {
    createFBO, destroyFBO,
    createMSAAFBO,
    createGridVAO, destroyGridVAO,
    fullscreenPass, gridPass
} from './gl.js';

/**
 * Single-resolution transport solver. Represents one level of the coarse-to-fine cascade.
 *
 * Each iteration:
 *   1. Compute density (area change) from displacements
 *   2. Render caustics via displaced mesh rasterization + additive blending
 *   3. Compute error: target - caustics
 *   4. Poisson solve on error → gradient → flow field
 *   5. Helmholtz decomposition (remove curl from flow)
 *   6. Update displacements by curl-free flow * stepSize
 */
export class TransportLevel {
    /**
     * @param {WebGL2RenderingContext} gl
     * @param {object} programs - compiled shader programs
     * @param {number} resolution - grid resolution for this level
     * @param {PoissonSolver} poissonSolver - shared multigrid solver
     * @param {number} pixelDensity - supersampling factor for the lightmap
     */
    constructor(gl, programs, resolution, poissonSolver, pixelDensity = 2) {
        this.gl = gl;
        this.programs = programs;
        this.resolution = resolution;
        this.poissonSolver = poissonSolver;
        this.pixelDensity = pixelDensity;

        const res = resolution;
        const lpRes = res * pixelDensity;

        // Displacement field: (res+1) x (res+1), vertices at cell corners
        this.displacements = createFBO(gl, res + 1, res + 1, 'RGBA32F', gl.LINEAR);

        // Per-cell density (area compression ratio)
        this.densities = createFBO(gl, res, res, 'RGBA32F', gl.LINEAR);

        // Caustic lightmap: higher res with MSAA for smooth triangle rasterization
        this.lightmap = createMSAAFBO(gl, lpRes, lpRes, 'RGBA32F', 16);

        // Error: target - lightmap
        this.difference = createFBO(gl, res, res, 'RGBA32F', gl.LINEAR);

        // Gradient of Poisson solution
        this.gradient = createFBO(gl, res, res, 'RG32F', gl.LINEAR);

        // Flow vectors (before Helmholtz decomposition)
        this.flow = createFBO(gl, res, res, 'RG32F', gl.LINEAR);

        // Divergence (scalar)
        this.divergence = createFBO(gl, res, res, 'R32F', gl.LINEAR);

        // Heightmap from Helmholtz decomposition
        this.heightmap = createFBO(gl, res, res, 'R32F', gl.LINEAR);

        // Scratch buffers
        this.tempA = createFBO(gl, res, res, 'RG32F', gl.LINEAR);
        this.tempB = createFBO(gl, res, res, 'RG32F', gl.LINEAR);

        // Grid mesh for displaced rasterization
        this.grid = createGridVAO(gl, res);
    }

    /**
     * Initialize displacements by upsampling from a previous (coarser) level's texture.
     * Linear filtering on the source texture handles interpolation.
     */
    initFromPrevious(prevDisplacementTexture) {
        fullscreenPass(this.gl, this.programs.copy,
            { map: prevDisplacementTexture },
            {},
            this.displacements
        );
    }

    /**
     * Initialize displacements to zero.
     */
    initZero() {
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.displacements.framebuffer);
        gl.viewport(0, 0, this.displacements.width, this.displacements.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Run one full solver iteration.
     * @param {WebGLTexture} targetTexture - the target image texture
     * @param {WebGLTexture} sourceTexture - the source irradiance texture (or null for uniform)
     * @param {number} stepSize - gradient descent step size
     */
    iterate(targetTexture, sourceTexture, stepSize, targetScale = 1.0) {
        const gl = this.gl;
        const res = this.resolution;
        const progs = this.programs;

        // --- 1. Compute densities from displacement field ---
        fullscreenPass(gl, progs.density,
            { displacements: this.displacements.texture },
            { resolution: res },
            this.densities
        );

        // --- 2. Render caustics (displaced mesh + additive blending) ---
        gridPass(gl, progs.transport,
            {
                displacements: this.displacements.texture,
                densities: this.densities.texture,
                source: sourceTexture,
            },
            { resolution: res },
            this.lightmap,  // MSAA FBO
            this.grid,
            { clear: true, blendAdditive: true }
        );
        // Resolve MSAA → readable texture
        this.lightmap.resolve();

        // --- 3. Error: target - current lightmap ---
        fullscreenPass(gl, progs.subtract,
            { A: targetTexture, B: this.lightmap.texture },
            { targetScale },
            this.difference
        );

        // --- 4. Poisson solve on error ---
        this.poissonSolver.solve(this.difference, this.tempB, res);

        // --- 5. Gradient of Poisson solution ---
        fullscreenPass(gl, progs.gradient,
            { map: this.tempB.texture },
            { resolution: res },
            this.gradient
        );

        // --- 6. Calculate flow vectors (semi-Lagrangian advection) ---
        // UV remapping from displacement-texel space is done inside the fragment shader
        fullscreenPass(gl, progs.calculateFlow,
            {
                map_delta: this.gradient.texture,
                uv_tex: this.displacements.texture,
            },
            { resolution: res },
            this.flow
        );

        // --- 7. Helmholtz decomposition: remove curl from flow ---
        // 7a. Divergence of flow field
        fullscreenPass(gl, progs.divergence,
            { map: this.flow.texture },
            { resolution: res },
            this.divergence
        );

        // 7b. Poisson solve on divergence
        this.poissonSolver.solveCoarsePriority(this.divergence, this.heightmap, res);

        // 7c. Gradient of solution = curl-free component
        fullscreenPass(gl, progs.gradient,
            { map: this.heightmap.texture },
            { resolution: res },
            this.tempA
        );

        // --- 8. Update displacements ---
        // Copy current displacements to tempB
        fullscreenPass(gl, progs.copy,
            { map: this.displacements.texture },
            {},
            this.tempB
        );

        // new_disp = old_disp + stepSize * curl_free_flow
        fullscreenPass(gl, progs.addMult,
            { A: this.tempB.texture, B: this.tempA.texture },
            { stepSize: stepSize, resolution: res },
            this.displacements
        );
    }

    /**
     * Recover the final heightmap from the displacement field.
     * (divergence of displacements → Poisson solve)
     */
    recoverHeightmap() {
        const gl = this.gl;
        const res = this.resolution;

        fullscreenPass(gl, this.programs.divergence,
            { map: this.displacements.texture },
            { resolution: res },
            this.divergence
        );
        this.poissonSolver.solveCoarsePriority(this.divergence, this.heightmap, res);

        return this.heightmap;
    }

    /**
     * Destroy all GPU resources for this level.
     */
    destroy() {
        const gl = this.gl;
        destroyFBO(gl, this.displacements);
        destroyFBO(gl, this.densities);
        this.lightmap.destroy();
        destroyFBO(gl, this.difference);
        destroyFBO(gl, this.gradient);
        destroyFBO(gl, this.flow);
        destroyFBO(gl, this.divergence);
        destroyFBO(gl, this.heightmap);
        destroyFBO(gl, this.tempA);
        destroyFBO(gl, this.tempB);
        destroyGridVAO(gl, this.grid);
    }
}
