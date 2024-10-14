import * as THREE from 'three';

function createScene() {
    const scene = new THREE.Scene();
    scene.add( new THREE.GridHelper(10, 10) );
    const camera = new THREE.PerspectiveCamera(50, 4 / 3, 0.5, 1000);
    const renderer = new THREE.WebGL1Renderer();
    renderer.setSize(800, 800, false);
    (document.getElementById('demo') || document.body).appendChild(renderer.domElement);
}

class Caustic {
    constructor(resolution) {
        this.resolution = resolution;
        this.surface_heightmap = Array(resolution**2);

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
        this.material = new THREE.MeshBasicMaterial({
            side: THREE.DoubleSide,
            wireframe: true
        });
        this.wavefront = new THREE.Mesh(this.buffer_geom, this.material);
    }
}

createScene();

let caus = new Caustic(10);
scene.add(caus.wavefront);
camera.lookAt(caus.wavefront.position)
//-------- ----------
// RENDER
//-------- ----------
camera.position.set(0, 1, 3);
camera.lookAt( 0, 0.5, 0 );
renderer.render(scene, camera);