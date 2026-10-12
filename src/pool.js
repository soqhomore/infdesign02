// 위에서 내려다본 도트 수조 (WebGL 프래그먼트 셰이더)
// 1) 낮은 해상도로 물 표면·바닥·물빛(caustics)·반사광을 계산하고
// 2) 참고 이미지에서 뽑은 14색 팔레트 + 바이어 디더링으로 줄인 뒤
// 3) CSS image-rendering: pixelated 로 확대해서 도트 그림처럼 보이게 한다.

// 참고 이미지(김 서린 파란 수영장)에서 뽑은 색 + 하이라이트 + 개복치 볼터치용 분홍 두 색
const PALETTE = [
  '#020f33', '#021d55', '#022b74', '#013a91', '#004fa9', '#0464c4', '#0178da',
  '#0a8fe8', '#00a9fa', '#00c3fc', '#4fd6ff', '#9ae6ff', '#d8f6ff', '#ffffff',
  '#e9799a', '#ffb3c6',
]
// 개복치 스프라이트: 원본은 도트 1칸이 약 8.5px로 확대된 그림 → 원래 도트 크기로 되돌려서 씀
const FISH_FRAMES = ['/fish/fish-left01.png', '/fish/fish-left02.png', '/fish/fish-left-eyesclosed.png']
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
uniform vec3 uPal[${PALETTE.length}];
uniform vec4 uRip[${MAX_RIPPLES}]; // 물결: x, y, 시작 시각, 세기
uniform sampler2D uFish;   // 개복치 프레임들을 가로로 이어 붙인 그림
uniform vec2 uFishCorner;  // 개복치 칸의 왼쪽 위 (저해상도 픽셀 좌표)
uniform vec2 uFishCell;    // 한 프레임 칸 크기 (픽셀)
uniform float uFishFrame, uFishFrames, uFishFlip, uFishOn;

// 저해상도 픽셀 위치 px에서 개복치 그림 색 (도트 1칸 = 화면 도트 1칸)
vec4 fishAt(vec2 px) {
  if (uFishOn < 0.5) return vec4(0.0);
  vec2 local = (floor(px) - uFishCorner + 0.5) / uFishCell;
  if (local.x < 0.0 || local.y < 0.0 || local.x > 1.0 || local.y > 1.0) return vec4(0.0);
  if (uFishFlip > 0.5) local.x = 1.0 - local.x;
  return texture2D(uFish, vec2((uFishFrame + local.x) / uFishFrames, local.y));
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
  vec3 shallow = vec3(0.05, 0.66, 1.0);
  vec3 mid = vec3(0.0, 0.26, 0.7);
  vec3 deep = vec3(0.0, 0.09, 0.32);
  vec3 tint = mix(shallow, mid, smoothstep(0.2, 0.55, fd));
  tint = mix(tint, deep, smoothstep(0.7, 1.0, fd));

  vec3 col = floorCol * tint * 1.3;
  col += vec3(0.45, 0.85, 1.0) * caus * (0.04 + 0.96 * pow(1.0 - fd, 2.2)) * 0.55;

  // ---------- 개복치 (물 표면 바로 아래) ----------
  // 표면 일렁임은 개복치 전체를 1픽셀씩 흔들어서 표현 (JS에서) → 윤곽이 깨지지 않음
  vec4 fish = fishAt(px);
  float isFish = step(0.5, fish.a);
  if (fish.a > 0.5) {
    float lum = dot(fish.rgb, vec3(0.3, 0.59, 0.11));
    vec3 fishCol = fish.rgb * (0.92 + 0.15 * max(L.z, 0.0));
    fishCol = mix(fishCol, fishCol * vec3(0.85, 0.97, 1.08), 0.5); // 물속이라 아주 살짝 푸르게
    fishCol += vec3(0.45, 0.85, 1.0) * caus * 0.1 * step(0.35, lum); // 밝은 몸 위로만 물빛
    if (lum < 0.36) fishCol = vec3(0.008, 0.06, 0.2); // 테두리는 또렷하게
    col = fishCol;
  }

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
    vec3 c = col + (bayer4(gl_FragCoord.xy) - 0.5) * uDither * 0.11 * (1.0 - isFish); // 개복치는 디더 없이 깔끔하게
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
for (const name of ['uRes', 'uTime', 'uLight', 'uDither', 'uQuant', 'uPal', 'uRip',
  'uFish', 'uFishCorner', 'uFishCell', 'uFishFrame', 'uFishFrames', 'uFishFlip', 'uFishOn']) {
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
  fish.target = [e.clientX / innerWidth, e.clientY / innerHeight] // 궁금해서 다가옴
  fish.curious = 2.5
})

// ---------- 개복치 ----------
// 프레임들을 원래 도트 크기로 줄여서 가로로 이어 붙인 텍스처를 만든다
const fish = {
  ready: false, cell: [0, 0],
  pos: [0.55, 0.62], vel: [0, 0], target: [0.4, 0.6],
  flip: 0, frame: 0, frameClock: 0, blinkUntil: 0, curious: 0,
}
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
    // 가운데 정렬, 아래쪽(배 지느러미) 맞춤
    ctx.putImageData(out, i * cw + Math.floor((cw - w) / 2), ch - h - 1)
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
      const cell = Math.floor(x / cw)
      const same = (nx) => Math.floor(nx / cw) === cell
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
  fish.cell = [cw, ch]
  fish.ready = true
})

// 느긋하게 돌아다니다가, 목표에 닿으면 새 목표를 고른다
function updateFish(dt, t) {
  const aspect = innerWidth / innerHeight
  const dx = (fish.target[0] - fish.pos[0]) * aspect
  const dy = fish.target[1] - fish.pos[1]
  const dist = Math.hypot(dx, dy)
  if (dist < 0.03) {
    fish.target = [0.12 + Math.random() * 0.76, 0.3 + Math.random() * 0.5]
  }
  const maxSpeed = fish.curious > 0 ? 0.16 : 0.07
  const want = dist > 0 ? [(dx / dist) * maxSpeed, (dy / dist) * maxSpeed] : [0, 0]
  fish.vel[0] += (want[0] - fish.vel[0]) * Math.min(1, dt * 1.5)
  fish.vel[1] += (want[1] - fish.vel[1]) * Math.min(1, dt * 1.5)
  fish.pos[0] += (fish.vel[0] / aspect) * dt
  fish.pos[1] += fish.vel[1] * dt
  fish.curious = Math.max(0, fish.curious - dt)

  // 그림은 왼쪽을 봄 → 오른쪽으로 갈 때 뒤집기 (살짝 여유를 둬서 떨림 방지)
  if (fish.vel[0] > 0.012) fish.flip = 1
  else if (fish.vel[0] < -0.012) fish.flip = 0

  // 빨리 갈수록 지느러미를 빨리 침
  const speed = Math.hypot(fish.vel[0], fish.vel[1])
  fish.frameClock += dt * (2.5 + speed * 40)
  if (!fish.blinkUntil && Math.random() < dt * 0.25) fish.blinkUntil = t + 0.18
  let frame = Math.floor(fish.frameClock) % 2
  if (fish.blinkUntil) {
    if (t > fish.blinkUntil) fish.blinkUntil = 0
    else frame = 2
  }
  fish.frame = frame
}

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
  if (fish.ready) {
    updateFish(dt * Number(ui.speed.value), simTime)
    const bob = Math.sin(simTime * 2.2) * 1.2 // 위아래로 1~2픽셀 둥실
    const wobble = Math.sin(simTime * 3.1) * Math.sin(simTime * 1.7) * 0.9 // 물결에 좌우로 살짝
    gl.uniform2f(U.uFishCorner,
      Math.round(fish.pos[0] * canvas.width - fish.cell[0] / 2 + wobble),
      Math.round(fish.pos[1] * canvas.height - fish.cell[1] / 2 + bob))
    gl.uniform2f(U.uFishCell, fish.cell[0], fish.cell[1])
    gl.uniform1f(U.uFishFrame, fish.frame)
    gl.uniform1f(U.uFishFlip, fish.flip)
  }
  gl.uniform1f(U.uFishOn, fish.ready ? 1 : 0)
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

// ---------- HUD 시계: 지금 시각을 12시간제로 ----------
function tickClock() {
  const now = new Date()
  const h = now.getHours()
  $('hud-ampm').textContent = h < 12 ? 'AM' : 'PM'
  $('hud-time').textContent = `${h % 12 || 12}:${String(now.getMinutes()).padStart(2, '0')}`
}
tickClock()
setInterval(tickClock, 10000)
