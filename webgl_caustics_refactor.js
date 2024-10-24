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
const randomFragmentShader = `#version 300 es
precision mediump float;
in vec2 uv;
out vec4 outColor;
uniform float time;
float rand(vec2 co){
    return sin((co.x + co.y)*10.0) + cos((co.x - co.y)*10.0);
    //return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453)*2.0 - 1.0;
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
    outColor.r = min(outColor.r, 200.0);
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
    //if(abs(outColor.r) < 0.02) outColor.r = 0.0;
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
    outColor.r = (s1 + s2 + s3 + s4)*0.24 + texture(map_density, uv).x; // should be 0.25
    outColor.a = 1.0;
}
`
const sineFragmentShader = `#version 300 es
precision mediump float;
in vec2 uv;
out vec4 outColor;
uniform sampler2D map;
void main() {
    outColor.rgb = sin(texture(map, uv).rgb)*0.5 + vec3(0.5);
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
    outColor.r = resolution*(s1 - s2);
    outColor.g = resolution*(s3 - s4);
    //if(length(outColor.rg) > 0.0) outColor.rg *= 1.0/length(outColor.rg);
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
uniform sampler2D uv_tex;
uniform float resolution;
uniform float time;
float rand(vec2 co){
    return fract(sin(dot(co + vec2(time, 0.0), vec2(12.9898, 78.233))) * 43758.5453)*2.0 - 1.0;
}
void main() {
    vec2 adapted_coords = uv + texture(uv_tex, uv).rg;
    outColor.rgb = texture(map_previous, uv).rgb + 0.000002*texture(map_delta, adapted_coords).rgb;
    outColor.a = 1.0;
}
`
const ortho_camera = new THREE.OrthographicCamera( 0, 1, 1, 0, -1, 1 );
function get_quad(material, segments=2) {
    let quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, segments, segments), material);
    quad.position.z = - 1;
    quad.position.x = 0.5;
    quad.position.y = 0.5;
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
    renderer.render(quad, ortho_camera)
}
function renderTexToScreen(tex) {
    let quad = get_quad(new THREE.MeshBasicMaterial({ map: tex}))
    renderer.setRenderTarget(null, ortho_camera);
    renderer.render(quad, ortho_camera)
}

class Transporter {
    constructor(resolution, pixel_density=4) {
        this.resolution = resolution;
        this.f_displacements = new FBO(resolution+1, THREE.LinearFilter); //
        this.f_transport_uv = new FBO(resolution*pixel_density, THREE.LinearFilter); //
        this.f_densities = new FBO(resolution, THREE.LinearFilter); //
        this.f_lightmap = new FBO(resolution*pixel_density, THREE.LinearFilter);
        this.f_difference = new FBO(resolution, THREE.LinearFilter);
        this.f_tempA = new FBO(resolution, THREE.LinearFilter, THREE.RedFormat);
        this.f_tempB = new FBO(resolution, THREE.LinearFilter, THREE.RedFormat);
        this.f_gradient = new FBO(resolution, THREE.LinearFilter, THREE.RGFormat);
        this.f_accum = new FBO(resolution, THREE.LinearFilter, THREE.RGFormat);

        this.f_viewer = new FBO(resolution, THREE.LinearFilter);

        this.random_shader = new Shader(genericVertexShader, randomFragmentShader);
        this.density_shader = new Shader(genericVertexShader, densityCalculationFragmentShader);
        this.transport_shader = new Shader(transportVertexShader, transportFragmentShader, THREE.AdditiveBlending);
        this.transport_uv_shader = new Shader(transportVertexShader, transportUVFragmentShader);
        this.subtract_shader = new Shader(genericVertexShader, subtractFragmentShader);
        this.poisson_shader = new Shader(genericVertexShader, poissonFragmentShader);
        this.sine_shader = new Shader(genericVertexShader, sineFragmentShader);
        this.gradient_shader = new Shader(genericVertexShader, gradientFragmentShader);
        this.accumulate_shader = new Shader(accumulateVertexShader, accumulateFragmentShader);

        this.t_source = new THREE.TextureLoader().load('source.png');
        this.t_target = new THREE.TextureLoader().load('darkstars.png');
    
        this.poisson_iter = 100;
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
        
        filterTo(this.f_difference,
            this.subtract_shader,
            {B: this.f_lightmap},
            {A: this.t_target}
        );

        filterTo(this.f_tempB, black_shader);

        for(let i = 0; i < this.poisson_iter; i++) {
            filterTo(this.f_tempA,
                this.poisson_shader,
                {map_density: this.f_difference,
                    map_iter: this.f_tempB},
                {resolution: this.resolution}
            )
            filterTo(this.f_tempB,
                this.poisson_shader,
                {map_density: this.f_difference,
                    map_iter: this.f_tempA},
                {resolution: this.resolution}
            )
        }
        
        filterTo(this.f_tempA,
            this.sine_shader,
            {map: this.f_tempB}
        );
        filterTo(this.f_gradient,
            this.gradient_shader,
            {map: this.f_tempB},
            {resolution: this.resolution}
        );

        filterTo(this.f_accum, this.accumulate_shader,
            {map_previous: this.f_displacements,
            map_delta: this.f_gradient,
            uv_tex: this.f_displacements},
            {resolution: this.resolution,
                time: ii
            }
        );
        ii++;

        filterTo(this.f_displacements, generic_shader, {map: this.f_accum});

        filterTo(this.f_viewer, this.sine_shader, {map: this.f_gradient});

        //renderToScreen(this.f_transport_uv);
        //renderToScreen(this.f_displacements);
        renderToScreen(this.f_lightmap);
        //renderToScreen(this.f_viewer);
        //renderToScreen(this.f_densities);
        //renderTexToScreen(this.t_source);
    }
}
let ii = 0;

// =============== Application Logic =============== //

const letter_texture = new THREE.TextureLoader().load('letter.png');

let test_tex = new FBO(500);
let test_tex_2 = new FBO(500);

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