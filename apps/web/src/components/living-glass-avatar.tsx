"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { FaceAnimator } from "@/lib/particle-face/FaceAnimator";
import { useRooH } from "@/lib/store";

type Profile = "low" | "balanced" | "high";
type Entry = "dormant" | "permission" | "awakening" | "returning" | "active";

const headUrl = "/avatar/LeePerrySmith.glb";
const platformTop = -1.36;
const fullSize = 1.68;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

const vertexShader = /* glsl */ `
  attribute float aSeed;
  attribute float aTrail;
  uniform float uTime;
  uniform float uMotion;
  uniform float uActivity;
  uniform float uPointScale;
  uniform float uJaw;
  uniform float uBlink;
  uniform float uSmile;
  uniform float uReveal;

  varying float vLight;
  varying float vOpacity;
  varying float vPulse;
  varying float vSeed;
  varying float vHair;

  float bell(float x, float center, float width) {
    float d = (x - center) / width;
    return exp(-d * d);
  }

  float hairMask(vec3 point) {
    float front = smoothstep(0.05, 0.54, point.z);
    float temple = smoothstep(0.18, 0.46, abs(point.x));
    float part = 0.024 * bell(point.x, -0.12, 0.072);
    float hairline = mix(0.36, 0.72, front) - 0.13 * temple + part;
    return smoothstep(hairline - 0.013, hairline + 0.018, point.y);
  }

  void main() {
    vec3 point = position;
    float pulse = sin(position.y * 8.0 - uTime * 1.65 + position.x * 1.2);
    float flicker = sin(uTime * (0.9 + aSeed) + aSeed * 63.0) * uMotion;
    vec3 forward = normalize(normalMatrix * normal);
    vHair = 0.0;

    if (aTrail > 0.0) {
      float angle = uTime * (0.19 + 0.045 * aTrail);
      float c = cos(angle);
      float s = sin(angle);
      point.xz = mat2(c, -s, s, c) * point.xz;
      point.y += sin(angle * 6.0 + aSeed * 6.28) * 0.028 * uMotion;
      vLight = 0.76;
      vOpacity = (0.28 + 0.59 * pow(0.5 + 0.5 * sin(aSeed * 42.0 - uTime * 2.0), 4.0)) * uMotion;
    } else {
      float front = clamp((normal.z + 0.12) / 0.8, 0.0, 1.0) * clamp((position.z + 0.1) / 0.42, 0.0, 1.0);
      float lowerFace = bell(position.y, -0.09, 0.19) * (1.0 - smoothstep(-0.11, 0.045, position.y)) * bell(position.x, 0.0, 0.33) * front;
      float lips = bell(position.x, 0.0, 0.21) * bell(position.y, 0.047, 0.052) * front;
      float eyes = (bell(position.x, -0.34, 0.19) + bell(position.x, 0.34, 0.19)) * bell(position.y, 0.43, 0.1) * front;
      float corners = bell(abs(position.x), 0.15, 0.075) * bell(position.y, 0.055, 0.072) * front;
      point.y -= uJaw * (0.071 * lowerFace + 0.055 * lips * (1.0 - smoothstep(0.027, 0.073, position.y)));
      point.z += uJaw * 0.02 * lips;
      point.y += uBlink * (position.y > 0.43 ? -0.055 : 0.055) * eyes;
      point.z -= uBlink * 0.016 * eyes;
      point.xy += uSmile * corners * vec2(sign(position.x) * 0.024, 0.032);
      point += normal * uMotion * (0.0045 * pulse + 0.0045 * flicker);
      vHair = hairMask(position);
      float comb = sin(position.x * 42.0 + position.z * 15.0 + position.y * 19.0
        + 4.2 * position.y * position.y);
      float sweep = smoothstep(0.45, 1.0, position.y) * (0.6 - position.x * 0.58);
      point += normal * vHair * (0.025 + sweep * 0.085 + comb * 0.012);
      point.x += vHair * sweep * 0.044;
      vec3 towardCamera = normalize(-(modelViewMatrix * vec4(point, 1.0)).xyz);
      float facing = dot(forward, towardCamera);
      float key = max(0.0, dot(forward, normalize(vec3(-0.55, 0.84, 0.5))));
      float edge = pow(1.0 - clamp(facing, 0.0, 1.0), 2.3);
      float nose = bell(position.x, -0.026, 0.066) * bell(position.y, 0.32, 0.15) * front;
      float nostrils = bell(abs(position.x), 0.075, 0.036) * bell(position.y, 0.245, 0.035) * front;
      float lipSeam = bell(position.x, 0.0, 0.17) *
        bell(position.y, 0.049 - min(abs(position.x), 0.16) * 0.14, 0.014) * front;
      float lipRim = bell(position.x, 0.0, 0.15) * bell(position.y, 0.017, 0.022) * front;
      vLight = 0.20 + 0.61 * key + 0.23 * edge + nose * 0.32 + lipRim * 0.22
        - nostrils * 0.38 - lipSeam * 0.39;
      vLight = mix(vLight, 0.28 + key * 0.24 + pow(0.5 + 0.5 * comb, 3.0) * 0.5, vHair);
      vOpacity = smoothstep(-0.1, 0.23, facing) * (0.68 + 0.28 * aSeed);
    }

    vec4 viewPosition = modelViewMatrix * vec4(point, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    float perspective = 8.6 / max(1.0, -viewPosition.z);
    gl_PointSize = clamp(uPointScale * perspective * (0.76 + 0.56 * aSeed + 0.28 * aTrail), 1.5, 8.0);
    vPulse = (0.5 + 0.5 * pulse) * (0.22 + uActivity * 0.65) + flicker * 0.09;
    vSeed = aSeed;
    vOpacity *= uReveal;
  }
`;

const fragmentShader = /* glsl */ `
  varying float vLight;
  varying float vOpacity;
  varying float vPulse;
  varying float vSeed;
  varying float vHair;

  void main() {
    float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
    if (radius > 1.0 || vOpacity < 0.01) discard;
    float core = 1.0 - smoothstep(0.10, 0.52, radius);
    float halo = (1.0 - smoothstep(0.15, 1.0, radius)) * 0.36;
    vec3 teal = vec3(0.012, 0.26, 0.33);
    vec3 cyan = vec3(0.39, 1.0, 0.93);
    float light = clamp(vLight + vPulse * 0.5 + vSeed * 0.11, 0.0, 1.0);
    vec3 color = mix(teal, cyan, light);
    color = mix(color, vec3(color.r * 0.64, color.g * 0.91, color.b), vHair);
    gl_FragColor = vec4(color, vOpacity * (core * 0.91 + halo));
  }
`;

function makeParticles(source: THREE.BufferGeometry, profile: Profile) {
  const surface = source.clone();
  surface.center();
  surface.scale(0.27, 0.27, 0.27);
  if (!surface.getAttribute("normal")) surface.computeVertexNormals();
  surface.computeBoundingBox();
  const bottom = surface.boundingBox!.min.y;
  const position = surface.getAttribute("position");
  const normal = surface.getAttribute("normal");
  const index = surface.getIndex();
  const triangleCount = Math.floor((index?.count ?? position.count) / 3);
  const vertexIndex = (offset: number) => index?.getX(offset) ?? offset;

  // Sample triangle interiors by area so the scan's original vertex density
  // doesn't leave visible bands. Give the eyes, nose and mouth extra detail.
  const area = new Float64Array(triangleCount);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const edge = new THREE.Vector3();
  let totalArea = 0;
  for (let i = 0; i < triangleCount; i++) {
    a.fromBufferAttribute(position, vertexIndex(i * 3));
    b.fromBufferAttribute(position, vertexIndex(i * 3 + 1));
    c.fromBufferAttribute(position, vertexIndex(i * 3 + 2));
    const x = (a.x + b.x + c.x) / 3;
    const y = (a.y + b.y + c.y) / 3;
    const z = (a.z + b.z + c.z) / 3;
    const face = y > -0.32 && z > 0.34;
    const feature = face && Math.abs(x) < 0.23 && y > -0.02 && y < 0.45;
    const weight = feature ? 3.4 : face ? 1.8 : y > 0.66 ? 1.45 : 1;
    totalArea += edge.subVectors(b, a).cross(c.sub(a)).length() * weight;
    area[i] = totalArea;
  }

  let seed = 1709;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const count = profile === "low" ? 21000 : profile === "high" ? 62000 : 43000;
  const trailCount = profile === "low" ? 240 : 540;
  const points = new Float32Array((count + trailCount) * 3);
  const normals = new Float32Array(points.length);
  const seeds = new Float32Array(count + trailCount);
  const trails = new Float32Array(seeds.length);
  const direction = new THREE.Vector3();
  const sample = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const target = random() * totalArea;
    let first = 0;
    let last = triangleCount - 1;
    while (first < last) {
      const mid = (first + last) >>> 1;
      if (area[mid] <= target) first = mid + 1;
      else last = mid;
    }
    const j = first * 3;
    const ia = vertexIndex(j);
    const ib = vertexIndex(j + 1);
    const ic = vertexIndex(j + 2);
    const root = Math.sqrt(random());
    const along = random();
    const wa = 1 - root;
    const wb = root * (1 - along);
    const wc = root * along;
    direction.fromBufferAttribute(normal, ia).multiplyScalar(wa)
      .addScaledVector(b.fromBufferAttribute(normal, ib), wb)
      .addScaledVector(c.fromBufferAttribute(normal, ic), wc).normalize();
    sample.fromBufferAttribute(position, ia).multiplyScalar(wa)
      .addScaledVector(b.fromBufferAttribute(position, ib), wb)
      .addScaledVector(c.fromBufferAttribute(position, ic), wc);
    sample.toArray(points, i * 3);
    direction.toArray(normals, i * 3);
    seeds[i] = random();
  }
  for (let i = count; i < seeds.length; i++) {
    const band = (i % 3) + 1;
    const angle = random() * Math.PI * 2;
    const radius = 0.87 + band * 0.12 + random() * 0.07;
    points.set([Math.cos(angle) * radius, bottom + 0.05 + band * 0.15 + random() * 0.13, Math.sin(angle) * radius * 0.66], i * 3);
    normals.set([0, 1, 0], i * 3);
    seeds[i] = random();
    trails[i] = band;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(points, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute("aTrail", new THREE.BufferAttribute(trails, 1));
  geometry.computeBoundingSphere();
  return { geometry, surface, bottom };
}

export function LivingGlassAvatar({ profile, entry, reduced }: {
  profile: Profile;
  entry: Entry;
  reduced: boolean;
}) {
  const { size, invalidate, gl } = useThree();
  const { scene } = useGLTF(headUrl);
  const particles = useMemo(() => {
    let source: THREE.BufferGeometry | undefined;
    scene.traverse((object) => {
      if (!source && object instanceof THREE.Mesh) source = object.geometry;
    });
    if (!source) throw new Error("Avatar scan mesh is unavailable.");
    return makeParticles(source, profile);
  }, [scene, profile]);
  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 }, uMotion: { value: 1 }, uActivity: { value: 0 },
      uPointScale: { value: 3 }, uJaw: { value: 0 }, uBlink: { value: 0 },
      uSmile: { value: 0 }, uReveal: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    toneMapped: false,
  }), []);
  const animator = useMemo(() => new FaceAnimator(), []);
  const root = useRef<THREE.Group>(null);
  const bust = useRef<THREE.Group>(null);
  const outputAmplitude = useRef(0);
  const reveal = useRef(1);
  const motionTime = useRef(0);

  useEffect(() => () => {
    particles.geometry.dispose();
    particles.surface.dispose();
  }, [particles]);
  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    const onAudio = (event: Event) => {
      outputAmplitude.current = clamp01(Number((event as CustomEvent<number>).detail) || 0);
      if (reduced) invalidate();
    };
    window.addEventListener("rooh:output-amplitude", onAudio);
    return () => window.removeEventListener("rooh:output-amplitude", onAudio);
  }, [reduced, invalidate]);

  useEffect(() => {
    if (entry === "awakening" || entry === "returning") reveal.current = reduced ? 1 : 0.16;
  }, [entry, reduced]);

  useEffect(() => { invalidate(); }, [entry, reduced, size.width, size.height, invalidate]);

  useEffect(() => {
    if (!reduced) return;
    return useRooH.subscribe((next, prev) => {
      if (next.voice !== prev.voice || next.amplitude !== prev.amplitude ||
          next.objects.length !== prev.objects.length) invalidate();
    });
  }, [reduced, invalidate]);

  useFrame(({ pointer }, delta) => {
    const dt = Math.min(delta, 0.05);
    const { voice, amplitude, gesture, objects } = useRooH.getState();
    const speaking = voice === "speaking";
    const sound = clamp01(speaking ? outputAmplitude.current : amplitude);
    const energy = speaking ? 0.36 + sound * 0.64 : voice === "processing" ? 0.72 : voice === "listening" ? 0.35 : 0.12;
    if (!reduced) motionTime.current += dt;
    const t = reduced ? 0 : motionTime.current;
    const expression = animator.update(reduced ? 0 : dt);

    if (reduced) reveal.current = 1;
    else if (entry === "active" || entry === "awakening" || entry === "returning") {
      reveal.current = Math.min(1, reveal.current + dt * 0.9);
    }

    const aspect = size.width / Math.max(1, size.height);
    const compact = objects.length > 0;
    const scale = compact ? (aspect < 0.8 ? 0.98 : 1.14) : aspect < 0.7 ? 1.38 : fullSize;
    const targetX = compact ? (aspect < 0.8 ? -1.3 : -2.35) : 0;
    if (root.current) {
      const currentScale = reduced ? scale : THREE.MathUtils.damp(root.current.scale.x, scale, 3, dt);
      root.current.scale.setScalar(currentScale);
      root.current.position.x = reduced ? targetX : THREE.MathUtils.damp(root.current.position.x, targetX, 2, dt);
      root.current.position.y = platformTop - particles.bottom * currentScale +
        (reduced ? 0 : 0.055 + Math.sin(t * 1.35) * 0.041);
    }
    if (bust.current) {
      const look = gesture?.pointer;
      const lookX = look ? (look.x - 0.5) * 0.27 : pointer.x * 0.085;
      const lookY = look ? (look.y - 0.5) * 0.16 : -pointer.y * 0.055;
      bust.current.rotation.y = reduced ? 0 : THREE.MathUtils.damp(
        bust.current.rotation.y, lookX + Math.sin(t * 0.78) * 0.21, 3, dt,
      );
      bust.current.rotation.x = reduced ? 0 : THREE.MathUtils.damp(
        bust.current.rotation.x, lookY + Math.sin(t * 1.1 + 0.45) * 0.06 + sound * 0.04, 3, dt,
      );
      bust.current.rotation.z = reduced ? 0 : Math.sin(t * 0.95) * 0.032;
    }
    const u = material.uniforms;
    u.uTime.value = t;
    u.uMotion.value = reduced ? 0 : 1;
    u.uActivity.value = reduced ? energy : THREE.MathUtils.damp(u.uActivity.value, energy, 4, dt);
    u.uReveal.value = reveal.current;
    const pixels = size.height * gl.getPixelRatio();
    u.uPointScale.value = THREE.MathUtils.clamp(pixels * 0.006, 2.35, 5) * (profile === "low" ? 1.16 : 1);
    const jaw = speaking ? clamp01(sound * 2.4) : 0;
    u.uJaw.value = reduced ? jaw : THREE.MathUtils.damp(u.uJaw.value, jaw, 11, dt);
    u.uBlink.value = reduced ? 0 : expression.eyeBlink;
    u.uSmile.value = reduced ? 0 : expression.smile * 0.24;
  });

  return <group ref={root} position={[0, platformTop - particles.bottom * fullSize, 0]} scale={fullSize}>
    <group ref={bust}>
      <mesh geometry={particles.surface} renderOrder={1}>
        <meshBasicMaterial color="#052b39" transparent opacity={0.47} depthWrite={false} />
      </mesh>
      <points name="rooh-particle-bust" geometry={particles.geometry} material={material} renderOrder={2} frustumCulled={false} />
    </group>
  </group>;
}

useGLTF.preload(headUrl);
