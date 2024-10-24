import * as THREE from 'three';

const mouse = new THREE.Vector2();
document.addEventListener('mousemove', onDocumentMouseMove, false);
function onDocumentMouseMove(event) {
    event.preventDefault();
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

const transportVertexShader = `#version 300 es
in vec4 position;
out vec4 vPosition;
uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
uniform sampler2D map;
uniform float RES;
out vec2 uv;
uniform float time;
out float brightness;
void main()	{
    gl_Position = projectionMatrix * modelViewMatrix * position;
    vPosition = gl_Position;

    uv = gl_Position.xy*0.5 + 0.5;
    brightness = 3.0*(0.4 - length(uv - vec2(0.5, 0.5)));
    brightness = 1.0;

    float dp = 0.1;


    float h0 = texture(map, uv).x;
    
    float h1 = texture(map, uv + vec2(dp, 0)).x;
    float h2 = texture(map, uv + vec2(-dp, 0)).x;

    float h3 = texture(map, uv + vec2(0, dp)).x;
    float h4 = texture(map, uv + vec2(0, -dp)).x;

    vec2 dpos = vec2(h1 - h2, h3 - h4);
    
    gl_Position.xy += dpos*0.00001;
    
}
`;

const transportFragmentShader = `#version 300 es
precision mediump float;
in vec4 vPosition;
out vec4 outColor;
in float brightness;
in vec2 uv;
void main() {
    float f = brightness*length(dFdx(uv))*length(dFdy(uv))*180000.0;
    f = min(f, 100000.0);
    outColor = vec4(f, 0, 0, 1);
    //outColor.r = texture(map, uv).x;
}
`;

const generalVertexShader = `#version 300 es
precision mediump float;
in vec4 position;
out vec4 vPosition;
uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
out vec2 uv;
void main()	{
    gl_Position = projectionMatrix * modelViewMatrix * position;
    vPosition = gl_Position;
    uv = gl_Position.xy*0.5 + 0.5;
}
`
const poissonFragmentShader = `#version 300 es
precision mediump float;
in vec4 vPosition;
in vec2 uv;
out vec4 outColor;
uniform float RES;
uniform sampler2D map_density;
uniform sampler2D map_iter;
void main() {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    float s0 = texture(map_iter, uv).x;
    float s1 = texture(map_iter, uv + vec2(0.0, 1.0)/RES).x;
    float s2 = texture(map_iter, uv + vec2(0.0, -1.0)/RES).x;
    float s3 = texture(map_iter, uv + vec2(1.0, 0.0)/RES).x;
    float s4 = texture(map_iter, uv + vec2(-1.0, 0.0)/RES).x;
    outColor.r = (s1 + s2 + s3 + s4)*0.25 + texture(map_density, uv).x;
}
`

const subtractFragmentShader = `#version 300 es
precision mediump float;
in vec4 vPosition;
in vec2 uv;
out vec4 outColor;
uniform sampler2D map_A;
uniform sampler2D map_B;
void main() {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    outColor.r = texture(map_B, uv).x - texture(map_A, uv).x;
}
`

const accumulateFragmentShader = `#version 300 es
precision mediump float;
in vec4 vPosition;
in vec2 uv;
out vec4 outColor;
uniform sampler2D map_previous;
uniform sampler2D map_delta;
void main() {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    outColor.r = texture(map_previous, uv).x + texture(map_delta, uv).x;
}
`

const copyFragmentShader = `#version 300 es
precision mediump float;
in vec4 vPosition;
in vec2 uv;
out vec4 outColor;
uniform sampler2D map;
uniform float RES;
void main() {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    //float RES = 800.0;
    float s0 = texture(map, uv).x;
    outColor.r = s0;
}
`

const darkFragmentShader = `#version 300 es
precision mediump float;
in vec4 vPosition;
in vec2 uv;
out vec4 outColor;
void main() {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
}
`

const renderer = new THREE.WebGLRenderer({antialias: true});
renderer.getContext().getExtension('EXT_float_blend'); // necessary to do floating-point textures with additive blending
renderer.setSize(800, 800, false);
(document.getElementById('demo') || document.body).appendChild(renderer.domElement);

const screen_scene = new THREE.Scene();
//const screen_camera = new THREE.OrthographicCamera( 0, 1, 1, 0, -1, 1 );
const screen_camera = new THREE.PerspectiveCamera( 27, window.innerWidth / window.innerHeight, 1, 3500 );
screen_scene.add( screen_camera );

function get_quad(material) {
    let quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    quad.position.z = - 1;
    quad.position.x = 0.5;
    quad.position.y = 0.5;
    return quad;
}

class PoissonSolver {
    constructor(resolution, samples=8) {
        this.resolution = resolution;
        this.RTcam = new THREE.OrthographicCamera( 0, 1, 1, 0, -1, 1 );
        this.RTA = new THREE.WebGLRenderTarget(resolution, resolution, {
            type: THREE.FloatType,
            format: THREE.RedFormat,
            samples: samples,
        });
        this.RTB = new THREE.WebGLRenderTarget(resolution, resolution, {
            type: THREE.FloatType,
            format: THREE.RedFormat,
            samples: samples
        });
        this.materialA = new THREE.RawShaderMaterial({
            side: THREE.DoubleSide,
            vertexShader: generalVertexShader,
            fragmentShader: poissonFragmentShader,
            blending: THREE.NormalBlending,
            depthTest: false,
            depthWrite: false,
            uniforms: {
                map_density: {value: null},
                map_iter: {value: this.RTA.texture},
                RES: {value: resolution},
                time: {value: 0.0 }
            }
        });
        this.materialB = new THREE.RawShaderMaterial({
            side: THREE.DoubleSide,
            vertexShader: generalVertexShader,
            fragmentShader: poissonFragmentShader,
            depthTest: false,
            blending: THREE.NormalBlending,
            depthWrite: false,
            uniforms: {
                map_density: {value: null},
                map_iter: {value: this.RTB.texture},
                RES: {value: resolution},
                time: {value: 0.0 }
            }
        });
        this.material_dark = new THREE.RawShaderMaterial({
            side: THREE.DoubleSide,
            vertexShader: generalVertexShader,
            fragmentShader: darkFragmentShader,
            depthTest: false,
            blending: THREE.NoBlending,
            depthWrite: false,
        });
        this.material_solution = new THREE.MeshBasicMaterial({
            map: this.RTB.texture,
            blending: THREE.NoBlending
        })
        this.materialA.uniforms.map_iter.value = this.RTA.texture;
        this.materialB.uniforms.map_iter.value = this.RTB.texture;
        this.materialA.needsUpdate = true;
        this.materialB.needsUpdate = true;

        this.quadA = get_quad(this.materialA);
        this.quadB = get_quad(this.materialB);
        this.quad_dark = get_quad(this.material_dark)

        this.solution_quad = get_quad(this.material_solution);
    }

    refresh() {
        this.materialA.uniforms.map_iter.value = this.RTA.texture;
        this.materialB.uniforms.map_iter.value = this.RTB.texture;
        this.materialA.uniforms.map_iter.value.needsUpdate = true;
        this.materialB.uniforms.map_iter.value.needsUpdate = true;
        this.RTA.texture.needsUpdate = true;
        this.RTB.texture.needsUpdate = true;
        this.materialA.needsUpdate = true;
        this.materialB.needsUpdate = true;
        this.quadA.needsUpdate = true;
        this.quadB.needsUpdate = true;
        this.solution_quad.material.needsUpdate = true;
        this.solution_quad.needsUpdate = true;
    }
    // 1. Materials A and B have their map_density set to the input texture
    // 2. A quad using Material B is drawn to RTA
    // 3. A quad using Material A is drawn to RTB
    // 4. Repeat steps 2 and 3 many times
    // 5. Return materialB?
    solve(input_texture, iterations=1) {
        
        this.materialA.uniforms.map_density.value = input_texture;
        this.materialB.uniforms.map_density.value = input_texture;
        this.refresh();

        // clearing isn't working. can't figure out why. drawing a dark quad instead.
        renderer.setRenderTarget(this.RTA, this.RTcam);
        renderer.render(this.quad_dark, this.RTcam);
        renderer.setRenderTarget(this.RTB, this.RTcam);
        renderer.render(this.quad_dark, this.RTcam);
        
        this.refresh();

        for(let i = 0; i < 64; i++) {
            renderer.setRenderTarget(this.RTA, this.RTcam);
            renderer.render(this.quad_dark, this.RTcam);
            renderer.render(this.quadB, this.RTcam);
            this.refresh();
            
            renderer.setRenderTarget(this.RTB, this.RTcam);
            renderer.render(this.quad_dark, this.RTcam);
            renderer.render(this.quadA, this.RTcam);
            this.refresh();
        }
        
        return this.solution_quad;
    }
}

class Caustic {
    /**
     * Sets up Caustic mesh BufferGeometry object, R16F texture, and render target.
     * @param {int} resolution The wavefront mesh resolution.
     * @param {int} pixels_per_cell Each face in the mesh nominally occupies a space of (this many pixels)^2.
     * @param {int} samples The number of MSAA samples to take when rendering.
     */
    constructor(resolution, pixels_per_cell=4, samples=8, make_random_heightmap=true) {
        this.resolution = resolution;
        this.pixels_per_cell = pixels_per_cell;
        this.samples = samples;
        // =========== DISPLACEMENT TEXTURE SETUP =========== //

        this.surface_heightmap = new Float32Array(2*resolution**2);
        function xytoi(x, y) {
            return x + y*resolution;
        }

        // by default, set up a random smooth texture 
        if(make_random_heightmap) {
            for(let i = 0; i < this.surface_heightmap.length; i++) {
                this.surface_heightmap[i] = (Math.random()-0.5)*1.0;
            }
        }
        
        console.log(this.surface_heightmap);
        this.dataTexture = new THREE.DataTexture(
            this.surface_heightmap,
            resolution,
            resolution,
            THREE.RGFormat,
            THREE.FloatType);
        this.dataTexture.needsUpdate = true;

        // =========== WAVEFRONT SETUP =========== //
        
        this.buffer_geom = new THREE.BufferGeometry();
        let verts = [];
        let indices = [];
        let i = 0;
        for(let x = 0; x < resolution; x++) {
            for(let y = 0; y < resolution; y++) {
                verts[i] = x / (resolution-1.0);
                verts[i+1] = y / (resolution-1.0);
                verts[i+2] = 0;
                i += 3;
                if(x < resolution-1 && y < resolution-1) {
                    indices.push(x + y*resolution, (x+1) + y*resolution, (x+1) + (y+1)*resolution);
                    indices.push((x+1) + (y+1)*resolution, x + (y+1)*resolution, x + y*resolution);
                }
            }
        }
        this.geom_vertices = new Float32Array(verts);
        this.buffer_geom.setAttribute('position', new THREE.BufferAttribute(this.geom_vertices, 3));
        this.buffer_geom.setIndex(indices);
        this.material = new THREE.RawShaderMaterial({
            side: THREE.DoubleSide,
            vertexShader: transportVertexShader,
            fragmentShader: transportFragmentShader,
            blending: THREE.AdditiveBlending,
            depthTest: false,
            depthWrite: false,
            uniforms: {
                map: {value: this.dataTexture},
                RES: {value: resolution},
                time: {value: 0.0 }
            }
        });
        console.log(this.material.uniforms);
        this.material.uniforms.map.value = this.dataTexture;
        this.wavefront = new THREE.Mesh(this.buffer_geom, this.material);

        
        // =========== WAVEFRONT RENDER TARGET SETUP =========== //

        this.RTcam = new THREE.OrthographicCamera( 0, 1, 1, 0, -1, 1 );
        this.RT = new THREE.WebGLRenderTarget(resolution*pixels_per_cell, resolution*pixels_per_cell, {
            type: THREE.FloatType,
            format: THREE.RedFormat,
            //magFilter: THREE.NearestFilter,
            samples: samples
        });
    }

    /**
     * Renders a caustic to this.lightmap_material.map (the material of the Caustic's lightmap_quad mesh).
     * @param {THREE.Texture} heightmap_tex The heightmap to deform the caustic by. Defaults to this.dataTexture.
     */
    render(heightmap_tex = this.dataTexture) {
        this.material.uniforms.map.value = heightmap_tex;
        this.material.needsUpdate = true;
        
        this.lightmap_material = new THREE.MeshBasicMaterial({
            map: this.RT.texture
        });
        this.plane = new THREE.PlaneGeometry(1, 1);
        this.lightmap_quad = new THREE.Mesh(this.plane, this.lightmap_material);
        this.lightmap_quad.position.z = - 1;

        renderer.setRenderTarget(this.RT, this.RTcam);
        renderer.clear();
        renderer.render(this.wavefront, this.RTcam);
    }
}

class OTSolver {
    constructor(resolution) {
        this.caus = new Caustic(resolution);
        this.p_solver = new PoissonSolver(resolution);
        this.caus.render();
        this.heightmap = new THREE.WebGLRenderTarget(resolution, resolution, {
            type: THREE.FloatType,
            format: THREE.RedFormat
        });
        this.RTA = new THREE.WebGLRenderTarget(resolution, resolution, {
            type: THREE.FloatType,
            format: THREE.RedFormat
        });
        this.caus.render(this.heightmap.texture);
        this.materialSubtract = new THREE.RawShaderMaterial({
            side: THREE.DoubleSide,
            vertexShader: generalVertexShader,
            fragmentShader: subtractFragmentShader,
            depthTest: false,
            blending: THREE.NormalBlending,
            depthWrite: false,
            uniforms: {
                map_A: {value: this.caus.RT.texture},
                map_B: {value: this.heightmap.texture},
                RES: {value: resolution},
                time: {value: 0.0 }
            }
        });
        this.materialAccumulate = new THREE.RawShaderMaterial({
            side: THREE.DoubleSide,
            vertexShader: generalVertexShader,
            fragmentShader: accumulateFragmentShader,
            depthTest: false,
            blending: THREE.NormalBlending,
            depthWrite: false,
            uniforms: {
                map_previous: {value: this.RTA.texture},
                map_delta: {value: this.p_solver.RTA.texture},
                RES: {value: resolution},
                time: {value: 0.0 }
            }
        });
        this.materialCopy = new THREE.RawShaderMaterial({
            side: THREE.DoubleSide,
            vertexShader: generalVertexShader,
            fragmentShader: copyFragmentShader,
            depthTest: false,
            blending: THREE.NormalBlending,
            depthWrite: false,
            uniforms: {
                map: {value: this.heightmap.texture},
                RES: {value: this.resolution}
            }
        });
        this.materialSolution = new THREE.MeshBasicMaterial({
            map: this.caus.RT.texture,
            blending: THREE.NoBlending
        })
        
        this.quadSub = get_quad(this.materialSubtract);
        this.quadCopy = get_quad(this.materialCopy);
        this.quadAccumulate = get_quad(this.materialAccumulate);
        this.solution_quad = get_quad(this.materialSolution);
    }
    iterate(target) {
        // Transport by heightmap
        this.caus.render(this.heightmap.texture);

        // Subtract out target
        this.materialSubtract.uniforms.map_B.value = target;
        this.materialSubtract.needsUpdate = true;
        renderer.setRenderTarget(this.RTA, this.p_solver.RTcam);
        renderer.render(this.p_solver.quad_dark, this.p_solver.RTcam);
        renderer.render(this.quadSub, this.p_solver.RTcam);

        // Solve Poisson on subtracted
        this.p_solver.solve(this.RTA.texture, 64);

        // Copy heightmap to temp texture
        renderer.setRenderTarget(this.RTA, this.p_solver.RTcam);
        renderer.render(this.p_solver.quad_dark, this.p_solver.RTcam);
        renderer.render(this.quadCopy, this.p_solver.RTcam);

        // Update heightmap
        renderer.setRenderTarget(this.heightmap, this.p_solver.RTcam);
        renderer.render(this.p_solver.quad_dark, this.p_solver.RTcam);
        renderer.render(this.quadAccumulate, this.p_solver.RTcam);

        // Finish up
        this.solution_quad.material.needsUpdate = true;
        this.solution_quad.needsUpdate = true;
        renderer.setRenderTarget(null, this.p_solver.RTcam);
    }
}

var caus = new Caustic(10);

var p_solver = new PoissonSolver(10);

var ots = new OTSolver(200);

const letter_texture = new THREE.TextureLoader().load('letter.png');

ots.iterate(letter_texture);

caus.render();
//console.log(caus.RTscene);
//screen_scene.add(caus.lightmap_quad);
//caus.wavefront.position.x = 0.0;
//caus.wavefront.position.y = 0.0;
//caus.wavefront.position.z = 0.0;
screen_scene.add(ots.solution_quad);
ots.solution_quad.position.x = -0.0;
ots.solution_quad.position.y = 0;
ots.solution_quad.position.z = 0;

//screen_scene.add(p_solver.solution_quad);
//p_solver.solution_quad.position.x = 0.5;
//p_solver.solution_quad.position.y = 0;
//p_solver.solution_quad.position.z = 0;
//-------- ----------
// RENDER
//-------- ----------
renderer.setSize(800, 800, false);
renderer.render(screen_scene, screen_camera);
let window_dims = {x: 0, y: 0};

let ii = 0;



renderer.setAnimationLoop(() => {
    if(window.innerWidth != window_dims.x || window.innerHeight != window_dims.y) {
        window_dims = {x: window.innerWidth, y: window.innerHeight};
        renderer.setSize(window.innerWidth, window.innerHeight, false);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setRenderTarget(null, screen_camera);

        screen_camera.aspect = window.innerWidth / window.innerHeight;
		screen_camera.updateProjectionMatrix();
        screen_camera.position.z = 2.3;
    }

    caus.render();


    let r = 10.0;
    //screen_camera.position.x = -mouse.x*1.0;
    //screen_camera.position.y = -mouse.y*1.0;
    screen_camera.lookAt(0, 0, 0);
    renderer.setRenderTarget(null, screen_camera);
    renderer.render(screen_scene, screen_camera);
   
    caus.wavefront.material.uniforms.time.value += 0.01;

    //p_solver.solve(letter_texture);
    ots.iterate(letter_texture);
    //p_solver.solve(caus.RT.texture);
});