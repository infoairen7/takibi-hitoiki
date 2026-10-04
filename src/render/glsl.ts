/** シェーダー共通のノイズ関数 */
export const GLSL_NOISE = /* glsl */ `
float gb_hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float gb_hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 gb_hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float gb_vnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = gb_hash13(i);
  float b = gb_hash13(i + vec3(1.0, 0.0, 0.0));
  float c = gb_hash13(i + vec3(0.0, 1.0, 0.0));
  float d = gb_hash13(i + vec3(1.0, 1.0, 0.0));
  float e = gb_hash13(i + vec3(0.0, 0.0, 1.0));
  float g = gb_hash13(i + vec3(1.0, 0.0, 1.0));
  float h = gb_hash13(i + vec3(0.0, 1.0, 1.0));
  float k = gb_hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}
float gb_vnoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = gb_hash12(i);
  float b = gb_hash12(i + vec2(1.0, 0.0));
  float c = gb_hash12(i + vec2(0.0, 1.0));
  float d = gb_hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float gb_fbm3(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int k = 0; k < 3; k++) {
    s += a * gb_vnoise3(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s / 0.875;
}
float gb_fbm2(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int k = 0; k < 4; k++) {
    s += a * gb_vnoise2(p);
    p = p * 2.02 + vec2(3.1, 1.7);
    a *= 0.5;
  }
  return s / 0.9375;
}
// 胞状ノイズ：x=最近点との距離, y=2番目
vec2 gb_cell2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 r = o + gb_hash22(i + o) - f;
      float d = dot(r, r);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
  }
  return vec2(sqrt(f1), sqrt(f2));
}
`;
