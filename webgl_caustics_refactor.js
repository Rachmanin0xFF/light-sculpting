'use strict';

// =============== WebGL Context Initialization =============== //

import * as THREE from 'three';
const renderer = new THREE.WebGLRenderer({antialias: true});
renderer.getContext().getExtension('EXT_float_blend'); // necessary to do floating-point textures with additive blending

// =============== Three.js GPGPU wrappers =============== //

const genericVertexShader = `#version 300 es
precision mediump float;
in vec4 position;
uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;

out vec2 uv;
void main()	{
    gl_Position = projectionMatrix * modelViewMatrix * position;
    uv = position.xy + 0.5;
}
`
const genericFragmentShader = `#version 300 es
precision mediump float;
in vec2 uv;
out vec4 outColor;
uniform sampler2D map;
void main() {
    outColor.rgba = texture(map, uv).rgba;
}
`
const blackFragmentShader = `#version 300 es
precision mediump float;
in vec2 uv;
out vec4 outColor;
void main() {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
}
`
const whiteFragmentShader = `#version 300 es
precision mediump float;
in vec2 uv;
out vec4 outColor;
void main() {
    outColor = vec4(1.0, 1.0, 1.0, 0.1);
}
`
const randomFragmentShader = `#version 300 es
precision mediump float;
in vec2 uv;
out vec4 outColor;
uniform float time;
float rand(vec2 co){
    //return sin((co.x + co.y)*10.0) + cos((co.x - co.y)*10.0);
    return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453)*2.0 - 1.0;
}
void main() {
    outColor.r = rand(gl_FragCoord.xy*0.01);
    outColor.g = rand(gl_FragCoord.xy*0.01 + vec2(4.9, 3.1));
    outColor.b = rand(gl_FragCoord.xy*0.01 + vec2(2.7, 1.5));
    outColor.a = 1.0;
    outColor.rgb *= time;
}
`
const densityCalculationFragmentShader = `#version 300 es
precision mediump float;
in vec2 uv;
out vec4 outColor;
uniform float resolution;
uniform sampler2D displacements;

float quad_area(vec2 v0, vec2 v1, vec2 v2, vec2 v3) {
    return 0.5*abs((v0.x*v1.y + v1.x*v2.y + v2.x*v3.y + v3.x*v0.y)
                 - (v0.y*v1.x + v1.y*v2.x + v2.y*v3.x + v3.y*v0.x));
}

float tri_area(vec2 v0, vec2 v1, vec2 v2) {
    return 0.5*abs((v0.x*v1.y + v1.x*v2.y + v2.x*v0.y)
                 - (v0.y*v1.x + v1.y*v2.x + v2.y*v0.x));
}

void main() {
    outColor.a = 1.0;
    float disp_texel_width = 1.0 / (resolution + 1.0);
    vec2 disp_texel_center = gl_FragCoord.xy * disp_texel_width;

    float out_texel_width = 1.0 / resolution;
    vec2 out_texel_center = uv;
    
    vec2 t_00 = texture(displacements, disp_texel_center + vec2(0.0, 0.0)*disp_texel_width).rg;
    vec2 t_10 = texture(displacements, disp_texel_center + vec2(1.0, 0.0)*disp_texel_width).rg;
    vec2 t_11 = texture(displacements, disp_texel_center + vec2(1.0, 1.0)*disp_texel_width).rg;
    vec2 t_01 = texture(displacements, disp_texel_center + vec2(0.0, 1.0)*disp_texel_width).rg;

    // Not entirely sure why these are the right coords
    // Initially thought it should be vec2(0.5, 0.5) but that didn't work out
    vec2 c_00 = t_00 + vec2(-1.0, -1.0)*out_texel_width;
    vec2 c_10 = t_10 + vec2( 1.0, -1.0)*out_texel_width;
    vec2 c_11 = t_11 + vec2( 1.0,  1.0)*out_texel_width;
    vec2 c_01 = t_01 + vec2(-1.0,  1.0)*out_texel_width;

    float nominal_area = out_texel_width*out_texel_width*4.0;
    // These are the triangles that are actually drawn
    // ...because WebGL doesn't support quad primitives
    // :(
    float area = tri_area(c_00, c_10, c_11) + tri_area(c_00, c_11, c_01);

    outColor.rgb = vec3(nominal_area / area);
}
`
const transportVertexShader = `#version 300 es
precision mediump float;
in vec4 position;
uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
uniform sampler2D densities;
uniform sampler2D displacements;
uniform sampler2D source;

uniform float resolution;
out vec2 uv;
void main()	{
    gl_Position = projectionMatrix * modelViewMatrix * position;
    uv = position.xy + 0.5;

    // This puts texel centers on vertex corners
    vec2 disp_coord = (uv*(resolution + 1.0) + 0.5)/ (resolution + 2.0);
    vec2 samp = texture(displacements, disp_coord).rg;
    gl_Position.xy += samp.xy;
}`
const transportFragmentShader = `#version 300 es
precision mediump float;
in vec2 uv;
out vec4 outColor;
uniform sampler2D densities;
uniform sampler2D displacements;
uniform sampler2D source;
uniform float resolution;
void main() {
    outColor.r = texture(densities, uv).r*texture(source, uv).r;
    //outColor.r = min(outColor.r, 200.0);
    outColor.a = 1.0;
}`
const transportUVFragmentShader = `#version 300 es
precision mediump float;
in vec2 uv;
out vec4 outColor;
uniform sampler2D densities;
uniform float resolution;
void main() {
    outColor.a = 1.0;
    outColor.rg = uv;
}`
const subtractFragmentShader = `#version 300 es
precision mediump float;
in vec2 uv;
out vec4 outColor;
uniform sampler2D A;
uniform sampler2D B;
void main() {
    float n1 = texture(A, uv).r;
    float n2 = texture(B, uv).r;
    outColor.r = n1 - n2;
    float border = 0.01;
    if(uv.x > 1.0 - border || uv.y > 1.0 - border || uv.x < border || uv.y < border) outColor.r = -0.02;
    outColor.a = 1.0;
}
`
const poissonFragmentShader = `#version 300 es
precision mediump float;
in vec2 uv;
out vec4 outColor;
uniform float resolution;
uniform sampler2D map_density;
uniform sampler2D map_iter;

void main() {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    float s0 = texture(map_iter, uv).x;
    float s1 = texture(map_iter, uv + vec2(0.0, 1.0)/resolution).x;
    float s2 = texture(map_iter, uv + vec2(0.0, -1.0)/resolution).x;
    float s3 = texture(map_iter, uv + vec2(1.0, 0.0)/resolution).x;
    float s4 = texture(map_iter, uv + vec2(-1.0, 0.0)/resolution).x;
    outColor.r = (s1 + s2 + s3 + s4)*0.25 + texture(map_density, uv).x*0.25; // should be 0.25
    outColor.a = 1.0;
}
`
const sineFragmentShader = `#version 300 es
precision mediump float;
in vec2 uv;
out vec4 outColor;
uniform sampler2D map;
void main() {
    vec3 t = texture(map, uv).rgb;
    outColor.rgb = -cos(400.4*t)*0.5 + vec3(0.5);
    if(t.x < 0.0) outColor.b = 1.0;
    outColor.a = 1.0;
}`
const gradientFragmentShader = `#version 300 es
precision mediump float;
in vec2 uv;
out vec4 outColor;
uniform float resolution;
uniform sampler2D map;
void main() {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    float s1 = texture(map, uv + vec2(1.0, 0.0)/resolution).x;
    float s2 = texture(map, uv + vec2(-1.0, 0.0)/resolution).x;
    float s3 = texture(map, uv + vec2(0.0, 1.0)/resolution).x;
    float s4 = texture(map, uv + vec2(0.0, -1.0)/resolution).x;
    outColor.r = (s1 - s2)*resolution;
    outColor.g = (s3 - s4)*resolution;
    outColor.a = 1.0;
}`
const accumulateVertexShader = `#version 300 es
precision mediump float;
in vec4 position;
uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
uniform float resolution;
out vec2 uv;
void main()	{
    gl_Position = projectionMatrix * modelViewMatrix * position;
    uv = position.xy + 0.5;
    uv = (uv*(resolution + 2.0) - 0.5) / (resolution + 1.0);
}`
const accumulateFragmentShader = `#version 300 es
precision mediump float;
in vec2 uv;
out vec4 outColor;
uniform sampler2D map_previous;
uniform sampler2D map_delta;
uniform sampler2D difference;
uniform sampler2D uv_tex;
uniform sampler2D lightmap;
uniform sampler2D curl;
uniform float resolution;
uniform float time;
float rand(vec2 co){
    return fract(sin(dot(co + vec2(time, 0.0), vec2(12.9898, 78.233))) * 43758.5453)*2.0 - 1.0;
}
void main() {
    vec2 disp_coord = (uv*(resolution + 1.0) + 0.5)/ (resolution + 2.0);
    vec2 adapted_coords = disp_coord + texture(uv_tex, uv).rg*0.5;
    vec2 normal_coords = uv;
    outColor.rgb = texture(map_previous, uv).rgb + 0.003*texture(map_delta, adapted_coords).rgb / resolution;
    outColor.a = 1.0;
}
`
const displayFragmentShader = `#version 300 es
precision mediump float;
in vec2 uv;
out vec4 outColor;
uniform sampler2D map;
void main() {
    outColor.rgba = texture(map, uv).rgba;
    outColor.rgb *= 0.01;
    outColor.b = length(outColor.rg);
}
`
const divergenceFragmentShader = `#version 300 es
precision mediump float;
in vec2 uv;
out vec4 outColor;
uniform float resolution;
uniform sampler2D map;
void main() {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    float s1 = texture(map, uv + vec2(1.0, 0.0)/resolution).x;
    float s2 = texture(map, uv + vec2(-1.0, 0.0)/resolution).x;
    float s3 = texture(map, uv + vec2(0.0, 1.0)/resolution).y;
    float s4 = texture(map, uv + vec2(0.0, -1.0)/resolution).y;
    outColor.r = ((s1 - s2) + (s3 - s4))/resolution;
    outColor.a = 1.0;
}`

const ortho_camera = new THREE.OrthographicCamera( 0, 1, 1, 0, -1, 1 );
function get_quad(material, segments=2) {
    let quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, segments, segments), material);
    quad.position.z = - 1;
    quad.position.x = 0.5;
    quad.position.y = 0.5;
    return quad;
}
function get_quad_coords(material, x, y, w, h) {
    let quad = new THREE.Mesh(new THREE.PlaneGeometry(w, h, 2, 2), material);
    quad.position.z = - 1;
    quad.position.x = x;
    quad.position.y = y;
    return quad;
}
class FBO {
    constructor(resolution, magFilter=THREE.NearestFilter, format=THREE.RGBAFormat, samples=16, type=THREE.FloatType) {
        this.resolution = resolution;
        this.RT = new THREE.WebGLRenderTarget(resolution, resolution, {
            type: type,
            format: format,
            samples: samples,
            magFilter: magFilter
        });
    }
}
class Shader {
    constructor(vertexText, fragmentText, blendMode=THREE.NoBlending) {
        this.material = new THREE.RawShaderMaterial({
            side: THREE.DoubleSide,
            vertexShader: vertexText,
            fragmentShader: fragmentText,
            blending: blendMode,
            depthTest: false,
            depthWrite: false,
            uniforms: {}
        })
    }
}
const generic_shader = new Shader(genericVertexShader, genericFragmentShader);
const black_shader = new Shader(genericVertexShader, blackFragmentShader);
const white_shader = new Shader(genericVertexShader, whiteFragmentShader);
const sine_shader = new Shader(genericVertexShader, sineFragmentShader);
const black_quad = get_quad(black_shader.material);
function filterTo(target, shader, fbo_inputs={}, other_inputs={}, segments=2, clear=true) {
    for (const [k, v] of Object.entries(fbo_inputs)) {
        shader.material.uniforms[k] = {value: v.RT.texture};
        shader.material.uniforms[k].value.needsUpdate = true;
    }
    for (const [k, v] of Object.entries(other_inputs)) {
        shader.material.uniforms[k] = {value: v};
    }
    shader.material.uniforms.needsUpdate = true;
    shader.material.needsUpdate = true;
    let quad = get_quad(shader.material, segments);
    renderer.setRenderTarget(target.RT);
    renderer.render(black_quad, ortho_camera);
    renderer.render(quad, ortho_camera);
    quad.geometry.dispose();
    //quad.material.dispose();
}
function renderToScreen(fbo) {
    let quad = get_quad(new THREE.MeshBasicMaterial({ map: fbo.RT.texture}))
    renderer.setRenderTarget(null, ortho_camera);
    renderer.render(quad, ortho_camera);
    quad.geometry.dispose();
}
function renderToScreenCoords(fbo, x, y, w, h) {
    renderer.autoClear = false;
    let quad = get_quad_coords(new THREE.MeshBasicMaterial({ map: fbo.RT.texture}), x, y, w, h)
    renderer.setRenderTarget(null, ortho_camera);
    renderer.render(quad, ortho_camera);
    quad.geometry.dispose();
    renderer.autoClear = true;
}
function renderTexToScreen(tex) {
    let quad = get_quad(new THREE.MeshBasicMaterial({ map: tex}))
    renderer.setRenderTarget(null, ortho_camera);
    renderer.render(quad, ortho_camera);
    quad.geometry.dispose();
}

class MultigridPoissonSolver {
    constructor(resolution) {
        this.gridsA = [];
        this.gridsB = [];
        for(let n = resolution; n > 8; n /= 2) {
            this.gridsA.unshift(new FBO(Math.floor(n), THREE.LinearFilter, THREE.RedFormat));
            this.gridsB.unshift(new FBO(Math.floor(n), THREE.LinearFilter, THREE.RedFormat));
        }
        console.log("Created multigrid solver with " + this.gridsA.length + " scales.");
        console.log(this.gridsA);
        this.poisson_shader = new Shader(genericVertexShader, poissonFragmentShader);
    }
    traverse_down(input_fbo, sub_iter=1) {
        for(let i = 0; i < this.gridsA.length; i++) {
            for(let j = 0; j < sub_iter; j++) {
                let source = this.gridsB[i];
                if(j == 0 && i != 0) source = this.gridsB[i-1];
                filterTo(this.gridsA[i],
                    this.poisson_shader,
                    {map_density: input_fbo,
                        map_iter: source},
                    {resolution: source.resolution}
                );
                filterTo(this.gridsB[i],
                    this.poisson_shader,
                    {map_density: input_fbo,
                        map_iter: this.gridsA[i]},
                    {resolution: this.gridsA[i].resolution}
                );
            }
        }
    }
    traverse_up(input_fbo, sub_iter=1) {
        for(let i = this.gridsA.length-1; i >= 0; i--) {
            for(let j = 0; j < sub_iter; j++) {
                let source = this.gridsB[i];
                if(j == 0 && i != this.gridsA.length-1) source = this.gridsB[i+1];
                filterTo(this.gridsA[i],
                    this.poisson_shader,
                    {map_density: input_fbo,
                        map_iter: source},
                    {resolution: source.resolution}
                );
                filterTo(this.gridsB[i],
                    this.poisson_shader,
                    {map_density: input_fbo,
                        map_iter: this.gridsA[i]},
                    {resolution: this.gridsA[i].resolution}
                );
            }
        }
    }
    solve(input_fbo, target_fbo, iter=3) {
        for(let i = 0; i < this.gridsA.length; i++) {
            filterTo(this.gridsA[i], black_shader);
            filterTo(this.gridsB[i], black_shader);
        }

        this.traverse_down(input_fbo, iter);
        
        let q = Math.floor(mouse.x*4.0);
        if(q < 0) q = 0;
        if(q > this.gridsA.length-1) q = this.gridsA.length-1;
        filterTo(target_fbo, generic_shader, {map: this.gridsB[this.gridsB.length-1]});
    }
    solve_coarse_priority(input_fbo, target_fbo) {
        for(let i = 0; i < this.gridsA.length; i++) {
            filterTo(this.gridsA[i], black_shader);
            filterTo(this.gridsB[i], black_shader);
        }

        for(let i = 0; i < this.gridsA.length; i++) {
            let sub_iter = 3;
            sub_iter += 100.0/((i+2)*(i+1))
            for(let j = 0; j < sub_iter; j++) {
                let source = this.gridsB[i];
                if(j == 0 && i != 0) source = this.gridsB[i-1];
                filterTo(this.gridsA[i],
                    this.poisson_shader,
                    {map_density: input_fbo,
                        map_iter: source},
                    {resolution: source.resolution}
                );
                filterTo(this.gridsB[i],
                    this.poisson_shader,
                    {map_density: input_fbo,
                        map_iter: this.gridsA[i]},
                    {resolution: this.gridsA[i].resolution}
                );
            }
        }
        
        let q = Math.floor(mouse.x*4.0);
        if(q < 0) q = 0;
        if(q > this.gridsA.length-1) q = this.gridsA.length-1;
        filterTo(target_fbo, generic_shader, {map: this.gridsB[this.gridsB.length-1]});
    }
}

class Transporter {
    constructor(resolution, pixel_density=3) {
        this.resolution = resolution;
        this.f_displacements = new FBO(resolution+1, THREE.LinearFilter); //
        this.f_transport_uv = new FBO(resolution*pixel_density, THREE.LinearFilter); //
        this.f_densities = new FBO(resolution, THREE.LinearFilter); //
        this.f_lightmap = new FBO(resolution*pixel_density, THREE.LinearFilter);
        this.f_difference = new FBO(resolution, THREE.LinearFilter);
        this.f_tempA = new FBO(resolution, THREE.LinearFilter, THREE.RGFormat);
        this.f_tempB = new FBO(resolution, THREE.LinearFilter, THREE.RedFormat);
        this.f_gradient = new FBO(resolution, THREE.LinearFilter, THREE.RGFormat);
        this.f_divergence = new FBO(resolution, THREE.LinearFilter, THREE.RedFormat);
        this.f_accum = new FBO(resolution, THREE.LinearFilter, THREE.RGFormat);
        this.f_heightmap = new FBO(resolution, THREE.LinearFilter, THREE.RedFormat);

        this.f_viewer = new FBO(resolution, THREE.LinearFilter);
        this.f_viewer2 = new FBO(resolution*pixel_density, THREE.LinearFilter);
        this.f_viewer3 = new FBO(resolution, THREE.LinearFilter);

        this.random_shader = new Shader(genericVertexShader, randomFragmentShader);
        this.density_shader = new Shader(genericVertexShader, densityCalculationFragmentShader);
        this.transport_shader = new Shader(transportVertexShader, transportFragmentShader, THREE.AdditiveBlending);
        this.transport_uv_shader = new Shader(transportVertexShader, transportUVFragmentShader);
        this.subtract_shader = new Shader(genericVertexShader, subtractFragmentShader);
        this.poisson_shader = new Shader(genericVertexShader, poissonFragmentShader);
        this.gradient_shader = new Shader(genericVertexShader, gradientFragmentShader);
        this.accumulate_shader = new Shader(accumulateVertexShader, accumulateFragmentShader);
        this.wireframe_shader = new Shader(transportVertexShader, whiteFragmentShader, THREE.AdditiveBlending);
        this.wireframe_shader.material.wireframe = true;
        this.display_shader = new Shader(genericVertexShader, displayFragmentShader);
        this.divergence_shader = new Shader(genericVertexShader, divergenceFragmentShader);

        this.t_source = new THREE.TextureLoader().load('source.png');
        this.t_target = new THREE.TextureLoader().load('meow.png');

        this.f_target = new FBO(resolution, THREE.LinearFilter);
        
        this.poisson_solver = new MultigridPoissonSolver(this.resolution);
        this.poisson_iter = 10;
    }
    render() {
        //filterTo(this.f_displacements, black_shader, {}, {time: mouse.x});

        filterTo(this.f_densities, 
            this.density_shader,
            {displacements: this.f_displacements},
            {resolution: this.resolution}
        );
        
        filterTo(this.f_lightmap, 
            this.transport_shader,
            {displacements: this.f_displacements,
                densities: this.f_densities},
            {resolution: this.resolution,
                source: this.t_source
            },
            this.resolution
        );
        
        filterTo(this.f_transport_uv, 
            this.transport_uv_shader,
            {displacements: this.f_displacements,
                densities: this.f_densities},
            {resolution: this.resolution},
            this.resolution
        );
        
        filterTo(this.f_viewer2, 
            this.wireframe_shader,
            {displacements: this.f_displacements,
                densities: this.f_densities},
            {resolution: this.resolution},
            this.resolution
        );

        filterTo(this.f_difference,
            this.subtract_shader,
            {B: this.f_lightmap},
            {A: this.t_target}
        );

        this.poisson_solver.solve(this.f_difference, this.f_tempB);
        
        filterTo(this.f_gradient,
            this.gradient_shader,
            {map: this.f_tempB},
            {resolution: this.resolution}
        );

        filterTo(this.f_accum, this.accumulate_shader,
            {map_previous: this.f_displacements,
            map_delta: this.f_gradient,
            uv_tex: this.f_displacements,
            difference: this.f_difference,
            lightmap: this.f_lightmap},
            {resolution: this.resolution,
                time: ii
            }
        );
        ii++;

        filterTo(this.f_displacements, generic_shader, {map: this.f_accum});


        filterTo(this.f_divergence,
            this.divergence_shader,
            {map: this.f_displacements},
            {resolution: this.resolution}
        );
        this.poisson_solver.solve_coarse_priority(this.f_divergence, this.f_heightmap);
        filterTo(this.f_tempA,
            this.gradient_shader,
            {map: this.f_heightmap},
            {resolution: this.resolution}
        );

        //filterTo(this.f_displacements, generic_shader, {map: this.f_tempA});
        

        filterTo(this.f_viewer, sine_shader, {map: this.f_tempA});
        filterTo(this.f_viewer3, sine_shader, {map: this.f_displacements});
        

        //renderToScreen(this.f_transport_uv);
        //renderToScreen(this.f_displacements);
        //renderToScreen(this.f_lightmap);
        renderToScreenCoords(this.f_lightmap, 0.25, 0.75, 0.5, 0.5);
        renderToScreenCoords(this.f_viewer2, 0.25, 0.25, 0.5, 0.5);
        renderToScreenCoords(this.f_viewer, 0.75, 0.25, 0.5, 0.5);
        renderToScreenCoords(this.f_viewer3, 0.75, 0.75, 0.5, 0.5);

        //renderToScreenCoords(this.f_curl, 0.75, 0.75, 0.5, 0.5);
        //renderToScreen(this.f_viewer2);
        //renderToScreen(this.f_difference);
        //renderToScreen(this.f_viewer);
        //renderToScreen(this.f_densities);
        //renderTexToScreen(this.t_source);

        //filterTo(this.f_target, generic_shader, {}, {map: this.t_target});
        //this.poisson_solver.solve(this.f_target, this.f_viewer3);
        //renderToScreen(this.f_viewer3);
    }
}
let ii = 0;

// =============== Application Logic =============== //

let tsp = new Transporter(200);

function update_app() {
    tsp.render();
}

// =============== Scene Setup & Loop =============== //

let window_dims = {x: 0, y: 0};

const mouse = new THREE.Vector2();
document.addEventListener('mousemove', onDocumentMouseMove, false);
function onDocumentMouseMove(event) {
    event.preventDefault();
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
}
(document.getElementById('demo') || document.body).appendChild(renderer.domElement);
renderer.setAnimationLoop(() => {
    if(window.innerWidth != window_dims.x || window.innerHeight != window_dims.y) {
        window_dims = {x: window.innerWidth, y: window.innerHeight};
        renderer.setSize(window.innerWidth, window.innerHeight, false);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setRenderTarget(null);
    }
    update_app();
});