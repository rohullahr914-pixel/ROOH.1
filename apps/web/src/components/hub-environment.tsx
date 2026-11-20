"use client";
import {Text,useGLTF} from "@react-three/drei";
import {useFrame} from "@react-three/fiber";
import {useMemo,useRef,useState} from "react";
import * as THREE from "three";
import {clone as cloneSkeleton} from "three/examples/jsm/utils/SkeletonUtils.js";
import {useRooH} from "@/lib/store";
import {waOpen} from "@/lib/whatsapp";

type Profile = "low"|"balanced"|"high";
type GateKind = "knowledge"|"youtube"|"models"|"whatsapp"|"website"|"trading";
type GateDefinition = {kind:GateKind;title:string;angle:number;color:string};

export const GATE_DEFINITIONS:readonly GateDefinition[]=[
  {kind:"youtube",title:"MEDIA",angle:0,color:"#ff7568"},
  {kind:"knowledge",title:"KNOWLEDGE",angle:Math.PI/3,color:"#65e9f2"},
  {kind:"models",title:"3D MODELS",angle:Math.PI*2/3,color:"#ad8cff"},
  {kind:"whatsapp",title:"WHATSAPP",angle:Math.PI,color:"#58d68d"},
  {kind:"website",title:"BUILD WEBSITE",angle:Math.PI*4/3,color:"#f0b86a"},
  {kind:"trading",title:"MARKETS",angle:Math.PI*5/3,color:"#7da8ff"},
] as const;

const metal={color:"#30424c",metalness:.72,roughness:.42};
const darkMetal={color:"#172630",metalness:.64,roughness:.48};

function DistantStars({profile}:{profile:Profile}){
  const stars=useRef<THREE.Points>(null);
  const positions=useMemo(()=>{
    const count=profile==="low"?70:profile==="balanced"?130:220;
    const points=new Float32Array(count*3);
    for(let i=0;i<count;i++){
      const angle=i*2.399963229728653;
      const height=2*((i+.5)/count)-1;
      const radius=27+(i*17%8);
      const spread=Math.sqrt(1-height*height);
      points[i*3]=Math.cos(angle)*spread*radius;
      points[i*3+1]=height*radius;
      points[i*3+2]=Math.sin(angle)*spread*radius;
    }
    return points;
  },[profile]);
  useFrame((_,delta)=>{if(stars.current)stars.current.rotation.y+=delta*.0025});
  return <points ref={stars}>
    <bufferGeometry><bufferAttribute attach="attributes-position" args={[positions,3]}/></bufferGeometry>
    <pointsMaterial color="#9dc6d4" size={profile==="low"?.045:.065} transparent opacity={.55} sizeAttenuation depthWrite={false}/>
  </points>;
}

const robotModels:Record<GateKind,string>={
  youtube:"/robots/adorable-chubby-robot.glb",
  knowledge:"/robots/cute_robot.glb",
  models:"/robots/mini_robot.glb",
  whatsapp:"/robots/futuristic_mini_robot_assistant.glb",
  website:"/robots/cute__cartoon_robot.glb",
  trading:"/robots/cute_robot_companion_glb.glb",
};
function DoorRobot({gate,reduced}:{gate:GateDefinition;reduced:boolean}){
  const root = useRef<THREE.Group>(null);
  const cameraInRoom = useMemo(() => new THREE.Vector3(), []);
  const gltf = useGLTF(robotModels[gate.kind]);
  const robot = useMemo(()=>{
    const copy=cloneSkeleton(gltf.scene);
    copy.traverse(node=>{
      if(!(node as THREE.Mesh).isMesh)return;
      const mesh=node as THREE.Mesh;
      mesh.castShadow=true;mesh.receiveShadow=true;
    });
    const bounds=new THREE.Box3().setFromObject(copy);
    const size=bounds.getSize(new THREE.Vector3());
    const scale=1.42/Math.max(size.x,size.y,size.z,0.001);
    copy.scale.setScalar(scale);
    copy.position.set(-(bounds.min.x+bounds.max.x)*scale/2,-bounds.min.y*scale,-(bounds.min.z+bounds.max.z)*scale/2);
    return copy;
  },[gltf.scene]);
  useFrame(({camera,clock},delta) => {
    const pose = root.current;
    if (!pose?.parent) return;

    camera.getWorldPosition(cameraInRoom);
    pose.parent.worldToLocal(cameraInRoom);
    const facing = Math.atan2(cameraInRoom.x, cameraInRoom.z);
    if (reduced) {
      pose.position.set(0, 0, 0);
      pose.rotation.set(0, facing, 0, "YXZ");
      pose.scale.setScalar(1);
      return;
    }

    // These models have no skeleton or clips, so each role gets a readable
    // whole-body performance while its feet remain aligned to the small base.
    const time = clock.elapsedTime;
    const phase = time + gate.angle * 1.7;
    let x=0,y=0,pitch=0,roll=0,yawOffset=0,squash=1;
    switch(gate.kind){
      case "youtube": { // upbeat presenter / playback rhythm
        const beat=Math.max(0,Math.sin(phase*3.1))**8;
        x=Math.sin(phase*1.55)*.075;y=beat*.11;
        roll=Math.sin(phase*3.1)*.085;yawOffset=Math.sin(phase*1.55)*.18;
        squash=1-beat*.045;
        break;
      }
      case "knowledge": { // deliberate reading and thoughtful nod
        const page=Math.sin(phase*.72);
        x=page*.035;pitch=-.07+Math.sin(phase*1.42)*.055;
        roll=Math.sin(phase*.72)*.035;yawOffset=page*.23;
        break;
      }
      case "models": { // turntable-style 3D inspection
        x=Math.sin(phase*1.08)*.055;y=Math.max(0,Math.sin(phase*2.16))**10*.055;
        pitch=Math.sin(phase*1.08)*.04;roll=-Math.sin(phase*1.08)*.07;
        yawOffset=Math.sin(phase*.54)*.5;
        break;
      }
      case "whatsapp": { // friendly acknowledgement / message wave
        const wave=Math.sin(phase*2.45);
        x=wave*.06;y=Math.max(0,wave)**8*.075;
        pitch=Math.sin(phase*1.22)*.035;roll=wave*.1;yawOffset=Math.sin(phase*1.22)*.16;
        break;
      }
      case "website": { // focused typing cadence
        const type=Math.sin(phase*5.4);
        x=Math.sin(phase*1.35)*.025;y=Math.abs(type)*.018;
        pitch=-.075+Math.abs(type)*.025;roll=type*.035;yawOffset=Math.sin(phase*.68)*.12;
        squash=1-Math.abs(type)*.012;
        break;
      }
      case "trading": { // alert market scan from side to side
        const scan=Math.sin(phase*1.9);
        x=scan*.045;y=Math.max(0,Math.sin(phase*3.8))**12*.045;
        pitch=Math.cos(phase*3.8)*.025;roll=-scan*.045;yawOffset=scan*.42;
        break;
      }
    }
    const yaw = facing + yawOffset;
    const turn = Math.atan2(Math.sin(yaw - pose.rotation.y), Math.cos(yaw - pose.rotation.y));
    pose.position.set(x,y,0);
    pose.rotation.set(pitch,pose.rotation.y+turn*(1-Math.exp(-5*delta)),roll,"YXZ");
    pose.scale.set(1+(1-squash)*.45,squash,1+(1-squash)*.45);
  });
  return <group position={[-3.85,-2.02,13.34]} scale={1.04}>
    <group name={`rooh-robot:${gate.kind}`} ref={root} rotation={[0,Math.PI,0,"YXZ"]}><primitive object={robot}/></group>
    <RobotTaskEffect kind={gate.kind} color={gate.color} reduced={reduced}/>
    <mesh position={[0,-.08,0]}><cylinderGeometry args={[.5,.58,.14,40]}/><meshStandardMaterial color="#203441" metalness={.82} roughness={.24}/></mesh>
    <mesh position={[0,.005,0]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[.39,.47,40]}/><meshBasicMaterial color={gate.color} transparent opacity={.9}/></mesh>
    <Text position={[0,.12,-.57]} rotation={[0,Math.PI,0]} fontSize={.085} letterSpacing={.06} color="#f2ffff" anchorX="center">{gate.title}</Text>
    <pointLight position={[0,.9,.3]} color={gate.color} intensity={1.15} distance={2.5}/>
  </group>;
}

function RobotTaskEffect({kind,color,reduced}:{kind:GateKind;color:string;reduced:boolean}){
  const effect=useRef<THREE.Group>(null);
  useFrame(({clock})=>{
    if(!effect.current)return;
    const t=clock.elapsedTime;
    effect.current.rotation.y=reduced?0:t*(kind==="models"?.85:kind==="knowledge"?.42:.18);
    effect.current.position.y=reduced?0:Math.sin(t*(kind==="youtube"?2.8:1.25))*.035;
  });
  return <group ref={effect} position={[0,0,0]}>
    {kind==="youtube"&&<group position={[.72,.66,0]}>{[.18,.34,.52].map((h,i)=><mesh key={h} position={[(i-1)*.13,h/2,0]}><boxGeometry args={[.075,h,.04]}/><meshBasicMaterial color={color} transparent opacity={.82}/></mesh>)}</group>}
    {kind==="knowledge"&&<group position={[0,.78,0]} rotation={[Math.PI/2,0,0]}><mesh><torusGeometry args={[.72,.018,6,48]}/><meshBasicMaterial color={color} transparent opacity={.7}/></mesh><mesh position={[.72,0,0]}><sphereGeometry args={[.065,12,8]}/><meshBasicMaterial color="#eaffff"/></mesh></group>}
    {kind==="models"&&<mesh position={[.75,.72,0]} rotation={[.4,.4,0]}><boxGeometry args={[.33,.33,.33]}/><meshBasicMaterial color={color} wireframe transparent opacity={.88}/></mesh>}
    {kind==="whatsapp"&&<group position={[.68,.86,0]}><mesh><circleGeometry args={[.22,24]}/><meshBasicMaterial color={color} transparent opacity={.76}/></mesh><mesh position={[.13,-.18,0]} rotation={[0,0,-.45]}><circleGeometry args={[.08,3]}/><meshBasicMaterial color={color} transparent opacity={.76}/></mesh>{[-.08,0,.08].map(x=><mesh key={x} position={[x,.015,-.01]}><circleGeometry args={[.023,10]}/><meshBasicMaterial color="#effff8"/></mesh>)}</group>}
    {kind==="website"&&<group position={[.73,.62,0]}><mesh><planeGeometry args={[.52,.38]}/><meshBasicMaterial color="#102833" transparent opacity={.92}/></mesh><mesh position={[0,.13,-.01]}><planeGeometry args={[.46,.055]}/><meshBasicMaterial color={color}/></mesh>{[-.07,.03].map(y=><mesh key={y} position={[-.06,y,-.01]}><planeGeometry args={[.27,.025]}/><meshBasicMaterial color="#d8f5f7" transparent opacity={.75}/></mesh>)}</group>}
    {kind==="trading"&&<group position={[.74,.7,0]}>{[-.18,0,.18].map((x,i)=><group key={x} position={[x,0,0]}><mesh><boxGeometry args={[.025,.5,.025]}/><meshBasicMaterial color={i===1?"#ff718e":"#57f2ca"}/></mesh><mesh position={[0,(i-1)*.09,0]}><boxGeometry args={[.11,.16+i*.04,.045]}/><meshBasicMaterial color={i===1?"#ff718e":"#57f2ca"}/></mesh></group>)}</group>}
  </group>;
}

function RoomSystems({gate}:{gate:GateDefinition}){
  const scanner=useRef<THREE.Mesh>(null),screen=useRef<THREE.Group>(null);
  useFrame((state,delta)=>{if(scanner.current)scanner.current.position.y=-1.45+(Math.sin(state.clock.elapsedTime*1.25)+1)*1.35;if(screen.current)screen.current.rotation.y=Math.sin(state.clock.elapsedTime*.55)*.05;});
  return <group>
    <group ref={screen} position={[-3.7,.75,16.72]}><mesh><boxGeometry args={[2.45,1.55,.08]}/><meshStandardMaterial color="#9fdfea" transparent opacity={.18} roughness={.18}/></mesh><Text position={[0,.48,-.06]} rotation={[0,Math.PI,0]} fontSize={.12} color={gate.color} letterSpacing={.08}>{gate.title} SYSTEM</Text>{[-.25,0,.25].map((y,i)=><mesh key={y} position={[0,y-.12,-.06]}><planeGeometry args={[1.85,.025]}/><meshBasicMaterial color={i===1?gate.color:"#d5f7fa"} transparent opacity={.48}/></mesh>)}</group>
    <mesh ref={scanner} position={[4.9,0,16.7]}><boxGeometry args={[.055,1.35,.055]}/><meshBasicMaterial color={gate.color} transparent opacity={.8}/></mesh>
    {[-5.25,5.25].map(x=><group key={x} position={[x,.6,15.1]}><mesh><tubeGeometry args={[new THREE.CatmullRomCurve3([new THREE.Vector3(0,-2,0),new THREE.Vector3(x<0?.22:-.22,0,.2),new THREE.Vector3(0,2.5,0)]),24,.025,8,false]}/><meshBasicMaterial color={gate.color} transparent opacity={.56}/></mesh></group>)}
  </group>;
}

function RoomWorkstation({gate}:{gate:GateDefinition}){
  const label={youtube:"MEDIA CONSOLE",knowledge:"KNOWLEDGE ARCHIVE",models:"FABRICATION DESK",whatsapp:"COMMS STATION",website:"CREATION DESK",trading:"MARKET TERMINAL"}[gate.kind];
  return <group position={[3.35,-1.65,14.9]}>
    <mesh position={[0,.42,0]}><boxGeometry args={[2.75,.12,1.05]}/><meshStandardMaterial color="#263b46" metalness={.7} roughness={.3}/></mesh>
    {[-1.05,1.05].map(x=><mesh key={x} position={[x,-.25,.18]}><boxGeometry args={[.1,1.25,.1]}/><meshStandardMaterial color="#617780" metalness={.82}/></mesh>)}
    <mesh position={[0,1.12,.25]} rotation={[-.12,0,0]}><boxGeometry args={[2.15,1.12,.08]}/><meshStandardMaterial color="#132834" metalness={.55}/></mesh>
    <mesh position={[0,1.12,.2]} rotation={[-.12,0,0]}><planeGeometry args={[1.98,.94]}/><meshBasicMaterial color={gate.color} transparent opacity={.32}/></mesh>
    <Text position={[0,1.35,.14]} rotation={[0,Math.PI,0]} fontSize={.1} color="#efffff" letterSpacing={.06}>{label}</Text>
    {gate.kind==="trading"&&[-.58,-.3,-.02,.26,.54].map((x,i)=><mesh key={x} position={[x,.95,.12]}><planeGeometry args={[.09,.22+i*.08]}/><meshBasicMaterial color={i%2?"#ff718e":"#57f2ca"}/></mesh>)}
    {gate.kind==="website"&&<group position={[0,.95,.12]}>{[-.48,0,.48].map((x,i)=><mesh key={x} position={[x,0,0]}><planeGeometry args={[.36,.32+i*.14]}/><meshBasicMaterial color={["#f0b86a","#7bd9e4","#9b82ff"][i]} transparent opacity={.62}/></mesh>)}</group>}
  </group>;
}

function GateBackdrop({gate,reduced}:{gate:GateDefinition;reduced:boolean}){
  const rooms:Record<GateKind,{wall:string;side:string;floor:string;ceiling:string}>={
    youtube:{wall:"#432b32",side:"#34252d",floor:"#29252c",ceiling:"#50333a"},
    knowledge:{wall:"#194652",side:"#173b47",floor:"#19333d",ceiling:"#245965"},
    models:{wall:"#392f5c",side:"#2d2949",floor:"#292b43",ceiling:"#46396c"},
    whatsapp:{wall:"#1c4b3e",side:"#183d35",floor:"#1a3531",ceiling:"#275c4d"},
    website:{wall:"#503c25",side:"#423522",floor:"#353128",ceiling:"#604a2e"},
    trading:{wall:"#203b66",side:"#1b3155",floor:"#1b2c49",ceiling:"#294875"},
  },room=rooms[gate.kind];
  return <group rotation={[0,gate.angle,0]}>
    <mesh position={[0,.85,17.2]}><boxGeometry args={[12.4,6.8,.22]}/><meshStandardMaterial color={room.wall} metalness={.28} roughness={.62}/></mesh>
    <mesh position={[0,.85,17.07]}>
      <planeGeometry args={[12.05,6.45]}/>
      <shaderMaterial transparent depthWrite={false} side={THREE.DoubleSide}
        uniforms={{glowColor:{value:new THREE.Color(gate.color)}}}
        vertexShader="varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}"
        fragmentShader="uniform vec3 glowColor; varying vec2 vUv; void main(){float d=length((vUv-.5)*2.0); float a=.08+pow(max(0.0,1.0-d),2.2)*.24; gl_FragColor=vec4(glowColor,a);}"/>
    </mesh>
    <mesh position={[0,-2.16,14.9]}><boxGeometry args={[12.4,.2,4.7]}/><meshStandardMaterial color={room.floor} metalness={.48} roughness={.42}/></mesh>
    <mesh position={[0,4.02,14.9]}><boxGeometry args={[12.4,.2,4.7]}/><meshStandardMaterial color={room.ceiling} metalness={.35} roughness={.55}/></mesh>
    <mesh position={[-6.1,.92,14.9]}><boxGeometry args={[.2,6.2,4.7]}/><meshStandardMaterial color={room.side} metalness={.34} roughness={.58}/></mesh>
    <mesh position={[6.1,.92,14.9]}><boxGeometry args={[.2,6.2,4.7]}/><meshStandardMaterial color={room.side} metalness={.34} roughness={.58}/></mesh>
    <mesh position={[0,3.86,14.05]} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[5.2,.9]}/><meshBasicMaterial color={gate.color} transparent opacity={.5}/></mesh>
    <pointLight position={[0,2.75,14.15]} color="#f1fbff" intensity={2.25} distance={7}/>
    {gate.kind==="youtube"&&<group>
      {[[-2.15,.95,15.45,-.16],[-.72,.2,15.8,.08],[1.05,1.15,15.55,-.05],[2.25,-.15,15.7,.14]].map((p,i)=><group key={i} position={[p[0],p[1],p[2]]} rotation={[0,p[3],0]}>
        <mesh><boxGeometry args={[1.35,.82,.08]}/><meshStandardMaterial color="#172a35" metalness={.62} roughness={.28}/></mesh>
        <mesh position={[0,0,-.046]}><planeGeometry args={[1.18,.65]}/><meshBasicMaterial color={i%2?"#f4a36c":"#ff7568"} transparent opacity={.26}/></mesh>
        <mesh position={[0,0,-.052]} rotation={[0,0,-Math.PI/2]}><circleGeometry args={[.16,3]}/><meshBasicMaterial color="#fff4e8" transparent opacity={.88}/></mesh>
      </group>)}
      {[[-2.5,-1.35],[0,-1.48],[2.5,-1.3]].map((p,i)=><mesh key={i} position={[p[0],p[1],15.35]}><boxGeometry args={[1.35,.06,.12]}/><meshBasicMaterial color="#ff7568" transparent opacity={.5}/></mesh>)}
    </group>}
    {gate.kind==="knowledge"&&<group>
      {[-2.45,-1.45,1.45,2.45].map((x,i)=><group key={x} position={[x,.1,15.75]}>
        <mesh><boxGeometry args={[.12,4.7,.36]}/><meshStandardMaterial color="#49616c" metalness={.72} roughness={.34}/></mesh>
        {[-1.75,-.9,-.05,.8,1.65].map((y,j)=><mesh key={y} position={[i<2?.48:-.48,y,-.22]} rotation={[0,0,(j%3-1)*.06]}><boxGeometry args={[.68,.55,.16]}/><meshStandardMaterial color={["#65e9f2","#d5c382","#659ab8"][j%3]} emissive={j===0?"#174c53":"#000"} emissiveIntensity={.5}/></mesh>)}
      </group>)}
      <mesh position={[0,.35,15.55]}><icosahedronGeometry args={[1.08,2]}/><meshBasicMaterial color="#65e9f2" wireframe transparent opacity={.34}/></mesh>
      <pointLight position={[0,.35,15.1]} color="#65e9f2" intensity={2.1} distance={4}/>
    </group>}
    {gate.kind==="models"&&<group>
      <mesh position={[-1.9,.55,15.45]} rotation={[.35,.5,.15]}><icosahedronGeometry args={[.95,1]}/><meshStandardMaterial color="#664ca3" emissive="#321b73" emissiveIntensity={.8} metalness={.65} roughness={.2} wireframe/></mesh>
      <mesh position={[0,-.15,15.72]} rotation={[.4,-.25,.2]}><torusKnotGeometry args={[.7,.2,72,10]}/><meshStandardMaterial color="#ad8cff" emissive="#43237e" emissiveIntensity={.7} metalness={.8} roughness={.18}/></mesh>
      <mesh position={[2.05,.72,15.5]} rotation={[.2,.7,.4]}><octahedronGeometry args={[.92,1]}/><meshStandardMaterial color="#7bc8dc" emissive="#173b56" emissiveIntensity={.7} metalness={.75} roughness={.25} wireframe/></mesh>
      {[-1.9,0,2.05].map(x=><mesh key={x} position={[x,-1.58,15.42]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[.72,.76,48]}/><meshBasicMaterial color="#ad8cff" transparent opacity={.62}/></mesh>)}
    </group>}
    {gate.kind==="whatsapp"&&<group>
      {[[-1.85,1.28,1.45],[1.15,.72,1.75],[-1.1,-.15,1.8],[1.8,-.75,1.35],[-.2,-1.2,1.5]].map((p,i)=><group key={i} position={[p[0],p[1],15.7]}>
        <mesh><planeGeometry args={[p[2],.58]}/><meshBasicMaterial color={i%2?"#58d68d":"#173d39"} transparent opacity={i%2?.7:.92}/></mesh>
        {[0,1,2].map(dot=><mesh key={dot} position={[-.24+dot*.24,0,-.01]}><circleGeometry args={[.035,12]}/><meshBasicMaterial color="#d9fff0" transparent opacity={.72}/></mesh>)}
      </group>)}
      <mesh position={[0,.25,16.05]}><ringGeometry args={[1.65,1.7,64]}/><meshBasicMaterial color="#58d68d" transparent opacity={.22}/></mesh>
      <pointLight position={[0,.2,15.1]} color="#58d68d" intensity={1.8} distance={4.5}/>
    </group>}
    {gate.kind==="website"&&<group>
      {[[-1.75,.85,1.75,1.25],[.15,.35,2.15,1.58],[2.05,1.05,1.35,.96]].map((p,i)=><group key={i} position={[p[0],p[1],15.7-i*.08]}>
        <mesh><boxGeometry args={[p[2],p[3],.07]}/><meshStandardMaterial color="#142b35" metalness={.55} roughness={.32}/></mesh>
        <mesh position={[0,p[3]/2-.12,-.04]}><planeGeometry args={[p[2]-.12,.1]}/><meshBasicMaterial color="#f0b86a" transparent opacity={.75}/></mesh>
        <mesh position={[0,-.03,-.042]}><planeGeometry args={[p[2]*.64,p[3]*.42]}/><meshBasicMaterial color={i===1?"#f0b86a":"#477183"} transparent opacity={i===1?.3:.42}/></mesh>
      </group>)}
      <mesh position={[0,-1.55,15.38]}><boxGeometry args={[4.8,.07,.18]}/><meshBasicMaterial color="#f0b86a" transparent opacity={.45}/></mesh>
    </group>}
    {gate.kind==="trading"&&<group>
      {[-1.5,-.75,0,.75,1.5].map(y=><mesh key={y} position={[0,y,15.92]}><planeGeometry args={[5.6,.015]}/><meshBasicMaterial color="#7da8ff" transparent opacity={.18}/></mesh>)}
      {[-2.4,-1.6,-.8,0,.8,1.6,2.4].map(x=><mesh key={x} position={[x,.05,15.9]}><planeGeometry args={[.015,4.1]}/><meshBasicMaterial color="#7da8ff" transparent opacity={.14}/></mesh>)}
      {[-2.1,-1.5,-.9,-.3,.3,.9,1.5,2.1].map((x,i)=>{const up=i%3!==1,color=up?"#57f2ca":"#ff718e",height=.45+(i%4)*.18,y=-.85+i*.22;return <group key={x} position={[x,y,15.65]}><mesh><boxGeometry args={[.08,height+.42,.04]}/><meshBasicMaterial color={color} transparent opacity={.72}/></mesh><mesh><boxGeometry args={[.35,height,.08]}/><meshStandardMaterial color={color} emissive={color} emissiveIntensity={.45}/></mesh></group>})}
      <pointLight position={[0,.25,15.15]} color="#7da8ff" intensity={1.9} distance={4.5}/>
    </group>}
    <RoomSystems gate={gate}/><RoomWorkstation gate={gate}/>
    <DoorRobot gate={gate} reduced={reduced}/>
    <pointLight position={[0,.3,14.2]} color={gate.color} intensity={1.1} distance={7}/>
  </group>;
}

Object.values(robotModels).forEach(url=>useGLTF.preload(url));

function Deck({radius=3.5}:{radius?:number}){return <group>
  <mesh receiveShadow position={[0,-2.27,0]}><cylinderGeometry args={[radius,radius+.28,.28,64]}/><meshStandardMaterial {...metal}/></mesh>
  <mesh receiveShadow position={[0,-2.11,0]} rotation={[-Math.PI/2,0,0]}><circleGeometry args={[radius-.12,64]}/><meshStandardMaterial {...darkMetal}/></mesh>
  <mesh position={[0,-2.105,0]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[radius-.17,radius-.14,64]}/><meshBasicMaterial color="#6ab9c2" transparent opacity={.55} depthWrite={false}/></mesh>
</group>}

function openGate(kind:GateKind,title:string){
  if(kind==="whatsapp")waOpen(true);
  else if(kind==="website")window.dispatchEvent(new CustomEvent("rooh:website-builder",{detail:{}}));
  else useRooH.getState().openPanel(kind,title);
  window.dispatchEvent(new CustomEvent("rooh:tool-action",{detail:{name:kind}}));
}

function PortalGate({gate}:{gate:GateDefinition}){
  const panels=useRooH(s=>s.panels),[hovered,setHovered]=useState(false);
  const active=gate.kind!=="whatsapp"&&panels.some(panel=>panel.kind===gate.kind),glow=active||hovered;
  const open=()=>openGate(gate.kind,gate.title);
  const marketCandles=[
    {x:-1.42,y:-.34,h:.48,wick:.78,up:true},
    {x:-.94,y:-.18,h:.62,wick:.9,up:true},
    {x:-.46,y:-.1,h:.38,wick:.7,up:false},
    {x:.02,y:.08,h:.72,wick:1.08,up:true},
    {x:.5,y:.27,h:.44,wick:.76,up:true},
    {x:.98,y:.18,h:.54,wick:.86,up:false},
    {x:1.46,y:.42,h:.66,wick:1.02,up:true},
  ];
  return <group rotation={[0,gate.angle,0]}>
    <group position={[0,.35,12.4]}>
      <group>
        <mesh castShadow receiveShadow position={[-5.08,0,0]}><boxGeometry args={[.38,6.8,.62]}/><meshStandardMaterial {...metal}/></mesh>
        <mesh castShadow receiveShadow position={[5.08,0,0]}><boxGeometry args={[.38,6.8,.62]}/><meshStandardMaterial {...metal}/></mesh>
        <mesh castShadow receiveShadow position={[0,3.2,0]}><boxGeometry args={[9.78,.38,.62]}/><meshStandardMaterial {...metal}/></mesh>
        <mesh castShadow receiveShadow position={[0,-3.2,0]}><boxGeometry args={[9.78,.38,.62]}/><meshStandardMaterial {...metal}/></mesh>
      </group>
      <mesh name={`rooh-room-selector:${gate.kind}`} position={[0,.05,-.315]} onClick={e=>{e.stopPropagation();open()}} onPointerOver={()=>{setHovered(true);document.body.style.cursor="pointer"}} onPointerOut={()=>{setHovered(false);document.body.style.cursor="auto"}}>
        <planeGeometry args={[9.78,6.05]}/><meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide}/>
      </mesh>
      <mesh position={[-2.4,.05,-.27]}><boxGeometry args={[4.72,5.86,.08]}/><meshStandardMaterial color={gate.color} transparent opacity={.12} roughness={.18} metalness={.24}/></mesh>
      <mesh position={[2.4,.05,-.27]}><boxGeometry args={[4.72,5.86,.08]}/><meshStandardMaterial color={gate.color} transparent opacity={.12} roughness={.18} metalness={.24}/></mesh>
      <mesh position={[0,.05,-.37]}><ringGeometry args={[.66,.69,48]}/><meshBasicMaterial color={gate.color} transparent opacity={glow?.9:.6} side={THREE.DoubleSide}/></mesh>
      <mesh position={[0,.05,-.38]}><circleGeometry args={[.46,48]}/><meshBasicMaterial color={gate.color} transparent opacity={glow?.25:.12} side={THREE.DoubleSide}/></mesh>
      <Text position={[0,1.02,-.4]} fontSize={.23} letterSpacing={.14} color="#edf7f8" anchorX="center" anchorY="middle" onClick={e=>{e.stopPropagation();open()}}>{gate.title}</Text>
      {gate.kind==="trading"&&<group position={[0,-.02,-.405]}>
        {[-.72,-.24,.24,.72].map(y=><mesh key={y} position={[0,y,0]}><planeGeometry args={[3.55,.008]}/><meshBasicMaterial color="#7da8ff" transparent opacity={.14}/></mesh>)}
        {marketCandles.map((c,index)=>{
          const color=c.up?"#57f2ca":"#ff718e";
          return <group key={index} position={[c.x,c.y,0]}>
            <mesh><planeGeometry args={[.035,c.wick]}/><meshBasicMaterial color={color} transparent opacity={.78}/></mesh>
            <mesh position={[0,c.up?.06:-.06,.006]}><planeGeometry args={[.25,c.h]}/><meshBasicMaterial color={color} transparent opacity={glow?.95:.74}/></mesh>
          </group>;
        })}
        <Text position={[-1.78,-1.04,.01]} fontSize={.105} letterSpacing={.1} color="#8ff4df" anchorX="left" anchorY="middle">READ-ONLY</Text>
        <Text position={[1.78,-1.04,.01]} fontSize={.105} letterSpacing={.08} color="#9db8ff" anchorX="right" anchorY="middle">XAU · FX · LIVE DATA</Text>
      </group>}
      {gate.kind==="website"&&<group position={[0,-.02,-.405]}>
        <mesh position={[0,.02,0]}><planeGeometry args={[3.6,1.48]}/><meshBasicMaterial color="#071822" transparent opacity={.12}/></mesh>
        <mesh position={[0,.72,.006]}><planeGeometry args={[3.6,.12]}/><meshBasicMaterial color="#f0b86a" transparent opacity={glow?.88:.52}/></mesh>
        {[-1.55,-1.36,-1.17].map((x,index)=><mesh key={x} position={[x,.72,.012]}><circleGeometry args={[.045,16]}/><meshBasicMaterial color={["#ff718e","#f6ca71","#63e4c1"][index]}/></mesh>)}
        <mesh position={[-1.08,.22,.01]}><planeGeometry args={[1.12,.72]}/><meshBasicMaterial color="#183447" transparent opacity={.95}/></mesh>
        <mesh position={[-1.08,.36,.018]}><planeGeometry args={[.68,.09]}/><meshBasicMaterial color="#f0b86a" transparent opacity={.82}/></mesh>
        <mesh position={[-1.08,.12,.018]}><planeGeometry args={[.82,.055]}/><meshBasicMaterial color="#9cc4cf" transparent opacity={.55}/></mesh>
        <mesh position={[-1.08,-.03,.018]}><planeGeometry args={[.6,.055]}/><meshBasicMaterial color="#9cc4cf" transparent opacity={.38}/></mesh>
        {[[-.12,.38,1.25,.16],[-.12,.1,1.25,.27],[-.44,-.28,.61,.28],[.2,-.28,.61,.28]].map((item,index)=><mesh key={index} position={[item[0],item[1],.012]}><planeGeometry args={[item[2],item[3]]}/><meshBasicMaterial color={index===0?"#f0b86a":index===1?"#30546a":"#1b3d50"} transparent opacity={index===0?.72:.9}/></mesh>)}
        <Text position={[-1.78,-.94,.018]} fontSize={.105} letterSpacing={.09} color="#ffd89d" anchorX="left" anchorY="middle">CREATION STUDIO</Text>
        <group position={[1.14,-.94,.018]}>
          <mesh position={[-.35,0,0]}><planeGeometry args={[.28,.18]}/><meshBasicMaterial color="#f0b86a" transparent opacity={.78}/></mesh>
          <mesh position={[.02,0,0]}><planeGeometry args={[.18,.18]}/><meshBasicMaterial color="#f0b86a" transparent opacity={.58}/></mesh>
          <mesh position={[.31,0,0]}><planeGeometry args={[.1,.18]}/><meshBasicMaterial color="#f0b86a" transparent opacity={.42}/></mesh>
        </group>
        <Text position={[1.78,-.94,.018]} fontSize={.095} letterSpacing={.07} color="#b6cbd2" anchorX="right" anchorY="middle">DESKTOP · TABLET · MOBILE</Text>
      </group>}
      <mesh position={[0,.05,-.335]}><planeGeometry args={[4.82,2.79]}/><meshBasicMaterial color={gate.color} transparent opacity={glow?.34:.12} depthWrite={false} side={THREE.DoubleSide}/></mesh>
      <mesh position={[0,-1.78,-.34]}><boxGeometry args={[4.7,.055,.03]}/><meshBasicMaterial color={gate.color} transparent opacity={glow?.95:.5} toneMapped={false}/></mesh>
      <pointLight position={[0,.2,-1]} color={gate.color} intensity={glow?2.2:.65} distance={6}/>
    </group>
    <mesh position={[0,-2.15,14.8]} receiveShadow><boxGeometry args={[3.2,.18,5.4]}/><meshStandardMaterial {...darkMetal}/></mesh>
  </group>
}

export function HubEnvironment({profile,reduced}:{profile:Profile;reduced:boolean}){
  return <group>
    <color attach="background" args={["#1c3441"]}/><fog attach="fog" args={["#1c3441",28,62]}/>
    <mesh position={[0,.82,0]}><cylinderGeometry args={[17.35,17.35,8.1,96,1,true]}/><meshStandardMaterial color="#273f4b" metalness={.18} roughness={.76} side={THREE.BackSide}/></mesh>
    <mesh position={[0,4.93,0]} rotation={[Math.PI/2,0,0]}><circleGeometry args={[17.25,96]}/><meshStandardMaterial color="#304a54" metalness={.32} roughness={.64} side={THREE.DoubleSide}/></mesh>
    <ambientLight color="#d8e8e9" intensity={.5}/><hemisphereLight args={["#b6d5dc","#17232b",.7]}/>
    <directionalLight position={[5,9,4]} color="#d6e6e5" intensity={1.2} castShadow={profile==="high"} shadow-mapSize={[1024,1024]} shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={12} shadow-camera-bottom={-12}/>
    <pointLight position={[-5,3,4]} color="#91c5c9" intensity={1} distance={13}/><pointLight position={[5,4,-3]} color="#d0ac78" intensity={.72} distance={13}/>
    <Deck radius={6.8}/><mesh position={[0,-2.48,0]} receiveShadow><cylinderGeometry args={[10.7,11,.22,96]}/><meshStandardMaterial {...darkMetal}/></mesh>
    {[7.2,9.7].map((r,i)=><mesh key={r} rotation={[-Math.PI/2,0,0]} position={[0,-2.34+i*.02,0]}><ringGeometry args={[r,r+.12,96]}/><meshStandardMaterial color={i?"#67777b":"#829191"} metalness={.72} roughness={.5}/></mesh>)}
    {GATE_DEFINITIONS.map(gate=><PortalGate key={gate.kind} gate={gate}/>)}
    {GATE_DEFINITIONS.map(gate=><GateBackdrop key={`${gate.kind}-backdrop`} gate={gate} reduced={reduced}/>)}
    <mesh position={[0,5.2,0]}><cylinderGeometry args={[7.6,7.6,.18,96]}/><meshStandardMaterial color="#4a6570" metalness={.58} roughness={.44}/></mesh>
    <mesh position={[0,5.0,0]} rotation={[-Math.PI/2,0,0]}><torusGeometry args={[5.5,.09,8,96]}/><meshStandardMaterial color="#b4a790" emissive="#c3aa7d" emissiveIntensity={.32} metalness={.65} roughness={.38}/></mesh>
    <mesh position={[0,4.97,0]} rotation={[-Math.PI/2,0,0]}><torusGeometry args={[6.35,.035,6,96]}/><meshBasicMaterial color="#85b9c1" transparent opacity={.65}/></mesh>
    <mesh position={[0,5.26,0]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[2.4,4.8,96]}/><meshStandardMaterial color="#4e626b" metalness={.68} roughness={.54} side={THREE.DoubleSide}/></mesh>
  </group>
}
