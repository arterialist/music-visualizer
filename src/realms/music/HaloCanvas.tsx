import { useEffect, useRef } from "react";
import {
  BAND_COUNT,
  DEEP_PEAK_COUNT,
  WOB_WAVE_COUNT,
  getVisual,
} from "./trackPlayer";

/**
 * Audio-reactive metaball field, one fullscreen WebGL pass.
 *
 * Each of the 30 log-spaced frequency bands is a soft blob:
 *   x — the band's live stereo balance (left sound sits left)
 *   y — frequency (bass low, highs up), around the active orb
 *   size/brightness — band energy; punch (spectral flux) flashes it
 *   texture — fbm domain-warp scaled by "buzz" (spectral flatness):
 *             gritty basses shred the edges, piano stays silky
 *   wobble — bass-LFO depth ripples the low field ("wob wob")
 */
export default function HaloCanvas({
  x,
  y,
  hue,
}: {
  x: number; // anchor, viewport %
  y: number;
  hue: number; // 0..360 from artwork
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lensRef = useRef<HTMLDivElement>(null);
  const anchor = useRef({ x: x / 100, y: y / 100, hue: hue / 360 });
  anchor.current = { x: x / 100, y: y / 100, hue: hue / 360 };
  // Android Chrome does not clip a backdrop-filter by this element's mask,
  // so once wob waves start firing, the displacement warps every pixel on
  // screen permanently instead of riding inside the wave rings. Touch
  // devices skip the lens layer entirely; the WebGL halo stays.
  const lensEnabled = useRef(
    typeof window !== "undefined" &&
      !(
        window.matchMedia("(pointer: coarse)").matches ||
        window.matchMedia("(hover: none)").matches ||
        /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
      ),
  ).current;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
    });
    if (!gl) return;

    const vsSrc = `#version 300 es
      void main() {
        vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
        gl_Position = vec4(p, 0.0, 1.0);
      }`;

    const fsSrc = `#version 300 es
      precision highp float;
      uniform vec2 uRes;
      uniform float uTime;
      uniform vec2 uAnchor;      // uv, y-down
      uniform float uHue;        // 0..1
      uniform float uBuzz;
      uniform float uWobble;
      uniform float uKick;
      uniform float uWaveFreq[${WOB_WAVE_COUNT}];
      uniform float uWaveStrength[${WOB_WAVE_COUNT}];
      uniform float uWaveAge[${WOB_WAVE_COUNT}];
      uniform float uDeepFreq[${DEEP_PEAK_COUNT}];
      uniform float uDeepEnergy[${DEEP_PEAK_COUNT}];
      uniform float uDeepPunch[${DEEP_PEAK_COUNT}];
      uniform float uDeepBal[${DEEP_PEAK_COUNT}];
      uniform float uDeepWarp;
      uniform float uEnergy[${BAND_COUNT}];
      uniform float uBal[${BAND_COUNT}];
      uniform float uPunch[${BAND_COUNT}];
      out vec4 outColor;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
                   mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 4; i++) {
          v += a * noise(p);
          p = p * 2.1 + vec2(17.3, 9.1);
          a *= 0.5;
        }
        return v;
      }
      vec3 hsl2rgb(float h, float s, float l) {
        vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
        float c = (1.0 - abs(2.0 * l - 1.0)) * s;
        return (rgb - 0.5) * c + l;
      }

      void main() {
        vec2 uv = gl_FragCoord.xy / uRes;
        uv.y = 1.0 - uv.y; // y-down like the DOM
        float aspect = uRes.x / uRes.y;
        vec2 p = vec2((uv.x - uAnchor.x) * aspect, uv.y - uAnchor.y);

        // texture: buzz shreds space itself — gritty sounds get gritty light
        float warpAmt = 0.012 + uBuzz * 0.09;
        vec2 warp = vec2(
          fbm(uv * 5.0 + uTime * 0.22),
          fbm(uv * 5.0 + 31.7 - uTime * 0.18)
        ) - 0.5;
        p += warp * warpAmt * 2.0;

        // The strong wave is a chord of the live bass peaks. Low notes have
        // long spatial wavelengths; their upper resonances add finer texture.
        float radialDistance = length(p);
        float radialWave = 0.0;
        float radialWeight = 0.0;
        vec2 spaceBend = vec2(0.0);
        for (int i = 0; i < ${DEEP_PEAK_COUNT}; i++) {
          float f = uDeepFreq[i];
          float resonance = uDeepEnergy[i] * (0.28 + uDeepPunch[i] * 0.72);
          float spatialFrequency = mix(15.0, 58.0, f);
          radialWave +=
            sin(radialDistance * spatialFrequency - uTime * mix(1.0, 3.2, f)) * resonance;
          radialWeight += resonance;

          // Sub-85 Hz impacts act like local gravity wells around their own
          // stereo/frequency position. Ordinary bass ripples the field; only
          // a forceful deep transient displaces the surrounding space.
          vec2 deepCenter = vec2(uDeepBal[i] * 0.43, mix(0.26, 0.01, f));
          vec2 q = p - deepCenter;
          float depth = pow(1.0 - f, 1.65);
          float lens = exp(-dot(q, q) / mix(0.09, 0.025, f));
          float impact = uDeepWarp * uDeepPunch[i] * uDeepEnergy[i] * depth;
          spaceBend += normalize(q + vec2(0.0001)) * lens * impact * 0.11;
        }
        radialWave /= max(0.72, radialWeight);
        p += spaceBend;
        radialDistance = length(p);
        // Sub, bass, and growl onsets travel independently. Their measured
        // frequencies set front speed, width, and corrugation, so successive
        // bass families read as separate wobs instead of one shared ring.
        float singularWave = 0.0;
        for (int i = 0; i < ${WOB_WAVE_COUNT}; i++) {
          float f = uWaveFreq[i];
          float strength = uWaveStrength[i];
          float waveRadius = uWaveAge[i] * mix(0.48, 0.72, f);
          float frontWidth = mix(0.058, 0.026, f);
          float angle = atan(p.y, p.x);
          float angularNoise =
            sin(angle * 3.0 + float(i) * 1.91 + uWaveAge[i] * 0.45) * 0.56 +
            sin(angle * 7.0 - float(i) * 2.37 - uWaveAge[i] * 0.28) * 0.27 +
            (noise(vec2(cos(angle), sin(angle)) * 2.4 + float(i) * 4.13) - 0.5) * 0.48;
          // Strong fronts buckle more. Weak ones remain readable without
          // reverting to a mechanically perfect circle.
          float unevenRadius = waveRadius + angularNoise * mix(0.008, 0.043, strength);
          float front = exp(-pow((radialDistance - unevenRadius) / frontWidth, 2.0));
          float corrugation = 0.84 + 0.16 * sin(radialDistance * mix(17.0, 52.0, f));
          float force = strength * mix(0.72, 1.48, strength);
          singularWave += front * corrugation * force;
        }

        vec3 col = vec3(0.0);
        for (int i = 0; i < ${BAND_COUNT}; i++) {
          float t = float(i) / float(${BAND_COUNT - 1});
          float e = uEnergy[i];
          if (e < 0.02) continue;
          // spatial: x from stereo balance, y from frequency (bass below)
          float bx = uBal[i] * (0.43 + 0.13 * t)
                   + (noise(vec2(float(i) * 7.31, uTime * (0.05 + t * 0.14))) - 0.5) * 0.10;
          float by = (0.42 - t * 0.80) * 0.62
                   + (noise(vec2(uTime * (0.04 + t * 0.1), float(i) * 3.77)) - 0.5) * 0.07;
          vec2 bp = vec2(bx, by);
          float r = mix(0.15, 0.035, t) * (0.30 + e * 1.15);
          // Deep bands occupy more space, and a prominent bass transient
          // blooms outward like an atmospheric pressure wave.
          // Dubstep growls often peak around 250–500 Hz rather than in the
          // kick/sub bins, so retain a focused low-mid bloom around bands 2–4.
          float lowMidWob = exp(-pow((t - 0.105) / 0.075, 2.0));
          // Only the low-mid wob gets atmospheric radius. The kick remains a
          // compact central impact and therefore cannot outgrow the wob.
          float wobBloom = lowMidWob * uWobble * (0.78 + e * 0.55);
          r *= 1.0 + wobBloom;
          float kickBand = exp(-pow(t / 0.075, 2.0));
          float d = length(p - bp);
          // Blobs conform to the radial wave field. Wobs deepen the texture;
          // kicks only send a restrained, compact ripple through it.
          float waveStrength =
            0.025 + lowMidWob * uWobble * 0.075 + kickBand * uKick * 0.018;
          d *= 1.0 + radialWave * waveStrength - singularWave * lowMidWob * 0.28;
          float field = e * exp(-(d * d) / (2.0 * r * r));
          field *= 1.0 + lowMidWob * uWobble * 0.16;
          field *= 1.0 + radialWave * (0.035 + lowMidWob * uWobble * 0.055);
          field *= 1.0 + singularWave * lowMidWob * 0.56;
          float punch = uPunch[i];
          float h = fract(uHue + (t - 0.35) * 0.40);
          vec3 blobCol = hsl2rgb(h, 0.90, 0.54 + punch * 0.14);
          col += blobCol * field * (0.24 + punch * 0.8 + uKick * kickBand * 0.16);
        }

        // Lower exposure keeps overlapping bands chromatic at the dense core.
        col = 1.0 - exp(-col * 0.82);
        // Subtract part of the shared RGB component produced by additive
        // overlap, preventing bright white flashes while preserving hue.
        float whiteComponent = min(col.r, min(col.g, col.b));
        col -= vec3(whiteComponent * 0.42);
        float a = clamp(max(col.r, max(col.g, col.b)) * 0.8, 0.0, 0.72);
        outColor = vec4(col * a, a);
      }`;

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error("[halo]", gl.getShaderInfoLog(sh));
      }
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const loc = (n: string) => gl.getUniformLocation(prog, n);
    const uRes = loc("uRes");
    const uTime = loc("uTime");
    const uAnchor = loc("uAnchor");
    const uHue = loc("uHue");
    const uBuzz = loc("uBuzz");
    const uWobble = loc("uWobble");
    const uKick = loc("uKick");
    const uWaveFreq = loc("uWaveFreq");
    const uWaveStrength = loc("uWaveStrength");
    const uWaveAge = loc("uWaveAge");
    const uDeepFreq = loc("uDeepFreq");
    const uDeepEnergy = loc("uDeepEnergy");
    const uDeepPunch = loc("uDeepPunch");
    const uDeepBal = loc("uDeepBal");
    const uDeepWarp = loc("uDeepWarp");
    const uEnergy = loc("uEnergy");
    const uBal = loc("uBal");
    const uPunch = loc("uPunch");

    const smoothE = new Float32Array(BAND_COUNT);
    const smoothP = new Float32Array(BAND_COUNT);
    const smoothB = new Float32Array(BAND_COUNT);
    const smoothDeepFreq = new Float32Array(DEEP_PEAK_COUNT);
    const smoothDeepEnergy = new Float32Array(DEEP_PEAK_COUNT);
    const smoothDeepPunch = new Float32Array(DEEP_PEAK_COUNT);
    const smoothDeepBal = new Float32Array(DEEP_PEAK_COUNT);
    const smoothWaveFreq = new Float32Array(WOB_WAVE_COUNT);
    const smoothWaveStrength = new Float32Array(WOB_WAVE_COUNT);
    const sm = {
      anchorX: anchor.current.x,
      anchorY: anchor.current.y,
      buzz: 0,
      wobble: 0,
      kick: 0,
      deepWarp: 0,
    };

    const resize = () => {
      const w = Math.round(canvas.clientWidth * 0.75);
      const h = Math.round(canvas.clientHeight * 0.75);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      resize();
      const v = getVisual();
      for (let i = 0; i < BAND_COUNT; i++) {
        // fast attack, musical release
        const e = v.energy[i];
        smoothE[i] += (e - smoothE[i]) * (e > smoothE[i] ? 0.45 : 0.13);
        const pu = v.punch[i];
        smoothP[i] += (pu - smoothP[i]) * (pu > smoothP[i] ? 0.68 : 0.22);
        // Stereo placement stays responsive even while brightness is smoothed.
        smoothB[i] += (v.balance[i] - smoothB[i]) * 0.34;
      }
      for (let i = 0; i < DEEP_PEAK_COUNT; i++) {
        smoothDeepFreq[i] += (v.deepFrequency[i] - smoothDeepFreq[i]) * 0.32;
        smoothDeepEnergy[i] +=
          (v.deepEnergy[i] - smoothDeepEnergy[i]) *
          (v.deepEnergy[i] > smoothDeepEnergy[i] ? 0.52 : 0.14);
        smoothDeepPunch[i] +=
          (v.deepPunch[i] - smoothDeepPunch[i]) *
          (v.deepPunch[i] > smoothDeepPunch[i] ? 0.72 : 0.2);
        smoothDeepBal[i] += (v.deepBalance[i] - smoothDeepBal[i]) * 0.38;
      }
      const lensMasks: string[] = [];
      for (let i = 0; i < WOB_WAVE_COUNT; i++) {
        smoothWaveFreq[i] += (v.waveFrequency[i] - smoothWaveFreq[i]) * 0.45;
        smoothWaveStrength[i] +=
          (v.waveStrength[i] - smoothWaveStrength[i]) *
          (v.waveStrength[i] > smoothWaveStrength[i] ? 0.76 : 0.16);
        const strength = smoothWaveStrength[i];
        if (strength < 0.015) continue;
        const frequency = smoothWaveFreq[i];
        const radius = Math.max(
          20,
          v.waveAge[i] * (0.48 + frequency * 0.24) * canvas.clientHeight,
        );
        const feather = 12 + frequency * 7 + strength * 18;
        const inner = Math.max(0, radius - feather);
        const outer = radius + feather;
        // Non-linear opacity keeps ordinary fronts restrained while allowing
        // the strongest wobs to bend the backdrop much more aggressively.
        const lensPower = Math.min(0.98, Math.pow(strength, 1.4) * 1.45);
        lensMasks.push(
          `radial-gradient(circle at ${sm.anchorX * 100}% ${sm.anchorY * 100}%, ` +
            `transparent ${inner}px, rgba(0,0,0,${lensPower}) ${radius}px, ` +
            `transparent ${outer}px)`,
        );
      }
      if (lensRef.current) {
        const mask = lensMasks.length
          ? lensMasks.join(", ")
          : "linear-gradient(transparent, transparent)";
        lensRef.current.style.maskImage = mask;
        lensRef.current.style.webkitMaskImage = mask;
      }
      sm.buzz += (v.buzz - sm.buzz) * 0.12;
      sm.wobble +=
        (v.wobble - sm.wobble) * (v.wobble > sm.wobble ? 0.16 : 0.06);
      sm.kick += (v.kick - sm.kick) * (v.kick > sm.kick ? 0.5 : 0.14);
      sm.deepWarp +=
        (v.deepWarp - sm.deepWarp) * (v.deepWarp > sm.deepWarp ? 0.62 : 0.11);
      sm.anchorX += (anchor.current.x - sm.anchorX) * 0.06;
      sm.anchorY += (anchor.current.y - sm.anchorY) * 0.06;

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, performance.now() / 1000);
      gl.uniform2f(uAnchor, sm.anchorX, sm.anchorY);
      gl.uniform1f(uHue, anchor.current.hue);
      gl.uniform1f(uBuzz, sm.buzz);
      gl.uniform1f(uWobble, sm.wobble);
      gl.uniform1f(uKick, sm.kick);
      gl.uniform1fv(uWaveFreq, smoothWaveFreq);
      gl.uniform1fv(uWaveStrength, smoothWaveStrength);
      gl.uniform1fv(uWaveAge, v.waveAge);
      gl.uniform1fv(uDeepFreq, smoothDeepFreq);
      gl.uniform1fv(uDeepEnergy, smoothDeepEnergy);
      gl.uniform1fv(uDeepPunch, smoothDeepPunch);
      gl.uniform1fv(uDeepBal, smoothDeepBal);
      gl.uniform1f(uDeepWarp, sm.deepWarp);
      gl.uniform1fv(uEnergy, smoothE);
      gl.uniform1fv(uBal, smoothB);
      gl.uniform1fv(uPunch, smoothP);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full"
        style={{ mixBlendMode: "screen" }}
      />
      {lensEnabled && (
        <>
          <svg aria-hidden className="pointer-events-none absolute h-0 w-0">
            <defs>
              <filter id="wob-space-lens" x="-10%" y="-10%" width="120%" height="120%">
                <feTurbulence
                  type="fractalNoise"
                  baseFrequency="0.011 0.021"
                  numOctaves="2"
                  seed="29"
                  result="wobNoise"
                />
                <feDisplacementMap
                  in="SourceGraphic"
                  in2="wobNoise"
                  scale="38"
                  xChannelSelector="R"
                  yChannelSelector="G"
                />
              </filter>
            </defs>
          </svg>
          <div
            ref={lensRef}
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              zIndex: 60,
              background: "rgba(255,255,255,0.001)",
              backdropFilter: "url(#wob-space-lens) blur(0.15px)",
              WebkitBackdropFilter: "url(#wob-space-lens) blur(0.15px)",
              maskImage: "linear-gradient(transparent, transparent)",
              WebkitMaskImage: "linear-gradient(transparent, transparent)",
              maskComposite: "add",
              WebkitMaskComposite: "source-over",
              willChange: "mask-image",
            }}
          />
        </>
      )}
    </>
  );
}
