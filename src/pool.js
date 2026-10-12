// 위에서 내려다본 도트 수조 (WebGL 프래그먼트 셰이더)
// 1) 낮은 해상도로 물 표면·바닥·물빛(caustics)·반사광을 계산하고
// 2) 참고 이미지에서 뽑은 14색 팔레트 + 바이어 디더링으로 줄인 뒤
// 3) CSS image-rendering: pixelated 로 확대해서 도트 그림처럼 보이게 한다.

// 참고 이미지(김 서린 파란 수영장)에서 뽑은 색 + 하이라이트
const PALETTE = [
  '#020f33', '#021d55', '#022b74', '#013a91', '#004fa9', '#0464c4', '#0178da',
  '#0a8fe8', '#00a9fa', '#00c3fc', '#4fd6ff', '#9ae6ff', '#d8f6ff', '#ffffff',
]
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
uniform vec3 uPal[${PALETTE.length}];
uniform vec4 uRip[${MAX_RIPPLES}]; // 물결: x, y, 시작 시각, 세기

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
  float e = 0.006;
  float h0 = swell(p, t);
  float hxp = swell(p + vec2(e, 0.0), t), hxm = swell(p - vec2(e, 0.0), t);
  float hyp = swell(p + vec2(0.0, e), t), hym = swell(p - vec2(0.0, e), t);
  float hpp = swell(p + vec2(e, e), t), hpm = swell(p + vec2(e, -e), t);
  float hmp = swell(p + vec2(-e, e), t), hmm = swell(p + vec2(-e, -e), t);
  float hxx = (hxp - 2.0 * h0 + hxm) / (e * e);
  float hyy = (hyp - 2.0 * h0 + hym) / (e * e);
  float hxy = (hpp - hpm - hmp + hmm) / (4.0 * e * e);
  float det = (1.0 + k * hxx) * (1.0 + k * hyy) - k * k * hxy * hxy;
  return clamp(1.0 / max(abs(det), 0.04), 0.0, 9.0);
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

  // 굴절: 깊을수록 바닥이 더 많이 일렁여 보임
  vec2 fuv = uv + N.xy * (0.012 + 0.03 * d);
  vec2 fp = vec2(fuv.x * aspect, fuv.y);
  float fd = depthAt(fuv, t);

  // ---------- 바닥 ----------
  vec3 albedo = vec3(0.62, 0.86, 1.0);
  vec3 fN = vec3(0.0, 0.0, 1.0);

  // 왼쪽 아래 자갈 더미
  vec2 pc = (fuv - vec2(0.2, 0.75)) * vec2(aspect * 0.9, 1.25);
  float pileMask = 1.0 - smoothstep(0.16, 0.3, length(pc) + 0.08 * (noise(fp * 9.0) - 0.5));
  if (pileMask > 0.0) {
    vec4 v = voronoi(fp * 11.0, 0.0);
    vec2 local = (fp * 11.0 - v.zw) / 0.46;
    float r2 = dot(local, local);
    float stone = (1.0 - smoothstep(0.75, 1.0, r2)) * pileMask;
    vec3 sN = normalize(vec3(local, sqrt(max(0.0, 1.0 - min(r2, 1.0)))));
    fN = normalize(mix(fN, sN, stone));
    float tone = hash(floor(v.zw * 7.0));
    albedo = mix(albedo, mix(vec3(0.16, 0.3, 0.62), vec3(0.3, 0.5, 0.82), tone), stone);
    albedo *= 1.0 - 0.45 * pileMask * (1.0 - stone); // 돌 사이 틈 어둡게
  }

  // 수조 턱 (아래): 밝은 타일 + 경계 그림자/하이라이트
  float rimY = 0.87 + 0.004 * sin(fuv.x * 37.0 + t * 0.9);
  float rimShadow = smoothstep(0.018, 0.0, abs(fuv.y - (rimY - 0.008)));
  float rimLight = smoothstep(0.005, 0.0, abs(fuv.y - (rimY + 0.006)));
  if (fuv.y > rimY) albedo = vec3(0.7, 0.9, 1.0);

  float lambert = 0.35 + 0.65 * max(dot(fN, L), 0.0);
  vec3 floorCol = albedo * lambert;
  floorCol *= 1.0 - 0.55 * rimShadow;

  // ---------- 물빛 (caustics): 일렁이는 보로노이 경계선 두 겹 ----------
  // 깊을수록 빛이 모이는 거리가 길어져 무늬가 더 촘촘·강하게 접힘
  float k = 0.03 + 0.025 * fd;
  float caus = caustics(fp + L.xy * 0.02 * fd, t, k);
  caus = min(pow(max(caus - 0.8, 0.0), 1.1), 2.2); // 너무 하얗게 타지 않게
  // 물빛이 고르게 깔리지 않고 뭉쳐 보이게
  caus *= 0.55 + 0.9 * fbm3(fp * 2.5 + vec2(t * 0.05, 0.0));

  // ---------- 물 색 (깊이에 따라 흡수) ----------
  vec3 shallow = vec3(0.05, 0.66, 1.0);
  vec3 mid = vec3(0.0, 0.26, 0.7);
  vec3 deep = vec3(0.0, 0.09, 0.32);
  vec3 tint = mix(shallow, mid, smoothstep(0.2, 0.55, fd));
  tint = mix(tint, deep, smoothstep(0.7, 1.0, fd));

  vec3 col = floorCol * tint * 1.3;
  col += vec3(0.45, 0.85, 1.0) * caus * (0.04 + 0.96 * pow(1.0 - fd, 2.2)) * 0.42;

  // 깊은 띠의 빛줄기
  float band = smoothstep(0.17, 0.25, uv.y) * (1.0 - smoothstep(0.35, 0.5, uv.y));
  float streak = pow(noise(vec2(uv.x * 38.0 + uv.y * 9.0, t * 0.25)), 5.0);
  col += vec3(0.3, 0.6, 1.0) * streak * band * 0.6;

  // 수조 턱 하이라이트
  col += vec3(0.6, 0.9, 1.0) * rimLight * 0.5;

  // ---------- 표면: 하늘 반사 + 반짝임 ----------
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float nh = max(dot(N, H), 0.0);
  col += vec3(0.08, 0.22, 0.5) * (1.0 - N.z) * 6.0;
  col += vec3(0.5, 0.8, 1.0) * pow(nh, 30.0) * 0.18;
  float glint = smoothstep(0.5, 0.85, pow(nh, 120.0));
  glint *= 0.5 + 0.5 * smoothstep(0.5, 0.9, d) + 0.4 * smoothstep(0.55, 1.0, uv.x);
  col += vec3(1.0) * glint;

  // 가장자리 살짝 어둡게
  col *= 1.0 - 0.25 * pow(length(uv - 0.5) * 1.2, 2.5);

  // ---------- 도트화: 디더링 + 팔레트 ----------
  if (uQuant > 0.5) {
    vec3 c = col + (bayer4(gl_FragCoord.xy) - 0.5) * uDither * 0.11;
    vec3 best = uPal[0];
    float bd = 1e9;
    for (int i = 0; i < ${PALETTE.length}; i++) {
      vec3 q = c - uPal[i];
      float dd = dot(q * vec3(0.8, 1.0, 0.6), q); // 사람 눈에 맞춘 가중치
      if (dd < bd) { bd = dd; best = uPal[i]; }
    }
    col = best;
  }
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
for (const name of ['uRes', 'uTime', 'uLight', 'uDither', 'uQuant', 'uPal', 'uRip']) {
  U[name] = gl.getUniformLocation(prog, name)
}
gl.uniform3fv(U.uPal, PALETTE.flatMap((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)))

// ---------- 설정 패널 ----------
const $ = (id) => document.getElementById(id)
const ui = { px: $('px'), speed: $('speed'), dither: $('dither'), pal: $('pal'), light: $('light') }
$('toggle').addEventListener('click', () => $('panel').classList.toggle('hidden'))
addEventListener('keydown', (e) => { if (e.key === 'h' || e.key === 'H') $('panel').classList.toggle('hidden') })

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
})

// ---------- 그리기 ----------
let last = performance.now()
let frames = 0
let fpsAt = last
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  simTime += dt * Number(ui.speed.value)
  for (let i = 0; i < 3; i++) light[i] += (lightTarget[i] - light[i]) * 0.06

  gl.uniform2f(U.uRes, canvas.width, canvas.height)
  gl.uniform1f(U.uTime, simTime)
  gl.uniform3fv(U.uLight, light)
  gl.uniform1f(U.uDither, Number(ui.dither.value))
  gl.uniform1f(U.uQuant, ui.pal.checked ? 1 : 0)
  gl.uniform4fv(U.uRip, ripples)
  gl.drawArrays(gl.TRIANGLES, 0, 3)

  frames++
  if (now - fpsAt > 500) {
    $('fps').textContent = Math.round((frames * 1000) / (now - fpsAt))
    frames = 0
    fpsAt = now
  }
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
