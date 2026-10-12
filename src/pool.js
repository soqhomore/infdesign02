// 위에서 내려다본 도트 수조 (WebGL 프래그먼트 셰이더) + 접속자 개복치들
// 1) 낮은 해상도로 물 표면·바닥·물빛(caustics)·반사광을 계산하고
// 2) 참고 이미지에서 뽑은 14색 팔레트 + 바이어 디더링으로 줄인 뒤
// 3) CSS image-rendering: pixelated 로 확대해서 도트 그림처럼 보이게 한다.
// 개복치는 셰이더 안에서 그려서 물과 같은 도트 격자에 맞는다. 이름표·말풍선은 DOM.
// 바깥에 내보내는 함수(addFish 등)는 sunfish.js와 같은 모양이라 game.js를 그대로 쓸 수 있다.

// 참고 이미지(김 서린 파란 수영장)에서 뽑은 색 + 하이라이트 + 개복치 볼터치용 분홍 두 색
const PALETTE = [
  '#020f33', '#021d55', '#022b74', '#013a91', '#004fa9', '#0464c4', '#0178da',
  '#0a8fe8', '#00a9fa', '#00c3fc', '#4fd6ff', '#9ae6ff', '#d8f6ff', '#ffffff',
  '#e9799a', '#ffb3c6',
]
// 밤: 어두운 남색 단계 + 달빛 하이라이트 + 개복치 빛무리용 은은한 색 몇 개
const PALETTE_NIGHT = [
  '#00040f', '#010a1f', '#03122f', '#061b40', '#0a2552', '#0e3166', '#123f7a', '#1a5290',
  '#2468a6', '#3a85bf', '#5aa5d6', '#8cc6ea', '#c4e4f7', '#ffffff',
  '#4a3a8f', '#2f7f86', '#8a4f8c', '#a08a4a',
]
// 셰이더 배열 크기를 맞추려고 짧은 쪽은 마지막 색으로 채움
const PAL_N = Math.max(PALETTE.length, PALETTE_NIGHT.length)
const padPal = (p) => [...p, ...Array(PAL_N - p.length).fill(p[p.length - 1])]
// 개복치 스프라이트: 원본은 도트 1칸이 약 8.5px로 확대된 그림 → 원래 도트 크기로 되돌려서 씀
// 0, 1: 헤엄 / 2: 눈 깜빡 / 3: 입 벌림(말할 때) / 4: 정면(돌아설 때) / 5: 뒤집힘(기절) / 6: 누움(지쳐서 쉼)
const FISH_FRAMES = [
  '/fish/fish-left01.png', '/fish/fish-left02.png', '/fish/fish-left-eyesclosed.png',
  '/fish/fish-left-mouthopen.png', '/fish/fish-middle.png', '/fish/fish-back-upsidedown.png',
  '/fish/fish-laying.png',
]
const F = { swim1: 0, swim2: 1, blink: 2, talk: 3, front: 4, faint: 5, lay: 6 }
const MAX_FISH = 16
const FISH_ART_PX = 8.5
const MAX_RIPPLES = 8

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uLight;       // 해(빛) 방향
uniform float uDither;
uniform float uQuant;      // 1 = 팔레트로 줄이기
uniform vec3 uPal[${PAL_N}];
uniform vec3 uPalNight[${PAL_N}];
uniform float uNight;      // 0 낮 ~ 1 밤 (부드럽게 바뀜)
uniform vec4 uRip[${MAX_RIPPLES}]; // 물결: x, y, 시작 시각, 세기
uniform sampler2D uFish;   // 개복치 프레임들을 가로로 이어 붙인 그림
uniform vec2 uFishCell;    // 한 프레임 칸 크기 (픽셀)
uniform float uFishFrames;
uniform float uFishCount;
uniform vec4 uFishA[${MAX_FISH}]; // 칸 왼쪽 위 x, y (저해상도 픽셀), 프레임, 좌우반전
uniform float uFishHue[${MAX_FISH}]; // 접속자마다 다른 색 (색상 회전, 라디안)

// 회색 축을 중심으로 색상 돌리기
vec3 hueRotate(vec3 c, float a) {
  vec3 k = vec3(0.57735);
  float ca = cos(a), sa = sin(a);
  return c * ca + cross(k, c) * sa + k * dot(k, c) * (1.0 - ca);
}

// 저해상도 픽셀 위치 px에 있는 개복치 색 (여럿 겹치면 나중 것이 위). 도트 1칸 = 화면 도트 1칸
vec4 fishAt(vec2 px, out float hue) {
  vec4 hit = vec4(0.0);
  hue = 0.0;
  for (int i = 0; i < ${MAX_FISH}; i++) {
    if (float(i) >= uFishCount) break;
    vec4 a = uFishA[i];
    vec2 local = (floor(px) - a.xy + 0.5) / uFishCell;
    if (local.x < 0.0 || local.y < 0.0 || local.x > 1.0 || local.y > 1.0) continue;
    if (a.w > 0.5) local.x = 1.0 - local.x;
    vec4 c = texture2D(uFish, vec2((a.z + local.x) / uFishFrames, local.y));
    if (c.a > 0.5) { hit = c; hue = uFishHue[i]; }
  }
  return hit;
}

// 밤에 개복치 주변이 은은하게 빛나도록: 각 개복치 중심에서 퍼지는 빛 (개복치 색 따라)
vec3 fishGlow(vec2 px) {
  vec3 g = vec3(0.0);
  for (int i = 0; i < ${MAX_FISH}; i++) {
    if (float(i) >= uFishCount) break;
    vec2 center = uFishA[i].xy + uFishCell * 0.5;
    float d = length(floor(px) + 0.5 - center) / (uFishCell.x * 0.95);
    g += hueRotate(vec3(0.42, 0.8, 1.0), uFishHue[i]) * exp(-d * d * 2.2);
  }
  return g;
}

// ---------- 노이즈 ----------
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 hash2(vec2 p) {
  return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; }
  return v;
}

// 움직이는 보로노이: x = 가장 가까운 점까지, y = 두 번째 점까지 거리, zw = 가장 가까운 칸 중심
vec4 voronoi(vec2 p, float t) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  vec2 c1 = vec2(0.0);
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = hash2(i + g);
    o = 0.5 + 0.38 * sin(t + 6.2831 * o);
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; c1 = i + g + o; }
    else if (d < d2) { d2 = d; }
  }
  return vec4(sqrt(d1), sqrt(d2), c1);
}

// ---------- 물 표면 높이 ----------
float waterHeight(vec2 p, float t) {
  float h = 0.0;
  h += sin(dot(p, vec2(0.8, 0.6)) * 9.0 + t * 1.3) * 0.22;
  h += sin(dot(p, vec2(-0.5, 0.9)) * 13.0 + t * 1.7) * 0.16;
  h += sin(dot(p, vec2(0.95, -0.3)) * 21.0 - t * 2.1) * 0.09;
  h += (fbm(p * 5.0 + vec2(t * 0.22, -t * 0.16)) - 0.5) * 1.1;
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    vec4 r = uRip[i];
    float age = t - r.z;
    if (r.w <= 0.0 || age < 0.0 || age > 5.0) continue;
    float d = length(p - r.xy);
    float k = d - age * 0.32;
    h += r.w * sin(k * 70.0) * exp(-k * k * 90.0) * exp(-age * 0.8) / (1.0 + d * 6.0);
  }
  return h;
}

// 물빛 계산용: 잔물결(고주파)을 뺀 부드러운 표면. 이 표면이 빛을 모으는 곳이 밝은 무늬가 된다.
float fbm3(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; }
  return v;
}
float swell(vec2 p, float t) {
  float h = 0.0;
  h += sin(dot(p, vec2(0.8, 0.6)) * 6.5 + t * 0.9) * 0.05;
  h += sin(dot(p, vec2(-0.6, 0.8)) * 8.5 + t * 1.2) * 0.04;
  h += sin(dot(p, vec2(0.3, -0.95)) * 11.0 - t * 1.0) * 0.03;
  h += (fbm3(p * 4.0 + vec2(t * 0.25, -t * 0.2)) - 0.5) * 0.18;
  return h;
}

// 굴절된 빛이 바닥에 모이는 정도 = 1 / |det(I + k·Hessian(h))|
float caustics(vec2 p, float t, float k) {
  float e = 0.011; // 간격을 넓혀 곡률을 부드럽게 → 십자 모양 튐 방지
  float h0 = swell(p, t);
  float hxp = swell(p + vec2(e, 0.0), t), hxm = swell(p - vec2(e, 0.0), t);
  float hyp = swell(p + vec2(0.0, e), t), hym = swell(p - vec2(0.0, e), t);
  float hpp = swell(p + vec2(e, e), t), hpm = swell(p + vec2(e, -e), t);
  float hmp = swell(p + vec2(-e, e), t), hmm = swell(p + vec2(-e, -e), t);
  float hxx = (hxp - 2.0 * h0 + hxm) / (e * e);
  float hyy = (hyp - 2.0 * h0 + hym) / (e * e);
  float hxy = (hpp - hpm - hmp + hmm) / (4.0 * e * e);
  float det = (1.0 + k * hxx) * (1.0 + k * hyy) - k * k * hxy * hxy;
  return 1.0 / max(abs(det), 0.3);
}

// ---------- 수조 바닥 깊이 (0 얕음 ~ 1 깊음) ----------
float depthAt(vec2 uv, float t) {
  float x = uv.x, y = uv.y;
  // 맨 위: 깊은 구역 경계 (살짝 일렁임)
  float topEdge = 0.19 + 0.012 * sin(x * 31.0 + t * 0.3) + 0.02 * (noise(vec2(x * 11.0, t * 0.08)) - 0.5);
  // 가운데: 밝은 얕은 구역의 들쭉날쭉한 윗선 (산맥처럼)
  float ridge = 1.0 - abs(2.0 * noise(vec2(x * 7.0 + 3.0, 1.7)) - 1.0);
  float crest = 0.47 - 0.09 * ridge - 0.03 * noise(vec2(x * 23.0, t * 0.12)) + 0.012 * sin(x * 50.0 + t * 0.7);
  // 아래: 수조 턱
  float rim = 0.87 + 0.004 * sin(x * 37.0 + t * 0.9);

  float d = 1.0;
  d = mix(d, 0.74, smoothstep(topEdge - 0.012, topEdge + 0.012, y));
  d = mix(d, 0.2, smoothstep(crest - 0.02, crest + 0.035, y));
  d = mix(d, 0.06, smoothstep(rim - 0.002, rim + 0.002, y));
  // 왼쪽 벽 그림자
  d = max(d, 0.9 * (1.0 - smoothstep(0.0, 0.06, x)) * step(y, rim));
  return d;
}

// 2x2 → 4x4 바이어 행렬 값 (0~1)
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 uv = frag / uRes;                       // 0~1, 위가 0
  float aspect = uRes.x / uRes.y;
  vec2 p = vec2(uv.x * aspect, uv.y);          // 가로세로 같은 비율 좌표
  float t = uTime;

  // 표면 법선
  float e = 1.0 / uRes.y;
  float h0 = waterHeight(p, t);
  float hx = waterHeight(p + vec2(e, 0.0), t) - h0;
  float hy = waterHeight(p + vec2(0.0, e), t) - h0;
  vec3 N = normalize(vec3(-hx / e * 0.018, -hy / e * 0.018, 1.0));
  vec3 L = normalize(uLight);

  float d = depthAt(uv, t);

  // 굴절: 깊을수록 바닥이 더 많이 일렁여 보임 (과하면 바닥이 울퉁불퉁해 보여서 약하게)
  vec2 fuv = uv + N.xy * (0.004 + 0.01 * d);
  vec2 fp = vec2(fuv.x * aspect, fuv.y);
  float fd = depthAt(fuv, t);

  // ---------- 바닥 ----------
  vec3 albedo = vec3(0.62, 0.86, 1.0);
  vec3 fN = vec3(0.0, 0.0, 1.0);

  // 수조 턱 (아래): 밝은 타일 + 경계 그림자/하이라이트
  float rimY = 0.87 + 0.004 * sin(fuv.x * 37.0 + t * 0.9);
  float rimShadow = smoothstep(0.018, 0.0, abs(fuv.y - (rimY - 0.008)));
  float rimLight = smoothstep(0.005, 0.0, abs(fuv.y - (rimY + 0.006)));
  if (fuv.y > rimY) albedo = vec3(0.7, 0.9, 1.0);

  float lambert = 0.35 + 0.65 * max(dot(fN, L), 0.0);
  vec3 floorCol = albedo * lambert;
  floorCol *= 1.0 - 0.55 * rimShadow;

  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);

  // ---------- 물빛 (caustics): 일렁이는 보로노이 경계선 두 겹 ----------
  // 깊을수록 빛이 모이는 거리가 길어져 무늬가 더 촘촘·강하게 접힘
  float k = 0.03 + 0.025 * fd;
  float caus = caustics(fp + L.xy * 0.02 * fd, t, k);
  caus = smoothstep(1.1, 2.4, caus); // 0~1 띠 모양으로 정리
  // 물빛이 고르게 깔리지 않고 뭉쳐 보이게
  caus *= 0.55 + 0.9 * fbm3(fp * 2.5 + vec2(t * 0.05, 0.0));

  // ---------- 물 색 (깊이에 따라 흡수) ----------
  float n = uNight;
  vec3 shallow = mix(vec3(0.05, 0.66, 1.0), vec3(0.03, 0.22, 0.42), n);
  vec3 mid = mix(vec3(0.0, 0.26, 0.7), vec3(0.01, 0.1, 0.27), n);
  vec3 deep = mix(vec3(0.0, 0.09, 0.32), vec3(0.0, 0.025, 0.1), n);
  vec3 tint = mix(shallow, mid, smoothstep(0.2, 0.55, fd));
  tint = mix(tint, deep, smoothstep(0.7, 1.0, fd));

  vec3 col = floorCol * tint * 1.3;
  // 물빛: 밤에는 희미한 달빛
  vec3 causCol = mix(vec3(0.45, 0.85, 1.0), vec3(0.5, 0.7, 1.0), n);
  col += causCol * caus * (0.04 + 0.96 * pow(1.0 - fd, 2.2)) * mix(0.55, 0.2, n);

  // 밤: 물속에 떠다니는 작은 빛 알갱이가 가끔 반짝
  float speck = hash(floor(px / 3.0) + floor(t * 0.2) * 7.0);
  col += vec3(0.5, 0.9, 1.0) * step(0.995, speck) * (0.5 + 0.5 * sin(t * 4.0 + speck * 90.0)) * n * 0.7;

  // 밤: 개복치 주변 빛무리 (팔레트·디더링을 거쳐 도트로 번짐)
  col += fishGlow(px) * n * 0.5;

  // ---------- 개복치 (물 표면 바로 아래) ----------
  // 표면 일렁임은 개복치 전체를 1픽셀씩 흔들어서 표현 (JS에서) → 윤곽이 깨지지 않음
  float fishHue;
  vec4 fish = fishAt(px, fishHue);
  float isFish = step(0.5, fish.a);
  vec3 fishCol = vec3(0.0);
  if (fish.a > 0.5) {
    float lum = dot(fish.rgb, vec3(0.3, 0.59, 0.11));
    fishCol = hueRotate(fish.rgb, fishHue) * (0.92 + 0.15 * max(L.z, 0.0));
    fishCol = mix(fishCol, fishCol * vec3(0.85, 0.97, 1.08), 0.5); // 물속이라 아주 살짝 푸르게
    fishCol += vec3(0.45, 0.85, 1.0) * caus * 0.1 * step(0.35, lum); // 밝은 몸 위로만 물빛
    fishCol *= mix(1.0, 0.92, n);
    if (lum < 0.36) fishCol = vec3(0.008, 0.06, 0.2); // 테두리는 또렷하게
    col = fishCol;
  }

  // 깊은 띠의 빛줄기
  float band = smoothstep(0.17, 0.25, uv.y) * (1.0 - smoothstep(0.35, 0.5, uv.y));
  float streak = pow(noise(vec2(uv.x * 38.0 + uv.y * 9.0, t * 0.25)), 5.0);
  col += vec3(0.3, 0.6, 1.0) * streak * band * mix(0.6, 0.15, n);

  // 수조 턱 하이라이트
  col += vec3(0.6, 0.9, 1.0) * rimLight * mix(0.5, 0.25, n);

  // ---------- 표면: 하늘 반사 + 반짝임 ----------
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float nh = max(dot(N, H), 0.0);
  col += mix(vec3(0.08, 0.22, 0.5), vec3(0.02, 0.05, 0.14), n) * (1.0 - N.z) * 6.0;
  col += vec3(0.5, 0.8, 1.0) * pow(nh, 30.0) * mix(0.18, 0.08, n);
  float glint = smoothstep(0.5, 0.85, pow(nh, 120.0));
  glint *= 0.5 + 0.5 * smoothstep(0.5, 0.9, d) + 0.4 * smoothstep(0.55, 1.0, uv.x);
  col += vec3(1.0) * glint;

  // 가장자리 살짝 어둡게
  col *= 1.0 - mix(0.25, 0.45, n) * pow(length(uv - 0.5) * 1.2, 2.5);

  // ---------- 도트화: 디더링 + 팔레트 ----------
  if (uQuant > 0.5) {
    vec3 c = col + (bayer4(gl_FragCoord.xy) - 0.5) * uDither * 0.11 * (1.0 - isFish); // 개복치는 디더 없이 깔끔하게
    vec3 best = vec3(0.0);
    float bd = 1e9;
    for (int i = 0; i < ${PAL_N}; i++) {
      vec3 pc = n > 0.5 ? uPalNight[i] : uPal[i];
      vec3 q = c - pc;
      float dd = dot(q * vec3(0.8, 1.0, 0.6), q); // 사람 눈에 맞춘 가중치
      if (dd < bd) { bd = dd; best = pc; }
    }
    col = best;
  }
  // 개복치는 팔레트로 줄이지 않음 (접속자마다 다른 색이 살아 있게)
  if (isFish > 0.5) col = fishCol;
  gl_FragColor = vec4(col, 1.0);
}
`

// ---------- WebGL 준비 ----------
const canvas = document.querySelector('#pool')
const gl = canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: false })
if (!gl) {
  document.body.insertAdjacentHTML('beforeend', '<p style="color:#fff;padding:20px">이 브라우저는 WebGL을 지원하지 않아요.</p>')
  throw new Error('WebGL unavailable')
}

function compile(type, src) {
  const s = gl.createShader(type)
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s))
  return s
}
const prog = gl.createProgram()
gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT))
gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG))
gl.linkProgram(prog)
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog))
gl.useProgram(prog)

gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
const aPos = gl.getAttribLocation(prog, 'aPos')
gl.enableVertexAttribArray(aPos)
gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)


const U = {}
for (const name of ['uRes', 'uTime', 'uLight', 'uDither', 'uQuant', 'uPal', 'uRip',
  'uFish', 'uFishCell', 'uFishFrames', 'uFishCount', 'uFishA', 'uFishHue', 'uNight', 'uPalNight']) {
  U[name] = gl.getUniformLocation(prog, name)
}
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
gl.uniform3fv(U.uPal, padPal(PALETTE).flatMap(rgbOf))
gl.uniform3fv(U.uPalNight, padPal(PALETTE_NIGHT).flatMap(rgbOf))

// ---------- 밤 ----------
let night = 0
let nightTarget = 0
// instant: 처음 열 때는 낮→밤으로 서서히 바뀌는 걸 보여 줄 필요가 없으니 바로
export function setNight(on, instant = false) {
  nightTarget = on ? 1 : 0
  if (instant) night = nightTarget
}

// ---------- 물 설정 (설정 카드 안의 입력들) ----------
const $ = (id) => document.getElementById(id)
const ui = { px: $('px'), speed: $('speed'), dither: $('dither'), pal: $('pal'), light: $('light') }

function resize() {
  const px = Number(ui.px.value)
  canvas.width = Math.max(1, Math.floor(innerWidth / px))
  canvas.height = Math.max(1, Math.floor(innerHeight / px))
  gl.viewport(0, 0, canvas.width, canvas.height)
}
addEventListener('resize', resize)
ui.px.addEventListener('input', resize)
resize()

// ---------- 빛 방향 + 물결 ----------
let light = [0.45, -0.55, 0.7] // 오른쪽 위에서 비추는 해
let lightTarget = [...light]
addEventListener('pointermove', (e) => {
  if (!ui.light.checked) return
  const x = (e.clientX / innerWidth) * 2 - 1
  const y = (e.clientY / innerHeight) * 2 - 1
  lightTarget = [x * 0.9, y * 0.9, 0.6]
})

const ripples = new Float32Array(MAX_RIPPLES * 4)
let rippleIndex = 0
let simTime = 0
canvas.addEventListener('pointerdown', (e) => {
  const aspect = innerWidth / innerHeight
  ripples.set([(e.clientX / innerWidth) * aspect, e.clientY / innerHeight, simTime, 0.6], rippleIndex * 4)
  rippleIndex = (rippleIndex + 1) % MAX_RIPPLES
  lookAtViewer(e.clientX / innerWidth, e.clientY / innerHeight)
})

// 수면을 톡 치면 개복치들이 정면(보는 사람 쪽)을 쳐다본다. 물결이 닿는 순서대로 가까운 개복치부터
const LOOK_MS = 1500
function lookAtViewer(x, y) {
  const now = performance.now()
  const t = Date.now() / 1000
  const aspect = innerWidth / innerHeight
  for (const f of fishes.values()) {
    if (f.fainted || isResting(f, t)) continue // 지쳐서 쉬는 중엔 반응 안 함
    const [fx, fy] = pathAt(f.seeds, t)
    const delay = Math.hypot((fx - x) * aspect, fy - y) * 700
    f.lookFrom = now + delay
    f.lookUntil = now + delay + LOOK_MS
  }
}

// ---------- 개복치 스프라이트 ----------
// 프레임들을 원래 도트 크기로 줄여서 가로로 이어 붙인 텍스처를 만든다
let cell = [0, 0]
let atlasReady = false
Promise.all(FISH_FRAMES.map((src) => new Promise((ok, fail) => {
  const img = new Image()
  img.onload = () => ok(img)
  img.onerror = fail
  img.src = src
}))).then((imgs) => {
  const sizes = imgs.map((im) => [Math.round(im.width / FISH_ART_PX), Math.round(im.height / FISH_ART_PX)])
  const cw = Math.max(...sizes.map((s) => s[0])) + 2
  const ch = Math.max(...sizes.map((s) => s[1])) + 2
  const atlas = document.createElement('canvas')
  atlas.width = cw * imgs.length
  atlas.height = ch
  const ctx = atlas.getContext('2d')
  // 원본 도트 한 칸의 가운데 색을 그대로 집어 오기 (평균 내면 색이 뭉개짐)
  imgs.forEach((im, i) => {
    const [w, h] = sizes[i]
    const src = document.createElement('canvas')
    src.width = im.width
    src.height = im.height
    const sctx = src.getContext('2d')
    sctx.drawImage(im, 0, 0)
    const sd = sctx.getImageData(0, 0, im.width, im.height).data
    const out = ctx.createImageData(w, h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = Math.min(im.width - 1, Math.floor((x + 0.5) * im.width / w))
        const sy = Math.min(im.height - 1, Math.floor((y + 0.5) * im.height / h))
        out.data.set(sd.subarray((sy * im.width + sx) * 4, (sy * im.width + sx) * 4 + 4), (y * w + x) * 4)
      }
    }
    // 가운데 정렬
    ctx.putImageData(out, i * cw + Math.floor((cw - w) / 2), Math.floor((ch - h) / 2))
  })
  // 반투명 가장자리를 없애고, 바깥에 1도트 테두리를 둘러서 물속에서도 윤곽이 또렷하게
  const data = ctx.getImageData(0, 0, atlas.width, atlas.height)
  const d = data.data
  const W = atlas.width, Hh = atlas.height
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] > 110 ? 255 : 0
  const solid = (x, y) => x >= 0 && y >= 0 && x < W && y < Hh && d[(y * W + x) * 4 + 3] === 255
  const edge = []
  for (let y = 0; y < Hh; y++) {
    for (let x = 0; x < W; x++) {
      if (solid(x, y)) continue
      const c = Math.floor(x / cw)
      const same = (nx) => Math.floor(nx / cw) === c
      if ((same(x - 1) && solid(x - 1, y)) || (same(x + 1) && solid(x + 1, y)) || solid(x, y - 1) || solid(x, y + 1)) edge.push(y * W + x)
    }
  }
  for (const i of edge) d.set([18, 30, 74, 255], i * 4)
  ctx.putImageData(data, 0, 0)

  const tex = gl.createTexture()
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.uniform1i(U.uFish, 0)
  gl.uniform1f(U.uFishFrames, imgs.length)
  cell = [cw, ch]
  atlasReady = true
})

// ---------- 접속자 개복치 ----------
// 접속자마다 색조를 돌려서 구분 (원본은 파란색). 설정에서 고를 수 있는 색도 이것
export const HUES = [0, -40, 40, 90, 140, 180, -140, -90]

// 원본 몸통 파랑을 색조 회전했을 때의 색 (설정의 색 견본용, 셰이더와 같은 식)
export function swatchColor(deg) {
  const a = (deg * Math.PI) / 180
  const c = [0.39, 0.59, 0.86]
  const k = 0.57735
  const ca = Math.cos(a), sa = Math.sin(a)
  const dot = k * (c[0] + c[1] + c[2])
  const cross = [k * (c[2] - c[1]), k * (c[0] - c[2]), k * (c[1] - c[0])]
  const out = c.map((v, i) => v * ca + cross[i] * sa + k * dot * (1 - ca))
  return `rgb(${out.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)).join(',')})`
}
const hueOf = (id, deg) => ((typeof deg === 'number' ? deg : HUES[hashOf(id) % HUES.length]) * Math.PI) / 180
const BUBBLE_MS = 4000
const fishes = new Map() // id -> 상태

// id로 정한 값은 모든 접속자 화면에서 똑같이 나온다
function hashOf(id) {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  return (h ^ (h >>> 16)) >>> 0
}
function seedsOf(id) {
  let s = hashOf(id)
  return Array.from({ length: 6 }, () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32))
}

// 헤엄 경로: id와 '지금 시각'만으로 정해지는 느린 곡선 → 따로 위치를 주고받지 않아도
// 모든 화면에서 같은 자리에 있다 (기기 시계가 맞다는 전제)
function pathAt(r, t) {
  return [
    0.5 + 0.3 * Math.sin(t * (0.06 + 0.06 * r[0]) + 6.283 * r[1]) + 0.1 * Math.sin(t * (0.15 + 0.08 * r[2]) + 6.283 * r[3]),
    0.56 + 0.17 * Math.sin(t * (0.05 + 0.05 * r[4]) + 6.283 * r[5]) + 0.06 * Math.sin(t * (0.13 + 0.06 * r[0]) + 6.283 * r[2]),
  ]
}

export function addFish(layer, { id, name, hue, joinedAt }, isMe) {
  if (fishes.has(id)) return
  const label = document.createElement('div')
  label.className = 'fish-label' + (isMe ? ' me' : '')
  label.textContent = isMe ? `${name} (나)` : name
  label.style.visibility = 'hidden' // 첫 프레임에서 자리를 잡기 전까지 숨김
  const bubble = document.createElement('div')
  bubble.className = 'bubble hidden'
  layer.append(label, bubble)
  fishes.set(id, {
    id, isMe, label, bubble,
    seeds: seedsOf(id),
    joinedAt: joinedAt || Date.now(), // 들어온 시각 (지쳐서 쉬는 주기 기준)
    hue: hueOf(id, hue),
    flip: 0, turnUntil: 0, blinkUntil: 0, talkUntil: 0, lookFrom: 0, lookUntil: 0, bubbleTimer: null,
    fainted: false, faintPos: null,
  })
}

// 닉네임·색이 바뀌었을 때
export function updateFish(id, { name, hue, joinedAt }) {
  const f = fishes.get(id)
  if (!f) return
  if (name) f.label.textContent = f.isMe ? `${name} (나)` : name
  f.hue = hueOf(id, hue)
  if (joinedAt) f.joinedAt = joinedAt
}

export function removeFish(id) {
  const f = fishes.get(id)
  if (!f) return
  clearTimeout(f.bubbleTimer)
  f.label.remove()
  f.bubble.remove()
  fishes.delete(id)
}

export function fishIds() {
  return [...fishes.keys()]
}

export function showBubble(id, text) {
  const f = fishes.get(id)
  if (!f) return
  f.bubble.textContent = String(text).slice(0, 60)
  f.bubble.classList.remove('hidden')
  f.talkUntil = performance.now() + Math.min(BUBBLE_MS, 600 + text.length * 120)
  clearTimeout(f.bubbleTimer)
  f.bubbleTimer = setTimeout(() => f.bubble.classList.add('hidden'), BUBBLE_MS)
}

// 멍때리기에서 움직이면 그 자리에서 뒤집혀 기절
export function setFainted(id, fainted) {
  const f = fishes.get(id)
  if (!f) return
  f.fainted = fainted
  f.faintPos = fainted ? currentPos(f, Date.now() / 1000) : null
  f.label.classList.toggle('fainted', fainted)
}

// ---------- 지쳐서 쉬기: 3분 헤엄 → 바닥으로 똑바로 가라앉아 1분 누워 쉼 → 다시 떠오름 (반복) ----------
// 들어온 시각(joinedAt)과 지금 시각만으로 정해져서 모든 화면에서 같다
const SWIM_S = 180
const SINK_S = 4
const REST_S = 60
const RISE_S = 4
const CYCLE_S = SWIM_S + SINK_S + REST_S + RISE_S
const ease = (u) => u * u * (3 - 2 * u)

function restState(f, t) {
  const phase = ((t * 1000 - f.joinedAt) / 1000) % CYCLE_S
  if (phase < SWIM_S) return null
  const rp = phase - SWIM_S
  const start = pathAt(f.seeds, t - rp) // 지치기 시작한 자리
  const floorY = 0.78 + 0.05 * f.seeds[4] // 바닥 (개복치마다 조금씩 다르게)
  if (rp < SINK_S) {
    // y축으로만 똑바로 가라앉음
    return { mode: 'sink', pos: [start[0], start[1] + (floorY - start[1]) * ease(rp / SINK_S)] }
  }
  if (rp < SINK_S + REST_S) return { mode: 'rest', pos: [start[0], floorY] }
  // 다시 원래 헤엄 경로로 떠오름
  const u = ease((rp - SINK_S - REST_S) / RISE_S)
  const to = pathAt(f.seeds, t)
  return { mode: 'rise', pos: [start[0] + (to[0] - start[0]) * u, floorY + (to[1] - floorY) * u] }
}
const isResting = (f, t) => {
  const r = restState(f, t)
  return !!r && r.mode !== 'rise'
}
const currentPos = (f, t) => restState(f, t)?.pos ?? pathAt(f.seeds, t)

// 이번 프레임에 개복치가 있을 자리·그림을 계산
function fishFrame(f, now, t) {
  let pos, frame
  const rest = f.fainted ? null : restState(f, t)
  const resting = !!rest && rest.mode !== 'rise'
  f.label.classList.toggle('resting', resting)
  if (resting) {
    // 누운 채로 가라앉아 쉼. 말·탭·깜빡임 등에 반응 안 함
    return { pos: rest.pos, frame: F.lay, flip: f.flip, still: true }
  }
  if (f.fainted) {
    // 기절: 그 자리에서 천천히 둥실
    pos = [f.faintPos[0], f.faintPos[1] + Math.sin(t * 1.2 + f.seeds[0] * 6) * 0.004]
    frame = F.faint
  } else {
    pos = rest ? rest.pos : pathAt(f.seeds, t)
    const ahead = pathAt(f.seeds, t + 0.5)
    const vx = ahead[0] - pos[0]
    // 그림은 왼쪽을 봄 → 오른쪽으로 갈 때 뒤집기. 방향이 바뀌면 잠깐 정면을 보며 돌아섬
    const flip = vx > 0.0008 ? 1 : vx < -0.0008 ? 0 : f.flip
    if (flip !== f.flip) {
      f.flip = flip
      f.turnUntil = now + 280
    }
    if (!f.blinkUntil && Math.random() < 0.004) f.blinkUntil = now + 180
    if (f.blinkUntil && now > f.blinkUntil) f.blinkUntil = 0

    frame = Math.floor(t * 3 + f.seeds[3] * 10) % 2 ? F.swim2 : F.swim1
    if (now >= f.lookFrom && now < f.lookUntil) frame = F.front // 정면 쳐다보기
    else if (now < f.talkUntil) frame = Math.floor(now / 160) % 2 ? F.talk : F.swim1
    else if (now < f.turnUntil) frame = F.front
    else if (f.blinkUntil) frame = F.blink
  }
  return { pos, frame, flip: f.fainted || frame === F.front ? 0 : f.flip }
}

// ---------- 그리기 ----------
const fishA = new Float32Array(MAX_FISH * 4)
const fishHue = new Float32Array(MAX_FISH)
let last = performance.now()
let frames = 0
let fpsAt = last
function draw(now) {
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  simTime += dt * Number(ui.speed.value)
  for (let i = 0; i < 3; i++) light[i] += (lightTarget[i] - light[i]) * 0.06

  gl.uniform2f(U.uRes, canvas.width, canvas.height)
  gl.uniform1f(U.uTime, simTime)
  night += (nightTarget - night) * Math.min(1, dt * 1.5) // 1~2초에 걸쳐 바뀜
  gl.uniform1f(U.uNight, night)
  gl.uniform3fv(U.uLight, light)
  gl.uniform1f(U.uDither, Number(ui.dither.value))
  gl.uniform1f(U.uQuant, ui.pal.checked ? 1 : 0)
  gl.uniform4fv(U.uRip, ripples)

  let count = 0
  if (atlasReady) {
    const t = Date.now() / 1000
    const sx = innerWidth / canvas.width
    const sy = innerHeight / canvas.height
    // 내 개복치를 마지막에 그려서 겹치면 위로
    const list = [...fishes.values()].sort((a, b) => a.isMe - b.isMe).slice(-MAX_FISH)
    for (const f of list) {
      const { pos, frame, flip, still } = fishFrame(f, now, t)
      const bob = still ? 0 : Math.sin(t * 2.2 + f.seeds[1] * 6) * 1.2
      const cx = Math.round(pos[0] * canvas.width - cell[0] / 2)
      const cy = Math.round(pos[1] * canvas.height - cell[1] / 2 + bob)
      fishA.set([cx, cy, frame, flip], count * 4)
      fishHue[count] = f.hue
      count++
      // 이름표는 아래, 말풍선은 위 (저해상도 픽셀 → 화면 px)
      const left = `${(cx + cell[0] / 2) * sx}px`
      f.label.style.left = left
      f.label.style.top = `${(cy + cell[1]) * sy}px`
      f.label.style.visibility = ''
      f.bubble.style.left = left
      f.bubble.style.top = `${(cy + 2) * sy - 6}px`
    }
    gl.uniform2f(U.uFishCell, cell[0], cell[1])
    gl.uniform4fv(U.uFishA, fishA)
    gl.uniform1fv(U.uFishHue, fishHue)
  }
  gl.uniform1f(U.uFishCount, count)
  gl.drawArrays(gl.TRIANGLES, 0, 3)

  frames++
  if (now - fpsAt > 500) {
    $('fps').textContent = Math.round((frames * 1000) / (now - fpsAt))
    frames = 0
    fpsAt = now
  }
  requestAnimationFrame(draw)
}
requestAnimationFrame(draw)
