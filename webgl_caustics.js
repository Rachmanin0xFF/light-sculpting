import * as THREE from 'three';

const transportVertexShader = `#version 300 es
in vec4 position;
out vec4 vPosition;
uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
uniform sampler2D map;
uniform float RES;
out vec2 uv;
uniform float time;
void main()	{
    gl_Position = projectionMatrix * modelViewMatrix * position;
    vPosition = gl_Position;

    uv = gl_Position.xy*0.5 + 0.5;

    float dp = 0.01;


    float h0 = texture(map, uv).x;
    
    float h1 = texture(map, uv + vec2(dp, 0)).x;
    float h2 = texture(map, uv + vec2(-dp, 0)).x;

    float h3 = texture(map, uv + vec2(0, dp)).x;
    float h4 = texture(map, uv + vec2(0, -dp)).x;

    vec2 dpos = vec2(h1 - h2, h3 - h4);

    if(uv.x > 0.1 && uv.y > 0.1 && uv.x < 0.9 && uv.y < 0.9)
    gl_Position.xy += dpos*2.4*sin(time);
    
}
`;

const transportFragmentShader = `#version 300 es
precision mediump float;
in vec4 vPosition;
out vec4 outColor;
uniform sampler2D map;
in vec2 uv;
void main() {
    float f = length(dFdx(uv))*length(dFdy(uv))*100000.0;
    if(uv.x < 0.1 || uv.y < 0.1 || uv.x > 0.9 || uv.y > 0.9) f = 0.0;
    outColor = vec4(f, f, f, 1);
}
`;

const renderer = new THREE.WebGLRenderer({antialias: true});
renderer.setSize(800, 800, false);
(document.getElementById('demo') || document.body).appendChild(renderer.domElement);

const screen_scene = new THREE.Scene();
//const screen_camera = new THREE.OrthographicCamera( 0, 1, 1, 0, -1, 1 );
const screen_camera = new THREE.PerspectiveCamera( 27, window.innerWidth / window.innerHeight, 1, 3500 );
screen_camera.position.z = 2;
screen_scene.add( screen_camera );

class Caustic {
    constructor(resolution) {

        // =========== DISPLACEMENT TEXTURE SETUP =========== //

        this.surface_heightmap = new Float32Array(resolution**2);
        function xytoi(x, y) {
            return x + y*resolution;
        }

        for(let i = 0; i < this.surface_heightmap.length; i++) {
            this.surface_heightmap[i] = Math.random()*1.0;
        }
        for(let i = 0; i < 30; i++)
        for(let x = 1; x < resolution-1; x++) for(let y = 1; y < resolution-1; y++) {
            this.surface_heightmap[xytoi(x, y)] = 0.25*(
                this.surface_heightmap[xytoi(x+1, y)] +
                this.surface_heightmap[xytoi(x, y+1)] +
                this.surface_heightmap[xytoi(x-1, y)] +
                this.surface_heightmap[xytoi(x, y-1)]
            );
        }


        console.log(this.surface_heightmap);
        this.dataTexture = new THREE.DataTexture(
            this.surface_heightmap,
            resolution,
            resolution,
            THREE.RedFormat,
            THREE.FloatType);
        this.dataTexture.needsUpdate = true;

        // =========== WAVEFRONT SETUP =========== //

        this.resolution = resolution;

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
        this.material.uniforms.map.value = this.dataTexture;
        this.wavefront = new THREE.Mesh(this.buffer_geom, this.material);

        
        // =========== WAVEFRONT RENDER TARGET SETUP =========== //

        this.RTcam = new THREE.OrthographicCamera( 0, 1, 1, 0, -1, 1 );
        this.RT = new THREE.WebGLRenderTarget(resolution*3, resolution*3);
    }

    render() {
        //renderer.setPixelRatio(1);
        //renderer.setSize(this.resolution, this.resolution, false);
        
        renderer.setRenderTarget(this.RT, this.RTcam);
        renderer.clear();
        renderer.render(this.wavefront, this.RTcam);
        
        this.lightmap_material = new THREE.MeshBasicMaterial({
            map: this.RT.texture
        });
        this.plane = new THREE.PlaneGeometry(1, 1);
        this.lightmap_quad = new THREE.Mesh(this.plane, this.lightmap_material);
        this.lightmap_quad.position.z = - 1;
    }
}

let mouse = new THREE.Vector2();
document.addEventListener('mousemove', onDocumentMouseMove, false);
function onDocumentMouseMove(event) {
    event.preventDefault();
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

var caus = new Caustic(300);

caus.render();
//console.log(caus.RTscene);
//screen_scene.add(caus.wavefront);
screen_scene.add(caus.lightmap_quad);
caus.lightmap_quad.position.x = 0;
caus.lightmap_quad.position.y = 0;
caus.lightmap_quad.position.z = 0;
//-------- ----------
// RENDER
//-------- ----------
renderer.setSize(800, 800, false);
renderer.render(screen_scene, screen_camera);
let window_dims = {x: 0, y: 0};
renderer.setAnimationLoop(() => {
    if(window.innerWidth != window_dims.x || window.innerHeight != window_dims.y) {
        window_dims = {x: window.innerWidth, y: window.innerHeight};
        renderer.setSize(window.innerWidth, window.innerHeight, false);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setRenderTarget(null, screen_camera);

        screen_camera.aspect = window.innerWidth / window.innerHeight;
		screen_camera.updateProjectionMatrix();
    }

    caus.render();

    let r = 10.0;
    screen_camera.position.x = mouse.x*2.0;
    screen_camera.position.y = mouse.y*2.0;
    screen_camera.lookAt(0, 0, 0);
    renderer.setRenderTarget(null, screen_camera);
    renderer.render(screen_scene, screen_camera);
   
    caus.wavefront.material.uniforms.time.value += 0.01;
    caus.wavefront.material.needsUpdate = true;
});