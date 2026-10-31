/* GLSL stays renderer-local. Coordinates use CSS pixels from the top-left.
   Every optical surface samples the SAME freshly rendered framebuffer. */
export const sceneVertex = `
precision mediump float;
attribute vec2 a_position;
uniform vec2 u_view;
uniform vec4 u_rect;
uniform vec4 u_wind; // amplitude px, phase, time seconds, fixed rotation radians
uniform float u_mirror;
varying vec2 v_uv;
varying vec2 v_screen;
void main() {
  v_uv = vec2(mix(a_position.x, 1.0-a_position.x, u_mirror), a_position.y);
  vec2 p = a_position * u_rect.zw;
  float height = 1.0-a_position.y;
  float gust = sin(u_wind.z*0.49+u_wind.y)
    + 0.38*sin(u_wind.z*0.83+u_wind.y*1.7)
    + 0.17*sin(u_wind.z*0.19+u_wind.y*0.6);
  // Quadratic stem bend: bottom is fixed, displacement increases toward the tip.
  p.x += u_wind.x*height*height*gust;
  // Small independent leaflet response; less than 1/8 of the main tip travel.
  p.y += u_wind.x*0.10*height*sin(a_position.y*25.0+u_wind.z*0.68+u_wind.y)
    * abs(a_position.x-0.38);
  vec2 root = vec2(mix(0.38,0.62,u_mirror),0.97)*u_rect.zw;
  float c=cos(u_wind.w), s=sin(u_wind.w);
  p = mat2(c,s,-s,c)*(p-root)+root+u_rect.xy;
  v_screen = p/u_view;
  gl_Position = vec4(v_screen*vec2(2.0,-2.0)+vec2(-1.0,1.0),0.0,1.0);
}`;

export const sceneFragment = `
precision mediump float;
uniform sampler2D u_image;
uniform vec4 u_crop;
uniform vec2 u_view;
uniform vec2 u_finish; // opacity, illumination multiplier
varying vec2 v_uv;
varying vec2 v_screen;
void main() {
  vec4 tex = texture2D(u_image,u_crop.xy+v_uv*u_crop.zw);
  vec3 color = tex.rgb*u_finish.y;
  float veil = (1.0-smoothstep(0.02,0.72,v_screen.x))*0.76;
  if (u_view.x < 896.0) veil = mix(0.64,0.15,smoothstep(0.12,0.95,v_screen.y));
  color = mix(color,vec3(0.93,0.96,0.94),veil);
  gl_FragColor = vec4(color,tex.a*u_finish.x);
}`;

export const screenVertex = `
precision highp float;
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv=a_position;
  gl_Position=vec4(a_position*vec2(2.0,-2.0)+vec2(-1.0,1.0),0.0,1.0);
}`;

export const glassFragment = `
precision highp float;
uniform sampler2D u_scene;
uniform vec2 u_view;
uniform vec4 u_rect;
uniform vec4 u_radiiX; // top-left, top-right, bottom-right, bottom-left
uniform vec4 u_radiiY;
uniform vec4 u_optics; // refraction px, bevel width px, dispersion px, reflection strength
uniform vec2 u_pointer; // normalized pointer, -1 means inactive
uniform float u_surface; // 0 copies scene, 1 draws optical surface
varying vec2 v_uv;

float edgeDistance(vec2 p) {
  vec2 size=u_rect.zw;
  vec2 radius=vec2(0.0), center=vec2(0.0);
  if(p.x<u_radiiX.x && p.y<u_radiiY.x) {
    radius=vec2(u_radiiX.x,u_radiiY.x); center=radius;
  } else if(p.x>size.x-u_radiiX.y && p.y<u_radiiY.y) {
    radius=vec2(u_radiiX.y,u_radiiY.y); center=vec2(size.x-radius.x,radius.y);
  } else if(p.x>size.x-u_radiiX.z && p.y>size.y-u_radiiY.z) {
    radius=vec2(u_radiiX.z,u_radiiY.z); center=size-radius;
  } else if(p.x<u_radiiX.w && p.y>size.y-u_radiiY.w) {
    radius=vec2(u_radiiX.w,u_radiiY.w); center=vec2(radius.x,size.y-radius.y);
  }
  if(radius.x>0.0 && radius.y>0.0)
    return (1.0-length((p-center)/radius))*min(radius.x,radius.y);
  return min(min(p.x,size.x-p.x),min(p.y,size.y-p.y));
}

vec3 sampleScene(vec2 uv) {
  return texture2D(u_scene,vec2(clamp(uv.x,0.001,0.999),1.0-clamp(uv.y,0.001,0.999))).rgb;
}

void main() {
  if(u_surface<0.5) { gl_FragColor=vec4(sampleScene(v_uv),1.0); return; }
  vec2 p=v_uv*u_view-u_rect.xy;
  float d=edgeDistance(p);
  if(d<0.0) discard;
  vec2 normal=normalize(vec2(edgeDistance(p+vec2(0.7,0.0))-edgeDistance(p-vec2(0.7,0.0)),
    edgeDistance(p+vec2(0.0,0.7))-edgeDistance(p-vec2(0.0,0.7)))+vec2(0.00001));
  float bevel=exp(-d/max(u_optics.y,1.0));
  float edgeRamp=smoothstep(0.0,4.0,d);
  vec2 centered=p/u_rect.zw-0.5;
  vec2 offset=normal*u_optics.x*bevel*edgeRamp;
  // Gentle interior lens power, separate from the curved perimeter bevel.
  offset-=centered*u_optics.x*0.38*(1.0-bevel);
  if(u_pointer.x>=0.0) offset+=(u_pointer-0.5)*u_optics.x*0.18*(1.0-bevel);
  vec2 uv=v_uv+offset/u_view;
  vec2 split=normal*u_optics.z*bevel/u_view;
  vec3 color=vec3(sampleScene(uv+split).r,sampleScene(uv).g,sampleScene(uv-split).b);
  float fresnel=pow(bevel,3.0);
  float light=0.5+0.5*dot(normal,normalize(vec2(0.5,0.85)));
  color=mix(color,vec3(0.92,1.0,0.97),fresnel*light*u_optics.w);
  color*=1.0-fresnel*(1.0-light)*0.10;
  gl_FragColor=vec4(color,1.0);
}`;
