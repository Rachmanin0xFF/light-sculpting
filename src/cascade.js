'use strict';

import { createProgram } from './gl.js';
import { PoissonSolver } from './poisson.js';
import { TransportLevel } from './transporter.js';
import * as Shaders from './shaders.js';

/**
 * Step size and iteration schedule for each cascade level.
 * Coarse levels: large steps, many iterations (cheap).
 * Fine levels: small steps, fewer iterations (expensive but already close).
 */
const DEFAULT_SCHEDULE = {
    8:   { stepSize: 0.002,   iterations: 80 },
    16:  { stepSize: 0.001,   iterations: 80 },
    32:  { stepSize: 0.0005,  iterations: 80 },
    64:  { stepSize: 0.0002,  iterations: 30 },
    128: { stepSize: 0.0001,  iterations: 20 },
    256: { stepSize: 0.00005, iterations: 20 },
    512: { stepSize: 0.00002, iterations: 15 },
};

/**
 * Coarse-to-fine caustic engineering solver.
 *
 * Starts at low resolution, solves the transport problem to convergence,
 * upsamples the displacement field, and refines at the next resolution.
 */
export class CausticSolver {
    /**
     * @param {WebGL2RenderingContext} gl
     * @param {number} targetResolution - final resolution (must be power of 2)
     */
    constructor(gl, targetResolution) {
        this.gl = gl;
        this.targetResolution = targetResolution;

        // Compile all shader programs once
        this.programs = {
            copy:          createProgram(gl, Shaders.fullscreenVert, Shaders.copyFrag),
            density:       createProgram(gl, Shaders.fullscreenVert, Shaders.densityFrag),
            transport:     createProgram(gl, Shaders.transportVert,  Shaders.transportFrag),
            subtract:      createProgram(gl, Shaders.fullscreenVert, Shaders.subtractFrag),
            gradient:      createProgram(gl, Shaders.fullscreenVert, Shaders.gradientFrag),
            calculateFlow: createProgram(gl, Shaders.fullscreenVert, Shaders.calculateFlowFrag),
            divergence:    createProgram(gl, Shaders.fullscreenVert, Shaders.divergenceFrag),
            addMult:       createProgram(gl, Shaders.fullscreenVert, Shaders.addMultFrag),
            poisson:       createProgram(gl, Shaders.fullscreenVert, Shaders.poissonFrag),
            display:       createProgram(gl, Shaders.fullscreenVert, Shaders.displayFrag),
            tonemap:       createProgram(gl, Shaders.fullscreenVert, Shaders.tonemapFrag),
            displacementViz: createProgram(gl, Shaders.fullscreenVert, Shaders.displacementVizFrag),
        };

        // Build Poisson solver hierarchy for the target resolution
        this.poissonSolver = new PoissonSolver(gl, this.programs, targetResolution);

        // Compute cascade levels: 8, 16, 32, ..., targetResolution
        this.cascadeLevels = [];
        for (let n = 8; n <= targetResolution; n *= 2) {
            this.cascadeLevels.push(n);
        }
        // Ensure the target resolution is included even if it's not a clean power of 2 from 8
        if (this.cascadeLevels[this.cascadeLevels.length - 1] !== targetResolution) {
            this.cascadeLevels.push(targetResolution);
        }

        this.aborted = false;
    }

    /**
     * Run the full coarse-to-fine cascade.
     *
     * @param {WebGLTexture} targetTexture - target image
     * @param {WebGLTexture} sourceTexture - source irradiance (uniform white if null)
     * @param {object} options
     * @param {function} options.onProgress - callback({ level, iteration, totalLevels, resolution })
     * @param {function} options.onLevelComplete - callback(transportLevel) for visualization
     * @param {object} options.schedule - override default step/iteration schedule
     * @returns {Promise<{heightmapFBO, displacementTexture, finalLevel}>}
     */
    async solve(targetTexture, sourceTexture, options = {}) {
        const {
            onProgress = () => {},
            onLevelComplete = () => {},
            schedule = DEFAULT_SCHEDULE,
            targetScale = 1.0,
        } = options;

        this.aborted = false;
        let prevDisplacementTexture = null;
        let currentLevel = null;

        const totalLevels = this.cascadeLevels.length;

        for (let li = 0; li < totalLevels; li++) {
            if (this.aborted) break;

            const res = this.cascadeLevels[li];
            const config = schedule[res] || {
                stepSize: 0.001,
                iterations: 200,
            };

            console.log(`Cascade level ${li + 1}/${totalLevels}: ${res}x${res} (${config.iterations} iters, step=${config.stepSize})`);

            // Create transport level for this resolution
            currentLevel = new TransportLevel(
                this.gl, this.programs, res, this.poissonSolver
            );

            // Initialize displacement field
            if (prevDisplacementTexture) {
                currentLevel.initFromPrevious(prevDisplacementTexture);
            } else {
                currentLevel.initZero();
            }

            // Run iterations
            let lastYieldTime = performance.now();
            for (let i = 0; i < config.iterations; i++) {
                if (this.aborted) break;

                currentLevel.iterate(targetTexture, sourceTexture, config.stepSize, targetScale);

                // Yield to browser periodically for UI responsiveness
                const now = performance.now();
                if (now - lastYieldTime > 32) {  // ~30fps yield rate
                    onProgress({
                        level: li,
                        resolution: res,
                        iteration: i,
                        totalIterations: config.iterations,
                        totalLevels,
                        transportLevel: currentLevel,
                    });
                    await new Promise(r => requestAnimationFrame(r));
                    lastYieldTime = performance.now();
                }
            }

            onLevelComplete(currentLevel);

            // Save displacement texture for next level's upsampling
            // (the texture is still valid even after we destroy other FBOs)
            prevDisplacementTexture = currentLevel.displacements.texture;

            // Destroy everything except displacements if there's a next level
            if (li < totalLevels - 1) {
                // We need to keep the displacement texture alive for upsampling.
                // Detach it from the FBO before destroying, then clean it up after
                // the next level reads it.
                const savedDispTex = currentLevel.displacements.texture;
                currentLevel.displacements.texture = null; // prevent destroyFBO from deleting it
                currentLevel.destroy();

                // Store ref so we can clean up after next level reads it
                prevDisplacementTexture = savedDispTex;
            }
        }

        if (this.aborted) {
            if (currentLevel) currentLevel.destroy();
            return null;
        }

        // Recover the final heightmap
        const heightmapFBO = currentLevel.recoverHeightmap();

        return {
            heightmapFBO,
            displacementTexture: prevDisplacementTexture,
            finalLevel: currentLevel,
        };
    }

    /**
     * Abort a running solve.
     */
    abort() {
        this.aborted = true;
    }

    destroy() {
        this.poissonSolver.destroy();
        // Programs are not destroyed here (could be reused)
    }
}
