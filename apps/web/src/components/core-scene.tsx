"use client";
import {Canvas,useFrame,useThree} from "@react-three/fiber";
import {ContactShadows,Grid,OrbitControls,Stars,Text,useAnimations,useGLTF} from "@react-three/drei";
import {Component,Suspense,useEffect,useMemo,useRef,useState,type ReactNode} from "react";
import * as THREE from "three";
import {RoomEnvironment} from "three/examples/jsm/environments/RoomEnvironment.js";
import {clone as cloneSkeleton} from "three/examples/jsm/utils/SkeletonUtils.js";
import type {OrbitControls as OrbitControlsImpl} from "three-stdlib";
import {useRooH} from "@/lib/store";
import {NeuralLab} from "./neural-lab";

const stateColors:Record<string,string>={idle:"#63dff7",connecting:"#947dff",listening:"#79efff",processing:"#ad8cff",speaking:"#f2fdff",interrupted:"#ffd37d",reconnecting:"#947dff",disconnected:"#385069",error:"#ff6685"};
const planetData:Array<[number,string,number,number]>=[[.16,"#9f9185",1.8,.9],[.22,"#e7b56b",2.35,.65],[.24,"#48a9ff",2.95,.5],[.19,"#df6348",3.5,.4],[.48,"#d7a873",4.4,.22],[.42,"#f0d29d",5.4,.17],[.34,"#8be2ee",6.25,.12],[.32,"#5076da",7,.1]];

const neuralVertexShader=`
  attribute float aPhase;
  attribute float aSize;
  uniform float uTime;
  uniform float uAmplitude;
  varying float vPhase;
  void main(){
    vPhase=aPhase;
    vec3 displaced=position;
    displaced.x+=sin(uTime*.7+aPhase*6.283)*.018;
    displaced.y+=cos(uTime*.55+aPhase*9.1)*.014;
    vec4 viewPosition=modelViewMatrix*vec4(displaced,1.0);
    gl_Position=projectionMatrix*viewPosition;
    gl_PointSize=aSize*(1.0+uAmplitude*.65)*(8.0/-viewPosition.z);
  }
`;
const neuralFragmentShader=`
  uniform vec3 uColor;
  uniform float uTime;
  varying float vPhase;
  void main(){
    float radius=length(gl_PointCoord-.5);
    float halo=1.0-smoothstep(.12,.5,radius);
    float signal=.58+.42*sin(uTime*1.6-vPhase*18.0);
    gl_FragColor=vec4(uColor,halo*signal*.82);
  }
`;
const signalVertexShader=`
  attribute float aPhase;
  varying float vPhase;
  void main(){vPhase=aPhase;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}
`;
const signalFragmentShader=`
  uniform vec3 uColor;
  uniform float uTime;
  varying float vPhase;
  void main(){
    float pulse=pow(max(0.0,sin(uTime*1.25-vPhase*6.283)),10.0);
    gl_FragColor=vec4(uColor,.035+pulse*.5);
  }
`;

function seeded(index:number){const value=Math.sin(index*127.1+311.7)*43758.5453;return value-Math.floor(value)}

function Spirit(){
  const root=useRef<THREE.Group>(null),particlesRef=useRef<THREE.ShaderMaterial>(null),signalsRef=useRef<THREE.ShaderMaterial>(null),light=useRef<THREE.PointLight>(null);
  const voice=useRooH(s=>s.voice),amp=useRooH(s=>s.amplitude),gesture=useRooH(s=>s.gesture),objects=useRooH(s=>s.objects),quality=useRooH(s=>s.quality),color=stateColors[voice];
  const geometry=useMemo(()=>{
    const count=quality==="high"?9800:4200,positions=new Float32Array(count*3),phases=new Float32Array(count),sizes=new Float32Array(count);
    const clusters=[[-.62,.15,.08],[.5,.38,-.12],[-.18,-.48,.24],[.25,-.08,-.55],[.08,.62,.35]];
    for(let i=0;i<count;i++){
      const branch=i%17===0,cluster=clusters[Math.floor(seeded(i*7)*clusters.length)],angle=seeded(i*3+1)*Math.PI*2;
      const radius=(branch ? .25 : .035)+Math.pow(seeded(i*3+2),2)*(branch ? 1.35 : .48),curl=angle+radius*4.2;
      positions[i*3]=cluster[0]+Math.cos(curl)*radius*(.65+seeded(i+8)*.55);
      positions[i*3+1]=cluster[1]+Math.sin(curl)*radius*.56+(seeded(i+12)-.5)*radius;
      positions[i*3+2]=cluster[2]+Math.sin(angle*1.7)*radius*.72+(seeded(i+15)-.5)*.16;
      phases[i]=seeded(i*3+4);sizes[i]=.75+seeded(i*3+5)*1.45;
    }
    const edgeCount=quality==="high"?1080:460,edges=new Float32Array(edgeCount*2*3),edgePhases=new Float32Array(edgeCount*2);
    for(let i=0;i<edgeCount;i++){
      const a=Math.floor(seeded(i*2+9)*count),b=(a+1+Math.floor(seeded(i*2+10)*Math.min(72,count-1)))%count;
      for(let end=0;end<2;end++){
        const index=end?b:a,offset=(i*2+end)*3;
        edges[offset]=positions[index*3];edges[offset+1]=positions[index*3+1];edges[offset+2]=positions[index*3+2];
        edgePhases[i*2+end]=phases[index];
      }
    }
    const points=new THREE.BufferGeometry();points.setAttribute("position",new THREE.BufferAttribute(positions,3));points.setAttribute("aPhase",new THREE.BufferAttribute(phases,1));points.setAttribute("aSize",new THREE.BufferAttribute(sizes,1));
    const lines=new THREE.BufferGeometry();lines.setAttribute("position",new THREE.BufferAttribute(edges,3));lines.setAttribute("aPhase",new THREE.BufferAttribute(edgePhases,1));
    return{points,lines};
  },[quality]);
  const particleUniforms=useMemo(()=>({uTime:{value:0},uAmplitude:{value:0},uColor:{value:new THREE.Color(color)}}),[color]);
  const signalUniforms=useMemo(()=>({uTime:{value:0},uColor:{value:new THREE.Color(color)}}),[color]);
  useFrame((state,delta)=>{
    const t=state.clock.elapsedTime,active=voice==="listening"||voice==="processing"||voice==="speaking",compact=objects.length>0;
    if(root.current){
      const targetX=compact?-2.25:gesture?(gesture.pointer.x-.5)*.65:0;
      root.current.position.x=THREE.MathUtils.damp(root.current.position.x,targetX,2.1,delta);
      root.current.position.y=Math.sin(t*.46)*.055;
      root.current.scale.setScalar(THREE.MathUtils.damp(root.current.scale.x,compact?.42:1.28,2.1,delta));
      root.current.rotation.y+=delta*(voice==="processing"?.24:.065);
      root.current.rotation.z=Math.sin(t*.22)*.035;
    }
    const particle=particlesRef.current,signal=signalsRef.current;
    if(particle){particle.uniforms.uTime.value=t;particle.uniforms.uAmplitude.value=amp+(active?.12:0);particle.uniforms.uColor.value.set(color)}
    if(signal){signal.uniforms.uTime.value=t;signal.uniforms.uColor.value.set(color)}
    if(light.current)light.current.intensity=2.2+amp*11+(active?1.2:0);
  });
  useEffect(()=>()=>{geometry.points.dispose();geometry.lines.dispose()},[geometry]);
  return <group ref={root} position={[0,0,0]}>
    <lineSegments geometry={geometry.lines}><shaderMaterial ref={signalsRef} uniforms={signalUniforms} vertexShader={signalVertexShader} fragmentShader={signalFragmentShader} transparent blending={THREE.AdditiveBlending} depthWrite={false}/></lineSegments>
    <points geometry={geometry.points}><shaderMaterial ref={particlesRef} uniforms={particleUniforms} vertexShader={neuralVertexShader} fragmentShader={neuralFragmentShader} transparent blending={THREE.AdditiveBlending} depthWrite={false}/></points>
    <pointLight ref={light} color={color} intensity={2.2} distance={5.5}/>
  </group>
}

function Selection({radius}:{radius:number}){return <mesh><sphereGeometry args={[radius,24,24]}/><meshBasicMaterial color="#62ddff" wireframe transparent opacity={.09}/></mesh>}
function Planet({radius,color,distance,speed}:{radius:number;color:string;distance:number;speed:number}){const pivotRef=useRef<THREE.Group>(null);useFrame((_,delta)=>{if(pivotRef.current)pivotRef.current.rotation.y+=delta*speed});return <group ref={pivotRef}><mesh position={[distance,0,0]}><sphereGeometry args={[radius,32,32]}/><meshStandardMaterial color={color} roughness={.65}/></mesh></group>}
function SolarSystem({id}:{id:string}){const ref=useRef<THREE.Group>(null),obj=useRooH(s=>s.objects.find(o=>o.id===id)),selected=useRooH(s=>s.selectedId===id),set=useRooH(s=>s.set);useFrame((_,d)=>{if(ref.current)ref.current.rotation.y+=d*.04});if(!obj)return null;return <group ref={ref} position={obj.position} rotation={obj.rotation} scale={obj.scale} onClick={e=>{e.stopPropagation();set({selectedId:id})}}><mesh><sphereGeometry args={[.65,48,48]}/><meshStandardMaterial color="#ffb84a" emissive="#ff8b19" emissiveIntensity={3}/></mesh>{planetData.map(([radius,color,distance,speed],index)=><group key={index} rotation={[0,index*.55,0]}><mesh rotation={[Math.PI/2,0,0]}><torusGeometry args={[distance,.004,4,96]}/><meshBasicMaterial color="#4e7999" transparent opacity={.28}/></mesh><Planet radius={radius} color={color} distance={distance} speed={speed}/></group>)}{selected&&<Selection radius={7.5}/>}</group>}
function Earth({id}:{id:string}){const ref=useRef<THREE.Mesh>(null),obj=useRooH(s=>s.objects.find(o=>o.id===id)),selected=useRooH(s=>s.selectedId===id),set=useRooH(s=>s.set);useFrame((_,d)=>{if(ref.current)ref.current.rotation.y+=d*.08});if(!obj)return null;return <group position={obj.position} rotation={obj.rotation} scale={obj.scale} onClick={e=>{e.stopPropagation();set({selectedId:id})}}><mesh ref={ref}><sphereGeometry args={[1.45,64,64]}/><meshStandardMaterial color="#1978bb" roughness={.72}/></mesh><mesh scale={1.008}><sphereGeometry args={[1.45,32,32]}/><meshStandardMaterial color="#6ed18a" wireframe transparent opacity={.3}/></mesh>{selected&&<Selection radius={1.8}/>}<Text position={[0,-2,0]} fontSize={.2} color="#9deaff">EARTH</Text></group>}

function JetEngine({id}:{id:string}){const fan=useRef<THREE.Group>(null),obj=useRooH(s=>s.objects.find(o=>o.id===id)),set=useRooH(s=>s.set),transform=useRooH(s=>s.transformObject);useFrame((_,d)=>{if(fan.current&&obj?.playAnimation)fan.current.rotation.z-=d*5});if(!obj)return null;const spread=obj.exploded?1.65:1,highlight=(name:string)=>obj.selectedPart?.toLowerCase().includes(name);return <group position={obj.position} rotation={obj.rotation} scale={obj.scale} onClick={e=>{e.stopPropagation();set({selectedId:id})}}><group rotation={[0,0,Math.PI/2]}><mesh name="outer casing" onClick={()=>transform(id,{selectedPart:"outer casing"})}><cylinderGeometry args={[1.28,1.02,3.8,64,1,true]}/><meshPhysicalMaterial color="#8ba2ad" metalness={.92} roughness={.2} transparent opacity={highlight("casing")?.95:.36} side={THREE.DoubleSide} emissive={highlight("casing")?"#40e5ff":"#000000"} emissiveIntensity={1.3}/></mesh><group ref={fan} position={[0,-2.02*spread,0]}>{Array.from({length:18},(_,i)=><mesh key={i} rotation={[0,i*Math.PI/9,.34]} position={[0,0,0]}><boxGeometry args={[.08,.06,1.72]}/><meshStandardMaterial color={highlight("fan")?"#76efff":"#b8cad1"} metalness={.85} roughness={.2}/></mesh>)}<mesh><cylinderGeometry args={[.3,.48,.35,32]}/><meshStandardMaterial color="#50636d" metalness={1}/></mesh></group><mesh name="compressor" position={[0,-.62*spread,0]} onClick={()=>transform(id,{selectedPart:"compressor"})}><cylinderGeometry args={[.82,.96,1.05,48]}/><meshStandardMaterial color={highlight("compressor")?"#6ee8ff":"#5d7079"} metalness={.9} roughness={.22} wireframe={Boolean(obj.exploded)}/></mesh><mesh name="combustion chamber" position={[0,.62*spread,0]} onClick={()=>transform(id,{selectedPart:"combustion chamber"})}><cylinderGeometry args={[.7,.82,.82,48]}/><meshStandardMaterial color={highlight("combustion")?"#ffb45c":"#8a694d"} emissive={highlight("combustion")?"#ff6b1a":"#1b0800"} emissiveIntensity={highlight("combustion")?2:.4} metalness={.7} roughness={.3}/></mesh><mesh name="turbine" position={[0,1.45*spread,0]} onClick={()=>transform(id,{selectedPart:"turbine"})}><torusGeometry args={[.65,.19,18,48]}/><meshStandardMaterial color={highlight("turbine")?"#76efff":"#697a82"} metalness={.95} roughness={.18}/></mesh><mesh name="shaft"><cylinderGeometry args={[.11,.11,4.6,20]}/><meshStandardMaterial color="#d8ebf1" metalness={1} roughness={.12}/></mesh></group></group>}

function Finish({color="#55dff5",metalness=.65,roughness=.25,emissive="#000000"}:{color?:string;metalness?:number;roughness?:number;emissive?:string}){return <meshStandardMaterial color={color} metalness={metalness} roughness={roughness} emissive={emissive} emissiveIntensity={emissive==="#000000"?0:1.2}/>}
function ProceduralShape({type}:{type:string}){
  const wheel=(x:number,z:number)=><mesh key={`${x}-${z}`} position={[x,-.7,z]} rotation={[Math.PI/2,0,0]}><torusGeometry args={[.34,.1,12,28]}/><Finish color="#263540" metalness={.35}/></mesh>;
  switch(type){
    case"laptop":return <group rotation={[-.08,0,0]}><mesh position={[0,-.55,.15]}><boxGeometry args={[2.7,.14,1.75]}/><Finish color="#8096a4"/></mesh><mesh position={[0,-.45,.15]}><boxGeometry args={[2.05,.025,1.2]}/><Finish color="#162b38" metalness={.2}/></mesh><group position={[0,.3,-.67]} rotation={[-.14,0,0]}><mesh><boxGeometry args={[2.7,1.7,.12]}/><Finish color="#6f8795"/></mesh><mesh position={[0,0,.071]}><planeGeometry args={[2.38,1.4]}/><meshBasicMaterial color="#103f58"/></mesh></group></group>;
    case"drone":return <group><mesh><sphereGeometry args={[.52,24,18]}/><Finish color="#4adff4"/></mesh>{[0,1,2,3].map(i=><group key={i} rotation={[0,i*Math.PI/2,0]}><mesh position={[.85,0,0]}><boxGeometry args={[1.35,.1,.12]}/><Finish color="#778c99"/></mesh><mesh position={[1.48,.1,0]}><cylinderGeometry args={[.16,.2,.18,20]}/><Finish color="#344b58"/></mesh><mesh position={[1.48,.23,0]} rotation={[Math.PI/2,0,0]}><torusGeometry args={[.54,.025,8,40]}/><Finish color="#85f4ff" emissive="#157d91"/></mesh></group>)}<mesh position={[0,-.38,.22]}><boxGeometry args={[.42,.32,.5]}/><Finish color="#182c38"/></mesh></group>;
    case"robot-arm":return <group position={[0,-.8,0]}><mesh><cylinderGeometry args={[.85,1,.35,32]}/><Finish color="#405866"/></mesh><group position={[0,.25,0]} rotation={[0,0,-.45]}><mesh position={[0,1,0]}><boxGeometry args={[.48,2,.5]}/><Finish color="#e8a64c"/></mesh><mesh position={[0,2,0]}><sphereGeometry args={[.4,24,16]}/><Finish color="#536b78"/></mesh><group position={[0,2,0]} rotation={[0,0,1.05]}><mesh position={[0,.8,0]}><boxGeometry args={[.4,1.6,.42]}/><Finish color="#f0bd68"/></mesh><group position={[0,1.7,0]}><mesh><boxGeometry args={[.7,.25,.45]}/><Finish color="#526d7a"/></mesh><mesh position={[-.38,.28,0]}><boxGeometry args={[.14,.65,.16]}/><Finish color="#79efff"/></mesh><mesh position={[.38,.28,0]}><boxGeometry args={[.14,.65,.16]}/><Finish color="#79efff"/></mesh></group></group></group></group>;
    case"satellite":return <group><mesh><boxGeometry args={[1.15,1.25,1.15]}/><Finish color="#c6a75b" metalness={.8}/></mesh>{[-1,1].map(side=><group key={side} position={[side*1.75,0,0]}><mesh><boxGeometry args={[2.15,1.05,.06]}/><Finish color="#164d87" metalness={.25} roughness={.38}/></mesh>{[-.7,0,.7].map(x=><mesh key={x} position={[x,0,.04]}><boxGeometry args={[.025,1,.02]}/><meshBasicMaterial color="#67b9e8"/></mesh>)}</group>)}<mesh position={[0,.95,0]}><cylinderGeometry args={[.09,.09,.7,12]}/><Finish color="#d8edf3"/></mesh><mesh position={[0,1.4,0]} rotation={[Math.PI,0,0]}><coneGeometry args={[.65,.3,32,1,true]}/><Finish color="#d6e4e8"/></mesh></group>;
    case"wind-turbine":return <group position={[0,-.9,0]}><mesh position={[0,1.25,0]}><cylinderGeometry args={[.18,.42,3.6,24]}/><Finish color="#d8e7eb" metalness={.25}/></mesh><group position={[0,3.05,0]} rotation={[0,0,Math.PI/2]}><mesh><cylinderGeometry args={[.23,.32,.65,24]}/><Finish color="#7b939e"/></mesh>{[0,1,2].map(i=><mesh key={i} rotation={[0,i*Math.PI*2/3,0]} position={[0,0,-1.15]}><boxGeometry args={[.09,.12,2.15]}/><Finish color="#c9f4f7" metalness={.15}/></mesh>)}</group></group>;
    case"smart-house":return <group position={[0,-.65,0]}><mesh><boxGeometry args={[2.6,1.8,2]}/><Finish color="#d2e1e4" metalness={.08} roughness={.65}/></mesh><mesh position={[0,1.35,0]} rotation={[0,Math.PI/4,0]}><coneGeometry args={[1.85,1.15,4]}/><Finish color="#3b6678"/></mesh><mesh position={[0,-.35,1.01]}><boxGeometry args={[.55,1.15,.08]}/><Finish color="#345161"/></mesh>{[-.75,.75].map(x=><mesh key={x} position={[x,.25,1.02]}><boxGeometry args={[.65,.58,.06]}/><meshBasicMaterial color="#68d9f4"/></mesh>)}</group>;
    case"desk-lamp":return <group position={[0,-.9,0]}><mesh><cylinderGeometry args={[.8,.95,.2,32]}/><Finish color="#344e5a"/></mesh><mesh position={[0,.8,0]} rotation={[0,0,-.25]}><cylinderGeometry args={[.09,.09,1.7,16]}/><Finish color="#a9c5cc"/></mesh><mesh position={[.35,1.65,0]} rotation={[0,0,.4]}><cylinderGeometry args={[.09,.09,1.35,16]}/><Finish color="#a9c5cc"/></mesh><mesh position={[.62,2.35,0]} rotation={[0,0,-.3]}><coneGeometry args={[.65,.85,32,1,true]}/><Finish color="#49cfe8"/></mesh><pointLight position={[.62,1.95,0]} color="#b8f7ff" intensity={4} distance={4}/></group>;
    case"camera":return <group position={[0,-.25,0]}><mesh><boxGeometry args={[2.5,1.5,1.05]}/><Finish color="#263946"/></mesh><mesh position={[0,0,.75]} rotation={[Math.PI/2,0,0]}><cylinderGeometry args={[.72,.86,.75,40]}/><Finish color="#435d69"/></mesh><mesh position={[0,0,1.16]} rotation={[Math.PI/2,0,0]}><cylinderGeometry args={[.48,.55,.12,40]}/><meshPhysicalMaterial color="#142b38" metalness={.7} roughness={.08} transmission={.25}/></mesh><mesh position={[-.72,.92,0]}><boxGeometry args={[.65,.35,.65]}/><Finish color="#405967"/></mesh></group>;
    case"microscope":return <group position={[0,-.9,0]}><mesh><boxGeometry args={[1.7,.2,1.4]}/><Finish color="#425b67"/></mesh><mesh position={[-.45,1.1,-.25]} rotation={[0,0,-.18]}><cylinderGeometry args={[.17,.22,2.25,24]}/><Finish color="#d8e5e8"/></mesh><mesh position={[-.7,2.05,-.25]} rotation={[0,0,-.18]}><cylinderGeometry args={[.28,.2,.65,24]}/><Finish color="#314b58"/></mesh><mesh position={[0,.85,.05]}><boxGeometry args={[1.35,.12,1.05]}/><Finish color="#6f8995"/></mesh><mesh position={[.15,.25,0]}><cylinderGeometry args={[.42,.55,.65,28]}/><Finish color="#80ddeb"/></mesh></group>;
    case"gearbox":return <group>{[[-.7,.25,0,.62],[.55,.2,.05,.86],[0,-.75,.05,.48]].map(([x,y,z,r],i)=><group key={i} position={[x,y,z]} rotation={[Math.PI/2,0,0]}><mesh><torusGeometry args={[r,.18,12,20]}/><Finish color={i===1?"#e4ac54":"#7acfe0"}/></mesh>{Array.from({length:12},(_,j)=><mesh key={j} position={[Math.cos(j*Math.PI/6)*(r+.18),Math.sin(j*Math.PI/6)*(r+.18),0]} rotation={[0,0,j*Math.PI/6]}><boxGeometry args={[.22,.18,.28]}/><Finish color={i===1?"#e4ac54":"#7acfe0"}/></mesh>)}</group>)}</group>;
    default:return <mesh><boxGeometry args={[1.8,1.8,1.8]}/><Finish/></mesh>;
  }
}
function ProceduralModel({id}:{id:string}){const obj=useRooH(s=>s.objects.find(o=>o.id===id)),selected=useRooH(s=>s.selectedId===id),set=useRooH(s=>s.set);if(!obj)return null;return <group position={obj.position} rotation={obj.rotation} scale={obj.scale} onClick={e=>{e.stopPropagation();set({selectedId:id})}}><ProceduralShape type={obj.assetId||""}/>{selected&&<group position={[0,-1.5,0]}><mesh rotation={[Math.PI/2,0,0]}><torusGeometry args={[1.75,.035,8,72]}/><meshBasicMaterial color="#72efff" transparent opacity={.9}/></mesh><pointLight color="#5eeaff" intensity={3} distance={4}/></group>}</group>}

function LoadedModel({id,url}:{id:string;url:string}){
  const gltf=useGLTF(url),obj=useRooH(s=>s.objects.find(o=>o.id===id)),set=useRooH(s=>s.set),transform=useRooH(s=>s.transformObject);
  const scene=useMemo(()=>{
    const clone=cloneSkeleton(gltf.scene);
    clone.updateWorldMatrix(true,true);
    const bounds=new THREE.Box3().setFromObject(clone),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3()),largest=Math.max(size.x,size.y,size.z);
    if(Number.isFinite(largest)&&largest>0){
      const normalizedScale=3.2/largest;
      clone.scale.setScalar(normalizedScale);
      clone.position.set(-center.x*normalizedScale,-center.y*normalizedScale,-center.z*normalizedScale);
      clone.updateWorldMatrix(true,true);
      const framedBounds=new THREE.Box3().setFromObject(clone);
      clone.position.y-=framedBounds.min.y+1.55;
    }
    clone.traverse(n=>{if((n as THREE.Mesh).isMesh){const m=n as THREE.Mesh;m.material=Array.isArray(m.material)?m.material.map(x=>x.clone()):m.material.clone();for(const material of Array.isArray(m.material)?m.material:[m.material]){const standard=material as THREE.MeshStandardMaterial;if(standard.emissive)standard.userData.roohEmission={color:standard.emissive.getHex(),intensity:standard.emissiveIntensity}}m.castShadow=true;m.receiveShadow=true;m.userData.home=m.position.clone()}});
    return clone;
  },[gltf.scene]);
  const {actions}=useAnimations(gltf.animations,scene);
  useEffect(()=>{const action=Object.values(actions)[0];if(!action)return;if(obj?.playAnimation)action.reset().fadeIn(.25).play();else action.fadeOut(.2).stop();return()=>{action.stop()}},[actions,obj?.playAnimation]);
  useEffect(()=>{if(!obj)return;const query=obj.selectedPart?.toLowerCase();scene.traverse(n=>{if(!(n as THREE.Mesh).isMesh)return;const m=n as THREE.Mesh,home=m.userData.home as THREE.Vector3;m.position.copy(home);if(obj.exploded&&m.parent){const world=new THREE.Vector3();m.getWorldPosition(world);m.position.add(world.normalize().multiplyScalar(.35))}const mats=Array.isArray(m.material)?m.material:[m.material];for(const material of mats){const mat=material as THREE.MeshStandardMaterial;if("emissive" in mat){const highlighted=Boolean(query&&n.name.toLowerCase().includes(query)),original=mat.userData.roohEmission;mat.emissive.set(highlighted?"#43e9ff":original?.color??0x000000);mat.emissiveIntensity=highlighted?1.8:original?.intensity??0}}})},[obj?.exploded,obj?.selectedPart,scene]);
  if(!obj)return null;
  return <group position={obj.position} rotation={obj.rotation} scale={obj.scale} onClick={e=>{e.stopPropagation();set({selectedId:id});const hit=e.object.name||e.object.parent?.name;if(hit)transform(id,{selectedPart:hit})}}><primitive object={scene}/></group>
}

function ModelPlaceholder({id}:{id:string}){
  const ref=useRef<THREE.Group>(null),obj=useRooH(s=>s.objects.find(o=>o.id===id)),set=useRooH(s=>s.set);
  useFrame((_,delta)=>{if(ref.current)ref.current.rotation.y+=delta*.32});
  if(!obj)return null;
  return <group ref={ref} position={obj.position} rotation={obj.rotation} scale={obj.scale*.72} onClick={e=>{e.stopPropagation();set({selectedId:id})}}>
    <mesh position={[0,0,0]} castShadow><icosahedronGeometry args={[1.15,2]}/><meshStandardMaterial color="#20bfe4" emissive="#087d9d" emissiveIntensity={1.25} metalness={.45} roughness={.25} wireframe/></mesh>
    <mesh rotation={[Math.PI/2,0,0]}><torusGeometry args={[1.48,.035,10,96]}/><meshBasicMaterial color="#77efff" transparent opacity={.8}/></mesh>
    <mesh rotation={[0,0,Math.PI/2]}><torusGeometry args={[1.3,.02,10,96]}/><meshBasicMaterial color="#8775ff" transparent opacity={.55}/></mesh>
    <pointLight color="#62e9ff" intensity={5} distance={5}/>
  </group>
}

class ModelLoadBoundary extends Component<{id:string;children:ReactNode;fallback:ReactNode},{failed:boolean}>{
  state={failed:false};
  static getDerivedStateFromError(){return{failed:true}}
  componentDidCatch(error:Error){useRooH.getState().set({error:`External 3D file unavailable; showing the built-in preview. ${error.message}`})}
  render(){return this.state.failed?this.props.fallback:this.props.children}
}
function ModelBoundary({id,url}:{id:string;url:string}){const fallback=<ModelPlaceholder id={id}/>;return <ModelLoadBoundary id={id} fallback={fallback}><Suspense fallback={fallback}><LoadedModel id={id} url={url}/></Suspense></ModelLoadBoundary>}
function StudioLighting(){
  const {gl,scene}=useThree();
  useEffect(()=>{
    const generator=new THREE.PMREMGenerator(gl),room=new RoomEnvironment();
    const environment=generator.fromScene(room,.04),previous=scene.environment;
    scene.environment=environment.texture;
    room.dispose();generator.dispose();
    return()=>{scene.environment=previous;environment.dispose()};
  },[gl,scene]);
  return null;
}
function CosmicUniverse(){
  const group=useRef<THREE.Group>(null),quality=useRooH(s=>s.quality);
  const geometry=useMemo(()=>{
    const count=quality==="high"?4200:1800,positions=new Float32Array(count*3),colors=new Float32Array(count*3),palette=[new THREE.Color("#00d9ff"),new THREE.Color("#7655ff"),new THREE.Color("#d9f7ff")];
    for(let i=0;i<count;i++){const arm=i%5,turn=seeded(i*4)*Math.PI*7,r=3+Math.pow(seeded(i*4+1),.65)*44,jitter=(seeded(i*4+2)-.5)*3.8,a=turn+arm*Math.PI*.4;positions[i*3]=Math.cos(a)*r+jitter;positions[i*3+1]=(seeded(i*4+3)-.5)*10+r*.045*Math.sin(a*2);positions[i*3+2]=Math.sin(a)*r+jitter;const c=palette[i%palette.length];colors.set([c.r,c.g,c.b],i*3)}
    const points=new THREE.BufferGeometry();points.setAttribute("position",new THREE.BufferAttribute(positions,3));points.setAttribute("color",new THREE.BufferAttribute(colors,3));return points;
  },[quality]);
  useEffect(()=>()=>geometry.dispose(),[geometry]);
  useFrame((state,delta)=>{if(group.current){group.current.rotation.y+=delta*.0025;group.current.rotation.z=Math.sin(state.clock.elapsedTime*.035)*.025}});
  return <group ref={group}><points geometry={geometry}><pointsMaterial size={.075} vertexColors transparent opacity={.72} sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending}/></points><Stars radius={110} depth={70} count={quality==="high"?2600:1100} factor={3} fade speed={.12}/>{[[18,5,-30],[-28,-3,-42],[32,8,-55]].map((p,i)=><group key={i} position={p as [number,number,number]} rotation={[1.15,i*.7,.2]}><mesh><ringGeometry args={[1.3,8,96]}/><meshBasicMaterial color={i===1?"#7655ff":"#178bff"} transparent opacity={.07} side={THREE.DoubleSide} depthWrite={false}/></mesh><pointLight color={i===1?"#7655ff":"#00d9ff"} intensity={8} distance={18}/></group>)}</group>
}
const hubView = { radius: 8.6, far: 11.5, minPitch: 1.31, maxPitch: 1.51, yaw: 0.86 };
const hubZooms: Record<string, number> = { closer: 7.6, core: hubView.radius, network: 10.2, universe: 11.5, galaxy: 11.5 };

function SceneCameraDirector({ reduced }: { reduced: boolean }) {
  const { camera, size, invalidate } = useThree();
  const compact = useRooH(state => state.objects.length > 0);
  const aspect = size.width / Math.max(1, size.height);
  const yawLimit = compact ? 0.48 : hubView.yaw;
  const targetX = compact ? (aspect < 0.8 ? -0.63 : -0.95) : 0;
  const platformScale = THREE.MathUtils.clamp(aspect / 0.78, 0.65, 1);
  const stageHalfWidth = 2.74 * platformScale + (compact ? (aspect < 0.8 ? 0.2 : 1.15) : 0.1);
  const minDistance = THREE.MathUtils.clamp(1.3 + stageHalfWidth / (0.424 * Math.max(0.36, aspect)),
    compact ? 8.9 : 7.6, 11.2);
  const controls = useRef<OrbitControlsImpl>(null);
  const destination = useRef<number>();
  const previous = useRef<{ x: number; y: number; spread?: number }>();
  const offset = useMemo(() => new THREE.Vector3(), []);
  const spherical = useMemo(() => new THREE.Spherical(), []);
  const target = useMemo<[number, number, number]>(() => [targetX, 0.15, 0], [targetX]);

  useEffect(() => {
    const navigate = (event: Event) => {
      const name = (event as CustomEvent<{ destination: string }>).detail.destination;
      destination.current = hubZooms[name] ?? hubView.radius;
      invalidate();
    };
    const reset = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !controls.current) return;
      destination.current = undefined;
      previous.current = undefined;
      camera.position.set(targetX, 1.1, Math.max(hubView.radius, minDistance));
      controls.current.update();
      invalidate();
    };
    window.addEventListener("rooh:navigate", navigate);
    window.addEventListener("keydown", reset);
    return () => {
      window.removeEventListener("rooh:navigate", navigate);
      window.removeEventListener("keydown", reset);
    };
  }, [camera, invalidate, minDistance, targetX]);

  useEffect(() => {
    controls.current?.update();
    invalidate();
  }, [invalidate, minDistance, targetX, yawLimit]);

  useFrame((_, delta) => {
    const control = controls.current;
    if (!control) return;
    const { gesture, selectedId } = useRooH.getState();
    const dt = Math.min(delta, 0.05);
    spherical.setFromVector3(offset.copy(camera.position).sub(control.target));
    let changed = false;
    if (!selectedId && gesture?.hands === 2 && gesture.spread !== undefined) {
      if (previous.current?.spread !== undefined) {
        const change = gesture.spread - previous.current.spread;
        if (Math.abs(change) > 0.002) {
          spherical.radius -= change * 13;
          destination.current = undefined;
          changed = true;
        }
      }
      previous.current = { ...gesture.pointer, spread: gesture.spread };
    } else if (gesture?.pinching && gesture.target === "scene") {
      if (previous.current && previous.current.spread === undefined) {
        spherical.theta -= (gesture.pointer.x - previous.current.x) * 3.2;
        spherical.phi += (gesture.pointer.y - previous.current.y) * 2.4;
        destination.current = undefined;
        changed = true;
      }
      previous.current = { ...gesture.pointer };
    } else {
      previous.current = undefined;
    }
    if (destination.current !== undefined) {
      const radius = THREE.MathUtils.clamp(destination.current, minDistance, hubView.far);
      spherical.radius = reduced ? radius : THREE.MathUtils.damp(spherical.radius, radius, 3, dt);
      if (Math.abs(spherical.radius - radius) < 0.02) destination.current = undefined;
      changed = true;
    }
    if (!changed) return;
    spherical.radius = THREE.MathUtils.clamp(spherical.radius, minDistance, hubView.far);
    spherical.phi = THREE.MathUtils.clamp(spherical.phi, hubView.minPitch, hubView.maxPitch);
    spherical.theta = THREE.MathUtils.clamp(spherical.theta, -yawLimit, yawLimit);
    camera.position.copy(offset.setFromSpherical(spherical).add(control.target));
    control.update();
  });

  return <OrbitControls ref={controls} makeDefault enableDamping={!reduced} dampingFactor={0.08}
    enablePan={false} minDistance={minDistance} maxDistance={hubView.far}
    minPolarAngle={hubView.minPitch} maxPolarAngle={hubView.maxPitch}
    minAzimuthAngle={-yawLimit} maxAzimuthAngle={yawLimit}
    target={target} onStart={() => { destination.current = undefined; }}/>;
}
function AdaptiveGraphicsController(){
  const elapsed=useRef(0),slow=useRef(0),average=useRef(.016);
  useFrame((_,delta)=>{
    if(delta>.2)return;
    const dt=Math.min(delta,.05);elapsed.current+=dt;
    average.current=average.current*.96+dt*.04;
    if(elapsed.current<8)return;
    slow.current=average.current>.034?slow.current+dt:Math.max(0,slow.current-dt);
    if(slow.current<6)return;
    const {quality,set}=useRooH.getState();
    if(quality!=="low")set({quality:quality==="high"?"balanced":"low"});
    elapsed.current=0;slow.current=0;average.current=.016;
  });
  return null;
}
function World({entry,reduced}:{entry:"dormant"|"permission"|"awakening"|"returning"|"active";reduced:boolean}){const objects=useRooH(s=>s.objects),set=useRooH(s=>s.set),quality=useRooH(s=>s.quality);return <><StudioLighting/><SceneCameraDirector reduced={reduced}/><AdaptiveGraphicsController/><NeuralLab profile={quality} entry={entry} reduced={reduced}/>{objects.map(o=><group key={o.id} name={`rooh-object:${o.id}`}>{o.kind==="solar-system"?<SolarSystem id={o.id}/>:o.kind==="earth"?<Earth id={o.id}/>:o.kind==="jet-engine"?<JetEngine id={o.id}/>:o.kind==="geometry"?<ProceduralModel id={o.id}/>:o.kind==="model"?(o.assetUrl?<ModelBoundary id={o.id} url={o.assetUrl}/>:<ModelPlaceholder id={o.id}/>):null}</group>)}<mesh visible={false} onClick={()=>set({selectedId:undefined})}><sphereGeometry args={[3]}/><meshBasicMaterial/></mesh></>}
export function CoreScene({entry}:{entry:"dormant"|"permission"|"awakening"|"returning"|"active"}){const quality=useRooH(s=>s.quality),set=useRooH(s=>s.set),[visible,setVisible]=useState(true),[reduced,setReduced]=useState(false),dpr=useMemo<[number,number]>(()=>quality==="high"?[1,Math.min(2,devicePixelRatio)]:quality==="balanced"?[.85,1.2]:[.7,1],[quality]);useEffect(()=>{const query=matchMedia("(prefers-reduced-motion: reduce)"),update=()=>setReduced(query.matches),visibility=()=>setVisible(!document.hidden);update();visibility();query.addEventListener("change",update);document.addEventListener("visibilitychange",visibility);return()=>{query.removeEventListener("change",update);document.removeEventListener("visibilitychange",visibility)}},[]);return <Canvas shadows={quality==="high"} dpr={dpr} frameloop={visible&&!reduced?"always":"demand"} camera={{position:[0,1.1,8.6],fov:46}} gl={{antialias:quality!=="low",powerPreference:"high-performance",alpha:false}} onPointerMissed={()=>set({selectedId:undefined})}><Suspense fallback={null}><World entry={entry} reduced={reduced}/></Suspense></Canvas>}
