
import * as THREE from "three";
import type { FaceData } from "./FaceGeometry";
import type { AnimationState } from "./FaceAnimator";

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uMouthOpen;
  uniform float uBrowRaise;
  uniform float uSmile;
  uniform float uEyeBlink;
  uniform float uPixelRatio;
  uniform float uMouseX;
  uniform float uMouseY;
  uniform float uIntroProgress;
  uniform float uActivity;

  attribute vec3 aMouthOpen;
  attribute vec3 aBrowRaise;
  attribute vec3 aSmile;
  attribute vec3 aEyeBlink;
  attribute float aRandom;

  varying float vAlpha;
  varying float vRandom;
  varying vec3 vViewPos;
  varying vec3 vWorldPos;
  varying float vViewDepthNorm;
  varying float vFade;
  varying float vFacing;
  varying float vFeature;
  varying float vEye;
  varying float vIris;

  void main() {

    vec3 pos = position
      + aMouthOpen * uMouthOpen
      + aBrowRaise * uBrowRaise
      + aSmile     * uSmile
      + aEyeBlink  * uEyeBlink;

    float maskNeck = smoothstep(-0.6, -0.2, pos.y);

    float targetLookX = clamp(uMouseX * 1.3, -1.2, 0.85);
    float lookX = targetLookX * maskNeck;
    float lookY = uMouseY * 0.8 * maskNeck;

    float cosX = cos(lookX);
    float sinX = sin(lookX);
    float nx = pos.x * cosX - pos.z * sinX;
    float nz = pos.x * sinX + pos.z * cosX;
    pos.x = nx;
    pos.z = nz;

    float cosY = cos(-lookY);
    float sinY = sin(-lookY);
    float ny = pos.y * cosY - pos.z * sinY;
    nz = pos.y * sinY + pos.z * cosY;
    pos.y = ny;
    pos.z = nz;

    float wobbleFreq = 0.7 + aRandom * 0.4;
    float wobbleAmp  = (0.0015 + aRandom * 0.0015) * (1.0 + uActivity * 0.6);
    pos.x += sin(uTime * wobbleFreq + aRandom * 6.28) * wobbleAmp;
    pos.y += cos(uTime * wobbleFreq * 0.8 + aRandom * 3.14) * wobbleAmp;
    pos.z += sin(uTime * wobbleFreq * 0.6 + aRandom * 1.57) * wobbleAmp * 0.5;

    vFade = 1.0;

    float maskY = smoothstep(0.65, 1.05, position.y) + (1.0 - smoothstep(-1.15, -0.65, position.y));
    float maskX = smoothstep(0.65, 0.9, abs(position.x));
    float dissolveFactor = clamp(maskY + maskX, 0.0, 1.0) * 0.12;

    if (dissolveFactor > 0.0) {

      float flowTime = uTime * 0.15 + aRandom * 100.0;
      float progress = fract(flowTime); 

      float driftStrength = 1.0 * dissolveFactor * (0.6 + aRandom * 0.4);
      float drift = progress * driftStrength;

      float topMask = smoothstep(0.4, 1.0, position.y);
      float cheekMask = smoothstep(0.4, 0.8, abs(position.x)) * smoothstep(-0.2, 0.4, position.y);
      float neckMask = smoothstep(-0.4, -1.0, position.y);

      float speedMult = mix(1.0, 0.08, neckMask); 
      float actualDrift = drift * speedMult;

      float gravity = pow(progress, 1.5) * driftStrength * 1.5 * speedMult;
      pos.y -= actualDrift * neckMask * 0.8 + gravity;

      pos.x += sign(pos.x) * actualDrift * 0.4 * neckMask;

      pos.z -= actualDrift * 0.5 * (topMask + cheekMask); 

      pos.x += sin(flowTime * 2.5 + position.y * 5.0) * actualDrift * 0.08;

      float alphaFade = 1.0 - smoothstep(0.3, 0.95, progress);
      vFade = alphaFade * (1.0 - dissolveFactor * 0.1);
    }

    float initProgress = clamp((uIntroProgress - aRandom * 0.5) / 0.5, 0.0, 1.0);

    initProgress = initProgress * initProgress * (3.0 - 2.0 * initProgress); 

    vec3 scatterOffset = vec3(
       sin(aRandom * 123.0) * (6.0 + aRandom * 6.0),
       -8.0 - aRandom * 5.0,
       cos(aRandom * 123.0) * (6.0 + aRandom * 6.0)
    );

    pos = mix(scatterOffset, pos, initProgress);

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    float dist = -mvPosition.z;

    gl_Position = projectionMatrix * mvPosition;

    vViewPos = mvPosition.xyz;
    vWorldPos = pos;
    vRandom = aRandom;

    vViewDepthNorm = smoothstep(2.5, 6.5, dist);

    vec3 centerView = (modelViewMatrix * vec4(0.0, 0.2, 0.0, 1.0)).xyz;
    vec3 viewNormal = normalize(mvPosition.xyz - centerView);
    vFacing = viewNormal.z;
    float eye = exp(-pow((abs(position.x) - 0.24) / 0.13, 2.0) - pow((position.y - 0.10) / 0.065, 2.0));
    float brow = exp(-pow((abs(position.x) - 0.24) / 0.17, 2.0) - pow((position.y - 0.23) / 0.035, 2.0));
    float mouth = exp(-pow(position.x / 0.19, 2.0) - pow((position.y + 0.40) / 0.045, 2.0));
    vFeature = max(max(eye, brow * 0.7), mouth * 0.8) * smoothstep(0.25, 0.6, position.z);
    vEye = eye * smoothstep(0.25, 0.6, position.z);
    vIris = exp(-pow((abs(position.x) - 0.24) / 0.035, 2.0) - pow((position.y - 0.10) / 0.035, 2.0)) * smoothstep(0.25, 0.6, position.z);
    float baseSize = 2.15 + aRandom * 0.8;
    gl_PointSize = clamp((baseSize + vFeature * 1.3) * uPixelRatio * (8.0 / max(dist, 1.0)), 2.5, 8.0);

    vAlpha = (0.9 + aRandom * 0.1) * smoothstep(0.0, 0.8, initProgress);
  }
`;

const fragmentShader = /* glsl */ `
  varying float vAlpha;
  varying float vRandom;
  varying vec3 vViewPos;
  varying vec3 vWorldPos;
  varying float vViewDepthNorm;
  varying float vFade;
  varying float vFacing;
  varying float vFeature;
  varying float vEye;
  varying float vIris;
  uniform float uActivity;

  void main() {
    float dist = length(gl_PointCoord - vec2(0.5));
    if (dist > 0.5) discard;

    float core = 1.0 - smoothstep(0.12, 0.28, dist);
    float glow = 1.0 - smoothstep(0.08, 0.49, dist);
    glow = pow(glow, 1.3);
    float brightness = core * 0.82 + glow * 0.55;

    // The reference is a dark blue point cloud with cyan facial highlights.
    float front = smoothstep(0.05, 0.6, vWorldPos.z);
    float face = smoothstep(-0.72, -0.38, vWorldPos.y) * front;
    float shoulder = 1.0 - smoothstep(-1.05, -0.43, vWorldPos.y);
    float scalp = smoothstep(0.43, 1.02, vWorldPos.y);
    float side = smoothstep(0.38, 0.78, abs(vWorldPos.x));
    float rim = side * face + smoothstep(0.8, 1.08, vWorldPos.y) * 0.45;
    float feature = clamp(vFeature, 0.0, 1.0);
    float eyeSocket = clamp(vEye * (1.0 - vIris), 0.0, 1.0);
    vec3 deepBlue = vec3(0.015, 0.14, 0.43);
    vec3 electricBlue = vec3(0.02, 0.56, 1.0);
    vec3 cyan = vec3(0.13, 1.0, 1.0);
    vec3 color = mix(deepBlue, electricBlue, clamp(face * 0.64 + rim * 0.4, 0.0, 1.0));
    color = mix(color, cyan, clamp(feature * 1.2 + rim * 0.55, 0.0, 1.0));
    color = mix(color, deepBlue, eyeSocket * 0.68);
    color = mix(color, cyan, vIris * 0.55);
    color *= 1.0 - scalp * 0.4;
    color *= 1.0 - shoulder * 0.53;
    color *= 1.75 + uActivity * 0.22 + feature * 0.55;
    float frontMask = smoothstep(-0.45, 0.02, vFacing);
    float density = mix(0.85, 1.3, face) * (1.0 - scalp * 0.18) * (1.0 - shoulder * 0.34);
    float finalAlpha = clamp(brightness * vAlpha * vFade * frontMask * (density + feature * 0.9 + rim * 0.35), 0.0, 1.0);

    gl_FragColor = vec4(color, finalAlpha);
  }
`;

export class ParticleSystem {
  public readonly points: THREE.Points;
  private readonly uniforms: Record<string, THREE.IUniform>;

  constructor(faceData: FaceData) {
    const { positions, morphTargets, particleCount } = faceData;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute(
      "aMouthOpen",
      new THREE.BufferAttribute(morphTargets.mouthOpen, 3),
    );
    geometry.setAttribute(
      "aBrowRaise",
      new THREE.BufferAttribute(morphTargets.browRaise, 3),
    );
    geometry.setAttribute(
      "aSmile",
      new THREE.BufferAttribute(morphTargets.smile, 3),
    );
    geometry.setAttribute(
      "aEyeBlink",
      new THREE.BufferAttribute(morphTargets.eyeBlink, 3),
    );

    const randoms = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) {
      const value = Math.sin(i * 127.1 + 311.7) * 43758.5453;
      randoms[i] = value - Math.floor(value);
    }
    geometry.setAttribute("aRandom", new THREE.BufferAttribute(randoms, 1));

    this.uniforms = {
      uTime: { value: 0 },
      uMouthOpen: { value: 0 },
      uBrowRaise: { value: 0 },
      uSmile: { value: 0 },
      uEyeBlink: { value: 0 },
      uPixelRatio: { value: 1 },
      uMouseX: { value: 0 },
      uMouseY: { value: 0 },
      uIntroProgress: { value: 0 },
      uActivity: { value: 0 },
    };

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geometry, material);
    this.points.renderOrder = 20;
  }

  update(
    time: number,
    animState: AnimationState,
    mouseX: number = 0,
    mouseY: number = 0,
    introProgress: number = 1.0,
    activity: number = 0,
  ) {
    this.uniforms.uTime.value = time;
    this.uniforms.uMouthOpen.value = animState.mouthOpen;
    this.uniforms.uBrowRaise.value = animState.browRaise;
    this.uniforms.uSmile.value = animState.smile;
    this.uniforms.uEyeBlink.value = animState.eyeBlink;
    this.uniforms.uMouseX.value = mouseX;
    this.uniforms.uMouseY.value = mouseY;
    this.uniforms.uIntroProgress.value = introProgress;
    this.uniforms.uActivity.value = activity;

    this.points.rotation.y = animState.headRotY * 0.5;
    this.points.rotation.x = animState.headRotX * 0.5;
    this.points.rotation.z = animState.headRotZ * 0.5;
  }

  handleResize(pixelRatio: number) {
    this.uniforms.uPixelRatio.value = pixelRatio;
  }
}
