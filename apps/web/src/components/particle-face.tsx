"use client";
import {useEffect,useMemo,useRef} from "react";
import {useFrame,useThree} from "@react-three/fiber";
import * as THREE from "three";
import {generateFaceData} from "@/lib/particle-face/FaceGeometry";
import {FaceAnimator} from "@/lib/particle-face/FaceAnimator";
import {ParticleSystem} from "@/lib/particle-face/ParticleSystem";
import {useRooH} from "@/lib/store";

type Profile="low"|"balanced"|"high";
type Entry="dormant"|"permission"|"awakening"|"returning"|"active";

export function ParticleFace({profile,entry,reduced}:{profile:Profile;entry:Entry;reduced:boolean}){
  const group=useRef<THREE.Group>(null);
  const {gl}=useThree();
  const face=useMemo(()=>new ParticleSystem(generateFaceData(profile==="high"?200000:profile==="balanced"?110000:45000)),[profile]);
  const animator=useMemo(()=>new FaceAnimator(),[]);
  const reveal=useRef(1);
  const outputAmplitude=useRef(0);
  const mouth=useRef(0);
  useEffect(()=>{
    const resize=()=>face.handleResize(gl.getPixelRatio());
    const audio=(event:Event)=>{outputAmplitude.current=(event as CustomEvent<number>).detail};
    window.addEventListener("resize",resize);
    resize();
    window.addEventListener("rooh:output-amplitude",audio);
    return()=>{
      window.removeEventListener("resize",resize);
      window.removeEventListener("rooh:output-amplitude",audio);
      face.points.geometry.dispose();
      (face.points.material as THREE.Material).dispose();
    };
  },[face,gl]);
  useEffect(()=>{if(entry==="awakening"||entry==="returning")reveal.current=reduced?1:0},[entry,reduced]);
  useFrame((state,delta)=>{
    const dt=Math.min(delta,.05),{voice,amplitude,gesture,objects}=useRooH.getState();
    if(entry==="active"||entry==="awakening"||entry==="returning")reveal.current=Math.min(1,reveal.current+dt*(reduced?10:.55));
    const anim=animator.update(reduced?0:dt);
    const sound=voice==="speaking"?outputAmplitude.current:amplitude;
    const targetMouth=voice==="speaking"?Math.min(1,sound*3):voice==="listening"?.06:0;
    mouth.current=THREE.MathUtils.damp(mouth.current,targetMouth,12,dt);
    anim.mouthOpen=mouth.current;
    anim.browRaise=voice==="processing"?.28:anim.browRaise;
    const pointer=gesture?.pointer;
    const lookX=pointer?(pointer.x-.5)*1.3:state.pointer.x*.18;
    const lookY=pointer?(pointer.y-.5)*.8:-state.pointer.y*.12;
    const activity=voice==="speaking"||voice==="processing"?Math.max(.4,sound):voice==="listening"?.25:0;
    face.update(reduced?0:state.clock.elapsedTime,anim,reduced?0:lookX,reduced?0:lookY,reveal.current,activity);
    if(group.current){
      const compact=objects.length>0;
      group.current.position.x=THREE.MathUtils.damp(group.current.position.x,compact?-2.35:0,2,dt);
      group.current.position.y=.35+(reduced?0:Math.sin(state.clock.elapsedTime*.65)*.045);
      group.current.scale.setScalar(THREE.MathUtils.damp(group.current.scale.x,compact?1.05:1.5,2,dt));
    }
  });
  return <group ref={group} position={[0,.35,0]}>
    <mesh position={[0,0,-.18]} scale={[.77,1.03,.48]} renderOrder={19}>
      <sphereGeometry args={[1,48,32]}/>
      <meshBasicMaterial color="#001423" transparent opacity={.72} depthTest={false} depthWrite={false}/>
    </mesh>
    <mesh position={[0,-1.1,-.22]} scale={[2.15,.53,.36]} renderOrder={19}>
      <sphereGeometry args={[1,48,24]}/>
      <meshBasicMaterial color="#001423" transparent opacity={.58} depthTest={false} depthWrite={false}/>
    </mesh>
    <primitive object={face.points}/>
  </group>;
}
