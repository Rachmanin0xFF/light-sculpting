'use strict';

// =============== Vertex Shaders =============== //

/**
 * Fullscreen triangle vertex shader. No vertex attributes needed.
 * Generates clip-space position and UV from gl_VertexID.
 *   ID 0 → (-1, -1), UV (0, 0)
 *   ID 1 → ( 3, -1), UV (2, 0)
 *   ID 2 → (-1,  3), UV (0, 2)
 */
export const fullscreenVert = `#version 300 es
precision mediump float;
out vec2 uv;
void main() {
    float x = float(gl_VertexID & 1) * 2.0;
    float y = float(gl_VertexID >> 1) * 2.0;
    gl_Position = vec4(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
    uv = vec2(x, y);
}
`;

/**
 * Transport vertex shader. Grid vertices in [0,1] are mapped to clip space
 * and displaced by the displacement texture.
 */
export const transportVert = `#version 300 es
precision mediump float;
layout(location = 0) in vec2 position;
uniform sampler2D displacements;
uniform float resolution;
out vec2 uv;
void main() {
    uv = position;
    gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);

    // Map vertex UV to displacement texel center
    // Displacement texture is (resolution+1) x (resolution+1)
    vec2 disp_coord = (uv * (resolution + 1.0) + 0.5) / (resolution + 2.0);
    vec2 samp = texture(displacements, disp_coord).rg;
    gl_Position.xy += samp.xy;
}
`;

// Note: the original used a separate calculateFlowVert that remapped UVs via
// uv = (position*(res+2) - 0.5)/(res+1). That UV remapping is now folded into
// calculateFlowFrag so we can use a standard fullscreen pass.

// =============== Fragment Shaders =============== //

export const copyFrag = `#version 300 es
precision mediump float;
in vec2 uv;
out vec4 outColor;
uniform sampler2D map;
void main() {
    outColor = texture(map, uv);
}
`;

export const blackFrag = `#version 300 es
precision mediump float;
in vec2 uv;
out vec4 outColor;
void main() {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
}
`;

export const densityFrag = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 outColor;
uniform float resolution;
uniform sampler2D displacements;

float tri_area(vec2 v0, vec2 v1, vec2 v2) {
    return 0.5 * abs((v0.x*v1.y + v1.x*v2.y + v2.x*v0.y)
                    - (v0.y*v1.x + v1.y*v2.x + v2.y*v0.x));
}

void main() {
    outColor.a = 1.0;
    float disp_texel_width = 1.0 / (resolution + 1.0);
    vec2 disp_texel_center = gl_FragCoord.xy * disp_texel_width;

    float out_texel_width = 1.0 / resolution;

    vec2 t_00 = texture(displacements, disp_texel_center + vec2(0.0, 0.0) * disp_texel_width).rg;
    vec2 t_10 = texture(displacements, disp_texel_center + vec2(1.0, 0.0) * disp_texel_width).rg;
    vec2 t_11 = texture(displacements, disp_texel_center + vec2(1.0, 1.0) * disp_texel_width).rg;
    vec2 t_01 = texture(displacements, disp_texel_center + vec2(0.0, 1.0) * disp_texel_width).rg;

    vec2 c_00 = t_00 + vec2(-1.0, -1.0) * out_texel_width;
    vec2 c_10 = t_10 + vec2( 1.0, -1.0) * out_texel_width;
    vec2 c_11 = t_11 + vec2( 1.0,  1.0) * out_texel_width;
    vec2 c_01 = t_01 + vec2(-1.0,  1.0) * out_texel_width;

    float nominal_area = out_texel_width * out_texel_width * 4.0;
    float area = tri_area(c_00, c_10, c_11) + tri_area(c_00, c_11, c_01);

    outColor.rgb = vec3(nominal_area / area);
}
`;

export const transportFrag = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 outColor;
uniform sampler2D densities;
uniform sampler2D source;
void main() {
    outColor.r = texture(densities, uv).r * texture(source, uv).r;
    outColor.a = 1.0;
}
`;

export const subtractFrag = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 outColor;
uniform sampler2D A;
uniform sampler2D B;
uniform float targetScale;
void main() {
    float n1 = texture(A, uv).r * targetScale;
    float n2 = texture(B, uv).r;
    outColor.r = n1 - n2;

    float border = 0.04;
    float d = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float mask = smoothstep(0.0, border, d);
    if(mask < 0.99) outColor.r = 0.0;
    outColor.a = 1.0;
}
`;

export const poissonFrag = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 outColor;
uniform float resolution;
uniform sampler2D map_density;
uniform sampler2D map_iter;
void main() {
    // Dirichlet BC: force zero at boundary texels
    float halfTexel = 0.5 / resolution;
    if (uv.x < halfTexel * 1.5 || uv.x > 1.0 - halfTexel * 1.5 ||
        uv.y < halfTexel * 1.5 || uv.y > 1.0 - halfTexel * 1.5) {
        outColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }
    float s1 = texture(map_iter, uv + vec2(0.0,  1.0) / resolution).x;
    float s2 = texture(map_iter, uv + vec2(0.0, -1.0) / resolution).x;
    float s3 = texture(map_iter, uv + vec2( 1.0, 0.0) / resolution).x;
    float s4 = texture(map_iter, uv + vec2(-1.0, 0.0) / resolution).x;
    float invResSq = 1.0 / (resolution * resolution);
    outColor.r = (s1 + s2 + s3 + s4 + texture(map_density, uv).x * invResSq) * 0.25;
    outColor.a = 1.0;
}
`;

// Neumann BC variant: zero-derivative at boundaries (CLAMP_TO_EDGE handles neighbor reflection)
export const poissonNeumannFrag = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 outColor;
uniform float resolution;
uniform sampler2D map_density;
uniform sampler2D map_iter;
void main() {
    float s1 = texture(map_iter, uv + vec2(0.0,  1.0) / resolution).x;
    float s2 = texture(map_iter, uv + vec2(0.0, -1.0) / resolution).x;
    float s3 = texture(map_iter, uv + vec2( 1.0, 0.0) / resolution).x;
    float s4 = texture(map_iter, uv + vec2(-1.0, 0.0) / resolution).x;
    float invResSq = 1.0 / (resolution * resolution);
    outColor.r = (s1 + s2 + s3 + s4 + texture(map_density, uv).x * invResSq) * 0.25;
    outColor.a = 1.0;
}
`;

export const gradientFrag = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 outColor;
uniform float resolution;
uniform sampler2D map;
void main() {
    float s1 = texture(map, uv + vec2( 1.0, 0.0) / resolution).x;
    float s2 = texture(map, uv + vec2(-1.0, 0.0) / resolution).x;
    float s3 = texture(map, uv + vec2(0.0,  1.0) / resolution).x;
    float s4 = texture(map, uv + vec2(0.0, -1.0) / resolution).x;
    outColor.r = (s1 - s2) * resolution;
    outColor.g = (s3 - s4) * resolution;
    outColor.a = 1.0;
}
`;

export const calculateFlowFrag = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 outColor;
uniform sampler2D map_delta;
uniform sampler2D uv_tex;
uniform float resolution;
void main() {
    // Remap UV to cover the (res+1) displacement texture coordinate space
    // (original code did this in the vertex shader)
    vec2 remapped_uv = (uv * (resolution + 2.0) - 0.5) / (resolution + 1.0);

    // disp_coord = (remapped_uv * (res+1) + 0.5) / (res+2) simplifies to just uv
    // (the vertex→fragment transforms cancel out)
    // Sample displacement at remapped coord, offset by half displacement (semi-Lagrangian)
    vec2 adapted_coords = uv + texture(uv_tex, remapped_uv).rg * 0.5;
    outColor.rgb = texture(map_delta, adapted_coords).rgb / resolution;
    outColor.a = 1.0;
}
`;

export const addMultFrag = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 outColor;
uniform sampler2D A;
uniform sampler2D B;
uniform float stepSize;
uniform float resolution;
void main() {
    // Pin boundary vertices: smooth falloff over ~2 vertices from each edge
    float border = 2.0 / resolution;
    float d = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float mask = smoothstep(0.0, border, d);
    outColor.rgb = (texture(A, uv).rgb + texture(B, uv).rgb * stepSize) * mask;
    outColor.a = 1.0;
}
`;

export const divergenceFrag = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 outColor;
uniform float resolution;
uniform sampler2D map;
void main() {
    float s1 = texture(map, uv + vec2( 1.0, 0.0) / resolution).x;
    float s2 = texture(map, uv + vec2(-1.0, 0.0) / resolution).x;
    float s3 = texture(map, uv + vec2(0.0,  1.0) / resolution).y;
    float s4 = texture(map, uv + vec2(0.0, -1.0) / resolution).y;
    outColor.r = -((s1 - s2) + (s3 - s4)) / resolution;
    outColor.a = 1.0;
}
`;

// =============== Display / Visualization Shaders =============== //

export const displayFrag = `#version 300 es
precision mediump float;
in vec2 uv;
out vec4 outColor;
uniform sampler2D map;
uniform float gain;
void main() {
    outColor.rgb = vec3(texture(map, uv).r * gain);
    outColor.a = 1.0;
}
`;

export const tonemapFrag = `#version 300 es
precision mediump float;
in vec2 uv;
out vec4 outColor;
uniform sampler2D map;
uniform float exposure;
void main() {
    float v = texture(map, uv).r * exposure;
    outColor.rgb = vec3(v / (1.0 + v));
    outColor.a = 1.0;
}
`;

export const diffVizFrag = `#version 300 es
precision mediump float;
in vec2 uv;
out vec4 outColor;
uniform sampler2D map;
uniform float gain;
void main() {
    float v = texture(map, uv).r * gain;
    float pos = max(v, 0.0);
    float neg = max(-v, 0.0);
    outColor = vec4(pos, 0.0, neg, 1.0);
    outColor.g = 0.1 + 0.2*sin(100.0 * v);
}
`;

export const displacementVizFrag = `#version 300 es
precision mediump float;
in vec2 uv;
out vec4 outColor;
uniform sampler2D map;
void main() {
    vec3 t = texture(map, uv).rgb;
    outColor.rgb = -cos(400.4 * t) * 0.5 + vec3(0.5);
    if (t.x < 0.0) outColor.b = 1.0;
    outColor.a = 1.0;
}
`;
