/**
 * Появление карточки «растворением» — порт шейдерного reveal-эффекта
 * с Codrops (перлин-нойз + радиальный градиент от центра) на DOM-карточки.
 *
 * Карточки в игре — HTML поверх канваса, поэтому шейдер работает не по ним
 * напрямую: карточка снимается в текстуру через SVG foreignObject (стили
 * инлайнятся из computed style, так что контекстные селекторы вроде
 * `#draft .card` не теряются), поверх кладётся маленький WebGL-канвас
 * с фрагментным шейдером, а сама карточка на время прячется через opacity —
 * не visibility, чтобы по ней можно было кликнуть, не дожидаясь конца.
 * Когда прогресс доходит до единицы, оверлей снимается и остаётся живой DOM.
 *
 * Любой сбой (Safari не рисует foreignObject, нет WebGL, нулевой размер) —
 * тихий откат: карточка просто показывается без эффекта.
 */

const DURATION_MS = 1100;

/** Активные оформления по элементу: новый запуск снимает предыдущий. */
const active = new WeakMap<HTMLElement, () => void>();

/** Классический перлин-нойз (Ashima / Stefan Gustavson, MIT). */
const NOISE_GLSL = `
vec3 mod289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
vec3 fade(vec3 t){ return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
float cnoise(vec3 P){
  vec3 Pi0 = floor(P);
  vec3 Pi1 = Pi0 + vec3(1.0);
  Pi0 = mod289(Pi0);
  Pi1 = mod289(Pi1);
  vec3 Pf0 = fract(P);
  vec3 Pf1 = Pf0 - vec3(1.0);
  vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
  vec4 iy = vec4(Pi0.yy, Pi1.yy);
  vec4 iz0 = Pi0.zzzz;
  vec4 iz1 = Pi1.zzzz;
  vec4 ixy = permute(permute(ix) + iy);
  vec4 ixy0 = permute(ixy + iz0);
  vec4 ixy1 = permute(ixy + iz1);
  vec4 gx0 = ixy0 * (1.0 / 7.0);
  vec4 gy0 = fract(floor(gx0) * (1.0 / 7.0)) - 0.5;
  gx0 = fract(gx0);
  vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
  vec4 sz0 = step(gz0, vec4(0.0));
  gx0 -= sz0 * (step(0.0, gx0) - 0.5);
  gy0 -= sz0 * (step(0.0, gy0) - 0.5);
  vec4 gx1 = ixy1 * (1.0 / 7.0);
  vec4 gy1 = fract(floor(gx1) * (1.0 / 7.0)) - 0.5;
  gx1 = fract(gx1);
  vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
  vec4 sz1 = step(gz1, vec4(0.0));
  gx1 -= sz1 * (step(0.0, gx1) - 0.5);
  gy1 -= sz1 * (step(0.0, gy1) - 0.5);
  vec3 g000 = vec3(gx0.x, gy0.x, gz0.x);
  vec3 g100 = vec3(gx0.y, gy0.y, gz0.y);
  vec3 g010 = vec3(gx0.z, gy0.z, gz0.z);
  vec3 g110 = vec3(gx0.w, gy0.w, gz0.w);
  vec3 g001 = vec3(gx1.x, gy1.x, gz1.x);
  vec3 g101 = vec3(gx1.y, gy1.y, gz1.y);
  vec3 g011 = vec3(gx1.z, gy1.z, gz1.z);
  vec3 g111 = vec3(gx1.w, gy1.w, gz1.w);
  vec4 norm0 = taylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
  g000 *= norm0.x; g010 *= norm0.y; g100 *= norm0.z; g110 *= norm0.w;
  vec4 norm1 = taylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
  g001 *= norm1.x; g011 *= norm1.y; g101 *= norm1.z; g111 *= norm1.w;
  float n000 = dot(g000, Pf0);
  float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
  float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
  float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
  float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));
  float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
  float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));
  float n111 = dot(g111, Pf1);
  vec3 fade_xyz = fade(Pf0);
  vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
  vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
  float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x);
  return 2.2 * n_xyz;
}
`;

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

// Как в статье: нойзом сдвигаются UV, по сдвинутым берётся второй нойз,
// к нему прибавляется радиальный градиент от центра, порог едет прогрессом.
// Коэффициент при uProgress больше кодропсовского (11 против 7): у нас
// в конце оверлей подменяется живой карточкой, и шейдер обязан успеть
// стать полностью непрозрачным до подмены, иначе виден скачок. Страховка
// от того же скачка — принудительная доводка альфы на последних процентах.
const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTexture;
uniform float uTime;
uniform float uProgress;
${NOISE_GLSL}
void main() {
  vec2 displacedUv = vUv + cnoise(vec3(vUv * 5.0, uTime * 0.1));
  float strength = cnoise(vec3(displacedUv * 5.0, uTime * 0.2));
  float radialGradient = distance(vUv, vec2(0.5)) * 12.5 - 11.0 * uProgress;
  strength = clamp(strength + radialGradient, 0.0, 1.0);
  strength = 1.0 - strength;
  float opacityProgress = smoothstep(0.0, 0.7, uProgress);
  float alpha = max(strength * opacityProgress, smoothstep(0.9, 1.0, uProgress));
  gl_FragColor = texture2D(uTexture, vUv) * alpha;
}
`;

/** Снять карточку в канвас через foreignObject; null — если не вышло. */
async function snapshot(
  el: HTMLElement,
  width: number,
  height: number,
  dpr: number,
): Promise<HTMLCanvasElement | null> {
  const clone = el.cloneNode(true) as HTMLElement;
  const from = [el, ...el.querySelectorAll('*')];
  const to = [clone, ...clone.querySelectorAll('*')];
  for (let i = 0; i < from.length; i++) {
    const src = from[i];
    const dst = to[i];
    if (!(src instanceof Element) || !(dst instanceof HTMLElement || dst instanceof SVGElement)) continue;
    const cs = getComputedStyle(src);
    let css = '';
    for (let p = 0; p < cs.length; p++) {
      const name = cs[p] as string;
      css += `${name}:${cs.getPropertyValue(name)};`;
    }
    dst.setAttribute('style', css);
  }
  // Карточка в кадре живёт одна и с угла (0,0): позиционирование и сдвиги
  // корня, снятые с живого DOM, увели бы её за край снимка.
  clone.style.position = 'static';
  clone.style.margin = '0';
  clone.style.transform = 'none';
  clone.style.inset = 'auto';
  clone.style.opacity = '1';

  const xml = new XMLSerializer().serializeToString(clone);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<foreignObject width="100%" height="100%">${xml}</foreignObject></svg>`;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  try {
    await img.decode();
  } catch {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  ctx.scale(dpr, dpr);
  try {
    ctx.drawImage(img, 0, 0, width, height);
    // Пустой снимок значит, что foreignObject молча не отрисовался
    // (так умеет Safari) — тогда честный откат без эффекта.
    const probe = ctx.getImageData(0, 0, canvas.width, Math.min(canvas.height, 8)).data;
    let ink = 0;
    for (let i = 3; i < probe.length; i += 4) ink += probe[i] as number;
    if (ink === 0) return null;
  } catch {
    return null;
  }
  return canvas;
}

/** Собрать WebGL-программу растворения; null — если контекста нет. */
function makeGl(canvas: HTMLCanvasElement, texture: TexImageSource): {
  draw(progress: number, time: number): void;
  dispose(): void;
} | null {
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true });
  if (gl === null) return null;

  const compile = (type: number, src: string): WebGLShader | null => {
    const s = gl.createShader(type);
    if (s === null) return null;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (gl.getShaderParameter(s, gl.COMPILE_STATUS) !== true) return null;
    return s;
  };
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  const prog = gl.createProgram();
  if (vs === null || fs === null || prog === null) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (gl.getProgramParameter(prog, gl.LINK_STATUS) !== true) return null;
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const uProgress = gl.getUniformLocation(prog, 'uProgress');
  const uTime = gl.getUniformLocation(prog, 'uTime');
  gl.uniform1i(gl.getUniformLocation(prog, 'uTexture'), 0);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0);

  return {
    draw(progress, time) {
      gl.uniform1f(uProgress, progress);
      gl.uniform1f(uTime, time);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}

/**
 * Проявить карточку растворением. Вызывать сразу после того, как элемент
 * стал видимым (display уже не none), синхронно — тогда карточка прячется
 * до первой отрисовки и не мигает. Задержка — для веера из нескольких карт.
 */
export function revealCard(el: HTMLElement, delayMs = 0): void {
  active.get(el)?.();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const rect = el.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;

  const dpr = Math.min(devicePixelRatio, 2);
  let overlay: HTMLCanvasElement | null = null;
  let fx: { draw(progress: number, time: number): void; dispose(): void } | null = null;
  let raf = 0;
  let done = false;
  const cleanup = (): void => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    fx?.dispose();
    overlay?.remove();
    el.style.opacity = '';
    active.delete(el);
  };
  active.set(el, cleanup);

  // Снимок стилей — синхронно, пока карточка «видима»; прячем в ту же
  // задачу, до пейнта, чтобы не мелькнула целиком.
  const shot = snapshot(el, rect.width, rect.height, dpr);
  el.style.opacity = '0';

  void shot.then((texture) => {
    if (done) return;
    if (texture === null || !el.isConnected) {
      cleanup();
      return;
    }
    overlay = document.createElement('canvas');
    overlay.width = texture.width;
    overlay.height = texture.height;
    overlay.style.cssText =
      `position:fixed;left:${rect.left}px;top:${rect.top}px;` +
      `width:${rect.width}px;height:${rect.height}px;` +
      'pointer-events:none;z-index:999;';
    fx = makeGl(overlay, texture);
    if (fx === null) {
      cleanup();
      return;
    }
    document.body.appendChild(overlay);

    // Свой сдвиг времени у каждой карты — чтобы кромка у соседних карт
    // в раздаче не растворялась одинаковым узором.
    const seed = Math.random() * 100;
    const start = performance.now() + delayMs;
    const frame = (now: number): void => {
      if (done || fx === null) return;
      if (!el.isConnected) {
        cleanup();
        return;
      }
      const t = Math.min(Math.max((now - start) / DURATION_MS, 0), 1);
      // easeOutQuad: кромка стартует бодро и мягко доезжает.
      const progress = t * (2 - t);
      fx.draw(progress, seed + (now - start) / 1000);
      if (t >= 1) {
        cleanup();
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  });
}
