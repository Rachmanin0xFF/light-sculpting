final int RES = 256;
final int LRES = 256;
float[][] h = new float[RES][RES];
PVector[][] displacements = new PVector[RES-1][RES-1];
PGraphics lightmap;
float dx = 0.1;
PImage p;
void setup() {
  p = loadImage("niceplants.png");
  size(512, 512, P2D);
  
  lightmap = createGraphics(LRES, LRES, P2D);
  lightmap.smooth(16);
  
  for(int x = 0; x < RES; x++) for(int y = 0; y < RES; y++) {
    h[x][y] = red(p.get(x,y))/255.0;
  }
  for(int i = 0; i < 10; i++)
  for(int x = 1; x < RES-1; x++) for(int y = 1; y < RES-1; y++) {
    h[x][y] = 0.25*(h[x+1][y] + h[x][y+1] + h[x-1][y] + h[x][y-1]);
  }
  area(0, 0, 0, 0, 0, 0, 0, 0);
}

float area(float x0, float y0, float x1, float y1, float x2, float y2, float x3, float y3) {
  return 0.5*abs((x0*y1 + x1*y2 + x2*y3 + x3*y0) - (y0*x1 + y1*x2 + y2*x3 + y3*x0));
}
float area(float x0, float y0, float x1, float y1, float x2, float y2) {
  return 0.5*abs((x0*y1 + x1*y2 + x2*y0) - (y0*x1 + y1*x2 + y2*x0));
}
void quad_light(float x0, float y0, float x1, float y1, float x2, float y2, float x3, float y3, float r, float g, float b) {
  float A = area(x0, y0, x1, y1, x2, y2) + area(x2, y2, x3, y3, x0, y0);
  A = max(A, 0.25);
  lightmap.fill(r, g, b, 56.0 / A);
  lightmap.triangle(x0, y0, x1, y1, x2, y2);
  lightmap.triangle(x2, y2, x3, y3, x0, y0);
}

void render_lightmap(float[][] heightmap) {
  lightmap.beginDraw();
  lightmap.background(0);
  lightmap.blendMode(ADD);
  for(int x = 0; x < RES-1; x++) for(int y = 0; y < RES-1; y++) {
    float h0 = heightmap[x][y];
    float h1 = heightmap[x+1][y];
    float h2 = heightmap[x+1][y+1];
    float h3 = heightmap[x][y+1];
    displacements[x][y] = new PVector((h1 - h0 + h2 - h3)*0.5/dx, (h2 - h1 + h3 - h0)*0.5/dx);
  }
  float dpth = mouseX;
  float s = 1.0;
  for(int x = 0; x < RES-2; x++) for(int y = 0; y < RES-2; y++) {
    quad_light(x*s + displacements[x][y].x*dpth, y*s + displacements[x][y].y*dpth,
              (x+1)*s + displacements[x+1][y].x*dpth, y*s + displacements[x+1][y].y*dpth,
              (x+1)*s + displacements[x+1][y+1].x*dpth, (y+1)*s + displacements[x+1][y+1].y*dpth,
              x*s + displacements[x][y+1].x*dpth, (y+1)*s + displacements[x][y+1].y*dpth, 255, 255, 255);
  }
  lightmap.blendMode(BLEND);
  lightmap.endDraw();
}

void draw() {
  background(0);
  render_lightmap(h);
  image(lightmap, 0, 0, width, height);
}
