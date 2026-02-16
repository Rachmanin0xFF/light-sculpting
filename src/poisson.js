'use strict';

import {
    createFBO,
    destroyFBO,
    fullscreenPass
} from './gl.js';

/**
 * Multigrid Poisson solver using Jacobi relaxation on a hierarchy of grid resolutions.
 *
 * Solves  ∇²u = f  using ping-pong FBO pairs at each scale.
 * Linear-filtered textures handle inter-scale prolongation/restriction automatically.
 */
export class PoissonSolver {
    /**
     * @param {WebGL2RenderingContext} gl
     * @param {object} programs - { poisson: compiled program with poissonFrag }
     * @param {number} maxResolution - the finest resolution to support
     */
    constructor(gl, programs, maxResolution) {
        this.gl = gl;
        this.poissonProg = programs.poisson;
        this.poissonNeumannProg = programs.poissonNeumann;
        this.copyProg = programs.copy;

        // Build grid hierarchy: halving from maxResolution down to 8
        this.levels = [];
        for (let n = maxResolution; n >= 8; n = Math.floor(n / 2)) {
            this.levels.unshift({
                resolution: n,
                a: createFBO(gl, n, n, 'R32F', gl.LINEAR),
                b: createFBO(gl, n, n, 'R32F', gl.LINEAR),
            });
        }
    }

    /**
     * Clear all grid levels to zero.
     */
    clearAll() {
        const gl = this.gl;
        for (const level of this.levels) {
            for (const fbo of [level.a, level.b]) {
                gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.framebuffer);
                gl.viewport(0, 0, fbo.width, fbo.height);
                gl.clearColor(0, 0, 0, 0);
                gl.clear(gl.COLOR_BUFFER_BIT);
            }
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Run Jacobi iterations at a given level index, ping-ponging between a and b.
     * @param {object} inputFBO - the RHS texture (f in ∇²u = f)
     * @param {number} levelIdx - index into this.levels
     * @param {number} subIter - number of Jacobi iterations
     * @param {WebGLTexture|null} seedTexture - if provided, seed from this texture on first iteration
     */
    relaxLevel(inputFBO, levelIdx, subIter, seedTexture = null, prog = null) {
        const level = this.levels[levelIdx];
        const shader = prog || this.poissonProg;

        for (let j = 0; j < subIter; j++) {
            let sourceB = level.b;
            // On first iteration, seed from a different level's texture if provided
            if (j === 0 && seedTexture) {
                sourceB = {
                    texture: seedTexture
                };
            }

            fullscreenPass(this.gl, shader, {
                    map_density: inputFBO.texture,
                    map_iter: sourceB.texture
                }, {
                    resolution: level.resolution
                },
                level.a
            );
            fullscreenPass(this.gl, shader, {
                    map_density: inputFBO.texture,
                    map_iter: level.a.texture
                }, {
                    resolution: level.resolution
                },
                level.b
            );
        }
    }

    /**
     * Find the level index for a given resolution (or the closest one that doesn't exceed it).
     */
    levelIndexForResolution(res) {
        for (let i = this.levels.length - 1; i >= 0; i--) {
            if (this.levels[i].resolution <= res) return i;
        }
        return 0;
    }

    /**
     * V-cycle solve: down(1) → up(1) → down(N).
     * Uses all levels up to maxLevel.
     * @param {object} inputFBO - the RHS FBO
     * @param {object} outputFBO - where to copy the final result
     * @param {number} maxRes - max resolution to solve at (uses levels up to this)
     * @param {number} fineIter - number of iterations at the finest level in the final down-sweep
     */
    solve(inputFBO, outputFBO, maxRes, fineIter = 60) {
        const maxIdx = this.levelIndexForResolution(maxRes);
        this.clearAll();

        // Down sweep (coarse → fine), 1 sub-iteration each
        for (let i = 0; i <= maxIdx; i++) {
            const seed = i > 0 ? this.levels[i - 1].b.texture : null;
            this.relaxLevel(inputFBO, i, 1, seed);
        }

        // Up sweep (fine → coarse), 1 sub-iteration each
        for (let i = maxIdx; i >= 0; i--) {
            const seed = i < maxIdx ? this.levels[i + 1].b.texture : null;
            this.relaxLevel(inputFBO, i, 1, seed);
        }

        // Down sweep again, more iterations
        for (let i = 0; i <= maxIdx; i++) {
            const seed = i > 0 ? this.levels[i - 1].b.texture : null;
            this.relaxLevel(inputFBO, i, fineIter, seed);
        }

        // Copy finest level result to output
        this.copyToOutput(maxIdx, outputFBO);
    }

    /**
     * Run multiple V-cycles for high-accuracy solves (e.g. heightmap recovery).
     * Each cycle does down(1) → up(1) → down(fineIter), without clearing between cycles.
     */
    solveMultiVCycle(inputFBO, outputFBO, maxRes, cycles = 8, fineIter = 80, {
        neumann = false
    } = {}) {
        const maxIdx = this.levelIndexForResolution(maxRes);
        const prog = neumann ? this.poissonNeumannProg : null;
        this.clearAll();

        for (let c = 0; c < cycles; c++) {
            // Down sweep (coarse → fine), 1 sub-iteration each
            for (let i = 0; i <= maxIdx; i++) {
                const seed = i > 0 ? this.levels[i - 1].b.texture : null;
                this.relaxLevel(inputFBO, i, 1, seed, prog);
            }
            // Up sweep (fine → coarse), 1 sub-iteration each
            for (let i = maxIdx; i >= 0; i--) {
                const seed = i < maxIdx ? this.levels[i + 1].b.texture : null;
                this.relaxLevel(inputFBO, i, 1, seed, prog);
            }
            // Down sweep again, more iterations at each level
            for (let i = 0; i <= maxIdx; i++) {
                const seed = i > 0 ? this.levels[i - 1].b.texture : null;
                this.relaxLevel(inputFBO, i, fineIter, seed, prog);
            }
        }

        this.copyToOutput(maxIdx, outputFBO);
    }

    /**
     * Coarse-priority solve: single coarse-to-fine pass with many iterations per level.
     * Used for the Helmholtz decomposition and heightmap recovery.
     */
    solveCoarsePriority(inputFBO, outputFBO, maxRes, baseIter = 160) {
        const maxIdx = this.levelIndexForResolution(maxRes);
        this.clearAll();

        for (let i = 0; i <= maxIdx; i++) {
            const subIter = Math.floor(baseIter + 100.0 / ((i + 2) * (i + 1)));
            const seed = i > 0 ? this.levels[i - 1].b.texture : null;
            this.relaxLevel(inputFBO, i, subIter, seed);
        }

        this.copyToOutput(maxIdx, outputFBO);
    }

    /**
     * Copy the finest resolved level's result to an output FBO using a shader pass.
     * (blitFramebuffer requires matching formats; a shader copy is format-agnostic.)
     */
    copyToOutput(levelIdx, outputFBO) {
        const src = this.levels[levelIdx].b;
        fullscreenPass(this.gl, this.copyProg, {
                map: src.texture
            }, {},
            outputFBO
        );
    }

    destroy() {
        const gl = this.gl;
        for (const level of this.levels) {
            destroyFBO(gl, level.a);
            destroyFBO(gl, level.b);
        }
        this.levels = [];
    }
}