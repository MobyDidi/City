import { DRAW_ORDER_PIECES, HeroGeometry, StreetPieceDef } from './nocheVivaData';

const VERTEX_SHADER_SRC = `#version 300 es
in vec2 a_uv;
uniform float u_W;
uniform float u_H;
uniform float u_px;
uniform float u_pw;
uniform float u_ph;
uniform float u_pieceOffset;
uniform float u_pan;
out vec2 v_uv;

void main() {
  float u = a_uv.x;
  float v = a_uv.y;
  float xf = u_px + u * u_pw;
  float d = (xf - u_W * 0.5) / u_W;
  float ad = abs(d);
  float r = min(0.32, 0.022 + 1.02 * ad * sqrt(ad));
  float x = xf + u_pieceOffset;
  float y = v * u_ph - u_pan * r * u_H;
  float xNdc = (x / u_W) * 2.0 - 1.0;
  float yNdc = 1.0 - (y / u_H) * 2.0;
  gl_Position = vec4(xNdc, yNdc, 0.0, 1.0);
  v_uv = vec2(u, v);
}
`;

const FRAGMENT_SHADER_SRC = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_day;
uniform sampler2D u_night;
uniform float u_nightAmount;
out vec4 outColor;

float mirror01(float x) {
  float m = mod(x, 2.0);
  if (m < 0.0) m += 2.0;
  return m > 1.0 ? 2.0 - m : m;
}

void main() {
  float u = mirror01(v_uv.x);
  float v = clamp(v_uv.y, 0.0, 1.0);
  vec4 dayCol = texture(u_day, vec2(u, v));
  float nu = clamp(u + 0.0016 * clamp((0.87 - u) / 0.37, 0.0, 1.0), 0.0, 1.0);
  vec4 nightCol = texture(u_night, vec2(nu, v));
  outColor = mix(dayCol, nightCol, u_nightAmount);
}
`;

const STRIP_COLS = 48;
const VERTEX_COUNT = (STRIP_COLS + 1) * 2;

export interface StreetRenderer {
  resize(geo: HeroGeometry): void;
  render(
    geo: HeroGeometry,
    pan: number,
    nightAmount: number,
    offsets: Record<StreetPieceDef['id'], number>,
  ): void;
  destroy(): void;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error('Failed to create shader');
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${info}`);
  }
  return shader;
}

function createTexture(gl: WebGL2RenderingContext, img: HTMLImageElement): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) {
    throw new Error('Failed to create texture');
  }
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function buildPieceStripData(uStart: number, uEnd: number): Float32Array {
  const data = new Float32Array(VERTEX_COUNT * 2);
  let ptr = 0;
  for (let i = 0; i <= STRIP_COLS; i++) {
    const u = uStart + (i / STRIP_COLS) * (uEnd - uStart);
    data[ptr++] = u;
    data[ptr++] = 0.0;
    data[ptr++] = u;
    data[ptr++] = 1.0;
  }
  return data;
}

class WebGL2StreetRenderer implements StreetRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private dayTex: WebGLTexture;
  private nightTex: WebGLTexture;
  private vaos: Map<StreetPieceDef['id'], { vao: WebGLVertexArrayObject; vbo: WebGLBuffer }>;
  private uW: WebGLUniformLocation | null;
  private uH: WebGLUniformLocation | null;
  private uPx: WebGLUniformLocation | null;
  private uPw: WebGLUniformLocation | null;
  private uPh: WebGLUniformLocation | null;
  private uPieceOffset: WebGLUniformLocation | null;
  private uPan: WebGLUniformLocation | null;
  private uDay: WebGLUniformLocation | null;
  private uNight: WebGLUniformLocation | null;
  private uNightAmount: WebGLUniformLocation | null;

  constructor(
    container: HTMLElement,
    dayImg: HTMLImageElement,
    nightImg: HTMLImageElement,
    geo: HeroGeometry,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'gl-canvas';
    const gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      powerPreference: 'high-performance',
    });
    if (!gl) {
      throw new Error('WebGL2 unavailable');
    }
    this.gl = gl;

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC);
    const program = gl.createProgram();
    if (!program) {
      throw new Error('Failed to create WebGL program');
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Program link error: ${info}`);
    }
    this.program = program;
    gl.useProgram(program);

    const aUv = gl.getAttribLocation(program, 'a_uv');
    this.uW = gl.getUniformLocation(program, 'u_W');
    this.uH = gl.getUniformLocation(program, 'u_H');
    this.uPx = gl.getUniformLocation(program, 'u_px');
    this.uPw = gl.getUniformLocation(program, 'u_pw');
    this.uPh = gl.getUniformLocation(program, 'u_ph');
    this.uPieceOffset = gl.getUniformLocation(program, 'u_pieceOffset');
    this.uPan = gl.getUniformLocation(program, 'u_pan');
    this.uDay = gl.getUniformLocation(program, 'u_day');
    this.uNight = gl.getUniformLocation(program, 'u_night');
    this.uNightAmount = gl.getUniformLocation(program, 'u_nightAmount');

    this.dayTex = createTexture(gl, dayImg);
    this.nightTex = createTexture(gl, nightImg);

    this.vaos = new Map();
    for (const piece of DRAW_ORDER_PIECES) {
      const vao = gl.createVertexArray();
      const vbo = gl.createBuffer();
      if (!vao || !vbo) {
        throw new Error('Failed to create VAO/VBO');
      }
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        buildPieceStripData(piece.meshU0, piece.meshU1),
        gl.STATIC_DRAW,
      );
      gl.enableVertexAttribArray(aUv);
      gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);
      this.vaos.set(piece.id, { vao, vbo });
    }
    gl.bindVertexArray(null);

    container.appendChild(this.canvas);
    this.resize(geo);
  }

  resize(geo: HeroGeometry): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(geo.W * dpr));
    const height = Math.max(1, Math.round(geo.H * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.gl.viewport(0, 0, width, height);
  }

  render(
    geo: HeroGeometry,
    pan: number,
    nightAmount: number,
    offsets: Record<StreetPieceDef['id'], number>,
  ): void {
    const gl = this.gl;
    gl.clearColor(235 / 255, 225 / 255, 215 / 255, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.dayTex);
    gl.uniform1i(this.uDay, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.nightTex);
    gl.uniform1i(this.uNight, 1);

    gl.uniform1f(this.uW, geo.W);
    gl.uniform1f(this.uH, geo.H);
    gl.uniform1f(this.uPx, geo.px);
    gl.uniform1f(this.uPw, geo.pw);
    gl.uniform1f(this.uPh, geo.ph);
    gl.uniform1f(this.uPan, pan);
    gl.uniform1f(this.uNightAmount, nightAmount);

    for (const piece of DRAW_ORDER_PIECES) {
      const entry = this.vaos.get(piece.id);
      if (!entry) continue;
      gl.bindVertexArray(entry.vao);
      gl.uniform1f(this.uPieceOffset, offsets[piece.id]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, VERTEX_COUNT);
    }
    gl.bindVertexArray(null);
  }

  destroy(): void {
    const gl = this.gl;
    for (const { vao, vbo } of this.vaos.values()) {
      gl.deleteVertexArray(vao);
      gl.deleteBuffer(vbo);
    }
    this.vaos.clear();
    gl.deleteTexture(this.dayTex);
    gl.deleteTexture(this.nightTex);
    gl.deleteProgram(this.program);
    this.canvas.remove();
  }
}

function drawPiece2D(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  piece: StreetPieceDef,
  width: number,
  height: number,
  dpr: number,
  isNight: boolean,
): void {
  const cw = Math.max(1, Math.round(width * dpr));
  const ch = Math.max(1, Math.round(height * dpr));
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const uSpan = piece.meshU1 - piece.meshU0;

  // Draw in vertical strips so mirror sampling outside [0,1] and night shift work cleanly
  const cols = 48;
  for (let i = 0; i < cols; i++) {
    const t0 = i / cols;
    const t1 = (i + 1) / cols;
    let uMid = piece.meshU0 + ((t0 + t1) * 0.5) * uSpan;
    if (uMid < 0) uMid = -uMid;
    if (uMid > 1) uMid = 2 - uMid;
    if (isNight) {
      const shift = 0.0016 * Math.max(0, Math.min(1, (0.87 - uMid) / 0.37));
      uMid = Math.min(1, Math.max(0, uMid + shift));
    }
    const halfStep = (0.5 / cols) * uSpan;
    const sx0 = Math.max(0, Math.min(iw - 1, (uMid - halfStep) * iw));
    const sx1 = Math.max(sx0 + 1, Math.min(iw, (uMid + halfStep) * iw));
    const dx = Math.floor(t0 * cw);
    const dx1 = Math.ceil(t1 * cw);
    ctx.drawImage(img, sx0, 0, sx1 - sx0, ih, dx, 0, Math.max(1, dx1 - dx), ch);
  }
}

class Canvas2DFallbackRenderer implements StreetRenderer {
  private pieces: {
    def: StreetPieceDef;
    wrapper: HTMLDivElement;
    nightCanvas: HTMLCanvasElement;
    dayCanvas: HTMLCanvasElement;
  }[] = [];
  private dayImg: HTMLImageElement;
  private nightImg: HTMLImageElement;

  constructor(
    container: HTMLElement,
    dayImg: HTMLImageElement,
    nightImg: HTMLImageElement,
    geo: HeroGeometry,
  ) {
    this.dayImg = dayImg;
    this.nightImg = nightImg;

    for (const def of DRAW_ORDER_PIECES) {
      const wrapper = document.createElement('div');
      wrapper.className = 'piece-fallback';
      const dayCanvas = document.createElement('canvas');
      const nightCanvas = document.createElement('canvas');
      nightCanvas.style.opacity = '0';
      wrapper.appendChild(dayCanvas);
      wrapper.appendChild(nightCanvas);
      container.appendChild(wrapper);
      this.pieces.push({ def, wrapper, dayCanvas, nightCanvas });
    }

    this.resize(geo);
  }

  resize(geo: HeroGeometry): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const item of this.pieces) {
      const left = geo.px + item.def.meshU0 * geo.pw;
      const width = (item.def.meshU1 - item.def.meshU0) * geo.pw;
      item.wrapper.style.left = `${left}px`;
      item.wrapper.style.width = `${width}px`;
      item.wrapper.style.height = `${geo.ph}px`;
      drawPiece2D(item.dayCanvas, this.dayImg, item.def, width, geo.ph, dpr, false);
      drawPiece2D(item.nightCanvas, this.nightImg, item.def, width, geo.ph, dpr, true);
    }
  }

  render(
    geo: HeroGeometry,
    pan: number,
    nightAmount: number,
    offsets: Record<StreetPieceDef['id'], number>,
  ): void {
    for (const item of this.pieces) {
      const midU = (item.def.u0 + item.def.u1) * 0.5;
      const xf = geo.px + midU * geo.pw;
      const d = (xf - geo.W * 0.5) / geo.W;
      const ad = Math.abs(d);
      const rCenter = Math.min(0.32, 0.022 + 1.02 * ad * Math.sqrt(ad));
      const x = offsets[item.def.id];
      const y = -pan * rCenter * geo.H;
      item.wrapper.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      item.nightCanvas.style.opacity = String(nightAmount);
    }
  }

  destroy(): void {
    for (const item of this.pieces) {
      item.wrapper.remove();
    }
    this.pieces = [];
  }
}

export function createStreetRenderer(
  container: HTMLElement,
  dayImg: HTMLImageElement,
  nightImg: HTMLImageElement,
  geo: HeroGeometry,
): StreetRenderer {
  try {
    return new WebGL2StreetRenderer(container, dayImg, nightImg, geo);
  } catch {
    return new Canvas2DFallbackRenderer(container, dayImg, nightImg, geo);
  }
}
