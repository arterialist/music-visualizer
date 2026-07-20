import { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import * as THREE from "three";

const vertexShader = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying float vDepth;

  void main() {
    vUv = uv;
    vec3 transformed = position;
    float broadWave = sin(position.x * 4.6 + uTime * 1.35) * 0.055;
    float crossWave = cos(position.y * 6.2 - uTime * 1.08) * 0.035;
    float ripple = sin((position.x + position.y) * 8.0 + uTime * 1.8) * 0.018;
    vDepth = broadWave + crossWave + ripple;
    transformed.z += vDepth;
    transformed.x += sin(position.y * 4.0 + uTime * 0.9) * 0.018;
    transformed.y += cos(position.x * 3.5 - uTime * 0.82) * 0.014;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uArtwork;
  uniform float uTime;
  varying vec2 vUv;
  varying float vDepth;

  float metaball(vec2 point, vec2 center, vec2 radius) {
    vec2 delta = (point - center) / radius;
    return 1.0 / max(dot(delta, delta), 0.018);
  }

  void main() {
    vec2 point = vUv - 0.5;
    float sway = sin(uTime * 1.15) * 0.018;

    // One large body and four descending lobes merge into a continuous fluid.
    float field = metaball(point, vec2(sway, 0.055), vec2(0.43, 0.39));
    field += metaball(
      point,
      vec2(-0.245 + sway, -0.30 - sin(uTime * 1.4) * 0.045),
      vec2(0.09, 0.16)
    ) * 0.46;
    field += metaball(
      point,
      vec2(-0.075 - sway, -0.38 - sin(uTime * 1.05 + 1.8) * 0.045),
      vec2(0.075, 0.155)
    ) * 0.38;
    field += metaball(
      point,
      vec2(0.135 + sway, -0.32 - sin(uTime * 1.32 + 3.2) * 0.045),
      vec2(0.085, 0.15)
    ) * 0.42;
    field += metaball(
      point,
      vec2(0.29 - sway, -0.39 - sin(uTime * 0.92 + 4.6) * 0.04),
      vec2(0.065, 0.12)
    ) * 0.34;

    float edge = smoothstep(0.96, 1.09, field);
    if (edge <= 0.001) discard;

    float waveX = sin(vUv.y * 13.0 + uTime * 1.55) * 0.012;
    float waveY = cos(vUv.x * 11.0 - uTime * 1.18) * 0.01;
    vec2 refractedUv = clamp(vUv + vec2(waveX, waveY) * (0.65 + vDepth * 5.0), 0.001, 0.999);
    vec4 artwork = texture2D(uArtwork, refractedUv);

    vec3 normal = normalize(vec3(
      cos(vUv.y * 13.0 + uTime * 1.55) * 0.32,
      sin(vUv.x * 11.0 - uTime * 1.18) * 0.28,
      1.0
    ));
    vec3 lightDirection = normalize(vec3(-0.5, 0.72, 1.0));
    float diffuse = 0.78 + max(dot(normal, lightDirection), 0.0) * 0.26;
    float specular = pow(max(dot(reflect(-lightDirection, normal), vec3(0.0, 0.0, 1.0)), 0.0), 22.0);
    float rim = pow(1.0 - edge, 2.0) * 0.22;

    vec3 color = artwork.rgb * diffuse;
    color += vec3(0.72, 0.9, 1.0) * specular * 0.62;
    color += vec3(0.35, 0.78, 1.0) * rim;
    gl_FragColor = vec4(color, edge * 0.96);
  }
`;

function LiquidSurface({ artworkUrl }: { artworkUrl: string }) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const texture = useLoader(THREE.TextureLoader, artworkUrl);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uArtwork: { value: texture },
    }),
    [texture],
  );

  useEffect(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
  }, [texture]);

  useFrame(({ clock }) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = clock.elapsedTime;
    }
  });

  return (
    <mesh scale={0.82}>
      <planeGeometry args={[2, 2, 48, 48]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

/** True on phones/tablets regardless of how the caller was gated. */
function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(pointer: coarse)").matches ||
    window.matchMedia("(hover: none)").matches ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  );
}

export default function LiquidArtworkLoader({
  artworkUrl,
}: {
  artworkUrl: string;
}) {
  // The liquid GLSL pass is desktop-only. On mobile the realm shows the
  // pulsating cover glow instead; never create a WebGL context here.
  if (isTouchDevice()) return null;
  return (
    <div className="track-liquid-canvas" aria-hidden="true">
      <Canvas
        dpr={[1, 1.25]}
        camera={{ fov: 35, position: [0, 0, 4] }}
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
        resize={{ offsetSize: true }}
      >
        <Suspense fallback={null}>
          <LiquidSurface artworkUrl={artworkUrl} />
        </Suspense>
      </Canvas>
    </div>
  );
}
