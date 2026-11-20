"use client";
import {Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode} from "react";
import {useFrame,useThree} from "@react-three/fiber";
import * as THREE from "three";
import {useRooH} from "@/lib/store";
import {LivingGlassAvatar} from "./living-glass-avatar";
import {ParticleFace} from "./particle-face";
import {HubEnvironment} from "./hub-environment";

type Profile = "low" | "balanced" | "high";
type Entry = "dormant" | "permission" | "awakening" | "returning" | "active";
const cyan = "#5beaff";
const gold = "#ffd099";

function motionState(voice: string, amplitude: number) {
  const activity = voice === "processing" ? 1 : voice === "speaking" ? .72 : voice === "listening" ? .52 : voice === "error" ? .32 : .14;
  return {activity, amplitude: Math.min(1, Math.max(0, amplitude))};
}

function IlluminatedRing({radius,tube,color,rotation=0}:{radius:number;tube:number;color:string;rotation?:number}) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_,delta) => {if (ref.current) ref.current.rotation.z += Math.min(delta,.05) * rotation;});
  return <mesh ref={ref} rotation={[-Math.PI / 2,0,0]}><torusGeometry args={[radius,tube,8,128,rotation ? Math.PI * 1.77 : Math.PI * 2]}/><meshBasicMaterial color={color} toneMapped={false}/></mesh>;
}

export function HolographicPlatform({entry,reduced}:{entry:Entry;reduced:boolean}) {
  const group = useRef<THREE.Group>(null), energy = useRef<THREE.PointLight>(null), beam = useRef<THREE.Mesh>(null);
  const {size}=useThree();
  const reveal = useRef(.8);
  const outputAmplitude=useRef(0);
  useEffect(() => {if(entry === "awakening" || entry === "returning") reveal.current = reduced ? 1 : 0;},[entry,reduced]);
  useEffect(() => {const onAudio=(event:Event)=>{outputAmplitude.current=(event as CustomEvent<number>).detail};window.addEventListener("rooh:output-amplitude",onAudio);return()=>window.removeEventListener("rooh:output-amplitude",onAudio)},[]);
  useFrame((state,delta) => {
    const {voice,amplitude}=useRooH.getState();
    const aspect=size.width/Math.max(1,size.height);
    const targetX=useRooH.getState().objects.length?(aspect<.8?-1.3:-2.35):0;
    if(group.current)group.current.position.x=reduced?targetX:THREE.MathUtils.damp(group.current.position.x,targetX,2,Math.min(delta,.05));
    if (entry === "active" || entry === "awakening" || entry === "returning") reveal.current = Math.min(1,reveal.current + Math.min(delta,.05) * (reduced ? 8 : .7));
    const framing=Math.max(.65,Math.min(1,aspect/.78));
    if (group.current) group.current.scale.setScalar((.7 + .3 * reveal.current)*framing);
    const amount = motionState(voice,voice==="speaking"?outputAmplitude.current:amplitude);
    if (energy.current) energy.current.intensity = .4 + reveal.current * (.8 + amount.activity * 1.2 + amount.amplitude * 2);
    if (beam.current) beam.current.scale.y = .25 + reveal.current * (reduced ? .35 : .5 + Math.sin(state.clock.elapsedTime * 2) * .04);
  });
  return <group ref={group} position={[0,-1.52,0]}>
    <mesh receiveShadow position={[0,-.19,0]}><cylinderGeometry args={[2.62,2.74,.32,96]}/><meshStandardMaterial color="#243847" metalness={.86} roughness={.24}/></mesh>
    <mesh position={[0,-.005,0]}><cylinderGeometry args={[2.2,2.34,.13,96]}/><meshStandardMaterial color="#395466" metalness={.9} roughness={.2}/></mesh>
    <mesh position={[0,.065,0]}><cylinderGeometry args={[1.72,1.85,.08,96]}/><meshStandardMaterial color="#071b2a" metalness={.84} roughness={.27}/></mesh>
    <mesh position={[0,.112,0]} rotation={[-Math.PI/2,0,0]}><circleGeometry args={[.65,64]}/><meshBasicMaterial color="#4be9f4" transparent opacity={.35} depthWrite={false}/></mesh>
    <group position={[0,.16,0]}>
      <IlluminatedRing radius={.77} tube={.026} color={cyan} rotation={reduced?0:.07}/>
      <IlluminatedRing radius={1.13} tube={.018} color={gold} rotation={reduced?0:-.05}/>
      <IlluminatedRing radius={1.54} tube={.025} color={cyan} rotation={reduced?0:.04}/>
      <IlluminatedRing radius={1.96} tube={.018} color={gold}/>
      <IlluminatedRing radius={2.35} tube={.028} color={cyan}/>
    </group>
    <mesh ref={beam} position={[0,.54,0]}><cylinderGeometry args={[.19,.36,1.1,32,1,true]}/><meshBasicMaterial color={cyan} transparent opacity={.08} side={THREE.DoubleSide} depthWrite={false}/></mesh>
    <pointLight ref={energy} position={[0,.48,0]} color={cyan} intensity={2} distance={5}/>
  </group>;
}

const semanticRegions=[
  {kind:"youtube",title:"Media",position:[-1.08,.87,.61] as [number,number,number],color:cyan},
  {kind:"knowledge",title:"Knowledge",position:[1.08,.93,.55] as [number,number,number],color:gold},
  {kind:"models",title:"3D Models",position:[-1.04,-.76,.63] as [number,number,number],color:gold},
  {kind:"vision",title:"Vision",position:[1.04,-.76,.63] as [number,number,number],color:cyan},
  {kind:"website",title:"Creation Studio",position:[0,1.38,.59] as [number,number,number],color:gold},
  {kind:"trading",title:"Markets",position:[0,-1.24,.65] as [number,number,number],color:cyan},
] as const;

function openSemanticRegion(kind:(typeof semanticRegions)[number]["kind"],title:string){
  if(kind==="website")window.dispatchEvent(new CustomEvent("rooh:website-builder",{detail:{}}));
  else useRooH.getState().openPanel(kind,title);
  window.dispatchEvent(new CustomEvent("rooh:tool-action",{detail:{name:kind}}));
}

export function GestureInteractionBridge(){
  const {camera,scene}=useThree();
  const raycaster=useMemo(()=>new THREE.Raycaster(),[]);
  useEffect(()=>{
    const pick=(event:Event)=>{
      const detail=(event as CustomEvent<{pointer:{x:number;y:number};objectId?:string;regionKind?:string}>).detail;
      raycaster.setFromCamera(new THREE.Vector2(detail.pointer.x*2-1,1-detail.pointer.y*2),camera);
      const targets:THREE.Object3D[]=[];
      scene.traverse(child=>{if(child.name.startsWith("rooh-object:")||child.name.startsWith("rooh-region:"))targets.push(child)});
      for(const hit of raycaster.intersectObjects(targets,true)){
        let ancestor:THREE.Object3D|null=hit.object;
        while(ancestor&&!ancestor.name.startsWith("rooh-object:")&&!ancestor.name.startsWith("rooh-region:"))ancestor=ancestor.parent;
        if(!ancestor)continue;
        if(ancestor.name.startsWith("rooh-object:")){detail.objectId=ancestor.name.slice(12);useRooH.getState().set({selectedId:detail.objectId});return;}
        const kind=ancestor.name.slice(12) as (typeof semanticRegions)[number]["kind"];
        const region=semanticRegions.find(item=>item.kind===kind);
        if(region){detail.regionKind=kind;openSemanticRegion(kind,region.title);return;}
      }
    };
    window.addEventListener("rooh:gesture-pick",pick);return()=>window.removeEventListener("rooh:gesture-pick",pick);
  },[camera,scene,raycaster]);
  return null;
}

export function NeuralSemanticRegions(){
  const root=useRef<THREE.Group>(null);
  useFrame((_,delta)=>{if(!root.current)return;const compact=useRooH.getState().objects.length>0;root.current.position.x=THREE.MathUtils.damp(root.current.position.x,compact?-2.35:0,2,Math.min(delta,.05));root.current.scale.setScalar(THREE.MathUtils.damp(root.current.scale.x,compact?.72:1,2,Math.min(delta,.05)));});
  return <group ref={root} position={[0,.64,0]}>{semanticRegions.map(region=><group key={region.kind} name={`rooh-region:${region.kind}`} position={region.position}>
    <mesh rotation={[0,.25,0]}><torusGeometry args={[.23,.014,5,64]}/><meshBasicMaterial color={region.color} transparent opacity={.68} depthWrite={false}/></mesh>
    <mesh onClick={event=>{event.stopPropagation();openSemanticRegion(region.kind,region.title);}} onPointerOver={()=>document.body.style.cursor="pointer"} onPointerOut={()=>document.body.style.cursor="auto"}><sphereGeometry args={[.24,12,8]}/><meshBasicMaterial transparent opacity={0} depthWrite={false}/></mesh>
  </group>)}</group>;
}

export function LaboratoryEnvironment({profile}:{profile:Profile}) {
  const ribs = profile === "low" ? 14 : 24;
  return <group>
    <color attach="background" args={["#101e2b"]}/>
    <fog attach="fog" args={["#172635",9,28]}/>
    <ambientLight intensity={.95} color="#a8d5ec"/>
    <hemisphereLight args={["#b9e9ff","#18303a",1.15]}/>
    <directionalLight position={[2,6,5]} color="#c9ebf9" intensity={1.6}/>
    <pointLight position={[-4,2,2]} color={cyan} intensity={2.2} distance={11}/>
    <pointLight position={[4,3,-3]} color={gold} intensity={2.4} distance={11}/>
    <mesh position={[0,0,-7.4]} rotation={[0,0,0]}><cylinderGeometry args={[8.8,8.8,9,64,1,true,0,Math.PI*2]}/><meshStandardMaterial color="#1b3040" metalness={.62} roughness={.38} side={THREE.BackSide}/></mesh>
    <mesh position={[0,-2.19,0]} receiveShadow><cylinderGeometry args={[11,11,.2,96]}/><meshStandardMaterial color="#172937" metalness={.68} roughness={.28}/></mesh>
    <mesh position={[0,4.8,0]}><cylinderGeometry args={[9,9,.12,96]}/><meshStandardMaterial color="#162735" metalness={.7} roughness={.33}/></mesh>
    {Array.from({length:ribs},(_,i) => {
      const a = i * Math.PI * 2 / ribs;
      return <group key={i} position={[Math.sin(a)*8.45,0,Math.cos(a)*8.45-7.4]} rotation={[0,a,0]}>
        <mesh><boxGeometry args={[.16,8.6,.28]}/><meshStandardMaterial color="#4d6772" metalness={.82} roughness={.25}/></mesh>
        {i % 2 === 0 && <mesh position={[0,0,.16]}><boxGeometry args={[.025,6.5,.015]}/><meshBasicMaterial color={cyan} transparent opacity={.37}/></mesh>}
      </group>;
    })}
    {[0,1,2].map(i => <group key={i} position={[0,4.65-i*.13,-.15]} rotation={[-Math.PI/2,0,0]}>
      <mesh><torusGeometry args={[4.8+i*.55,i===1?.065:.035,8,128]}/><meshStandardMaterial color={i===1?"#a79a82":"#7795a0"} emissive={i===1?gold:cyan} emissiveIntensity={i===1?2.2:.75} metalness={.5}/></mesh>
    </group>)}
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,-2.05,0]}><ringGeometry args={[3,5.7,96]}/><meshStandardMaterial color="#314858" metalness={.88} roughness={.21} side={THREE.DoubleSide}/></mesh>
    {[3.15,3.8,4.85,5.55].map((r,i) => <mesh key={i} rotation={[-Math.PI/2,0,0]} position={[0,-2.005+i*.002,0]}><torusGeometry args={[r,i%2?.025:.04,6,128]}/><meshBasicMaterial color={i%2?cyan:gold} transparent opacity={i%2?.58:.8}/></mesh>)}
    <mesh position={[0,2.65,-7.25]}><boxGeometry args={[14,.08,.08]}/><meshBasicMaterial color={cyan} transparent opacity={.45}/></mesh>
    <mesh position={[0,-.65,-7.25]}><boxGeometry args={[14,.05,.08]}/><meshBasicMaterial color={gold} transparent opacity={.32}/></mesh>
  </group>;
}

export function SpatialHolographicPanels() {
  const {camera}=useThree();
  const [toolTarget,setToolTarget] = useState<"youtube"|"knowledge"|"models"|"vision"|undefined>();
  const progress = useRef(2), marker = useRef<THREE.Mesh>(null);
  const links=useMemo(()=>{const geometry=new THREE.BufferGeometry(),positions=new Float32Array(4*6*3);geometry.setAttribute("position",new THREE.BufferAttribute(positions,3));geometry.setDrawRange(0,0);return geometry},[]);
  useEffect(()=>()=>links.dispose(),[links]);
  useEffect(() => {
    const onTool = (event:Event) => {
      const name = (event as CustomEvent<{name:string}>).detail.name;
      const kind = /youtube|video/.test(name) ? "youtube" : /knowledge|wikipedia|profile/.test(name) ? "knowledge" : /model|object/.test(name) ? "models" : /vision/.test(name) ? "vision" : undefined;
      if(kind){setToolTarget(kind);progress.current=0;}
    };
    window.addEventListener("rooh:tool-action",onTool);
    return () => window.removeEventListener("rooh:tool-action",onTool);
  },[]);
  useFrame((_,delta) => {
    const panels=useRooH.getState().panels.filter(panel=>panel.kind!=="transcript"&&!panel.minimized).slice(0,4);
    const positions=(links.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
    panels.forEach((panel,i)=>{
      const x=(panel.x+panel.width/2)/50-1,y=1-(panel.y+panel.height/2)/50;
      const end=new THREE.Vector3(x,y,.65).unproject(camera),direction=end.clone().sub(camera.position).normalize();
      end.copy(camera.position).addScaledVector(direction,6.5);
      const mid=new THREE.Vector3().lerpVectors(new THREE.Vector3(0,.64,0),end,.62);mid.y+=.14;
      const start=new THREE.Vector3(Math.sign(x||1)*1.3,.64,0);
      positions.set([...start.toArray(),...mid.toArray(),...mid.toArray(),...end.toArray(),...end.toArray(),...end.toArray()],i*18);
    });
    links.setDrawRange(0,panels.length*6);(links.getAttribute("position") as THREE.BufferAttribute).needsUpdate=true;
    if(!marker.current)return;
    if(!toolTarget || progress.current>1){marker.current.visible=false;return;}
    progress.current += Math.min(delta,.05)*.65;
    const panel=panels.find(item=>item.kind===toolTarget);if(!panel){marker.current.visible=false;return;}
    const x=(panel.x+panel.width/2)/50-1,y=1-(panel.y+panel.height/2)/50;
    const far=new THREE.Vector3(x,y,.65).unproject(camera),end=camera.position.clone().addScaledVector(far.sub(camera.position).normalize(),6.5),t=Math.min(progress.current,1);
    marker.current.visible=true;
    marker.current.position.lerpVectors(new THREE.Vector3(0,.64,0),end,t);
    marker.current.scale.setScalar(.7+.5*Math.sin(t*Math.PI));
  });
  return <group><lineSegments geometry={links} frustumCulled={false}><lineBasicMaterial color={cyan} transparent opacity={.42} depthWrite={false}/></lineSegments><mesh ref={marker} visible={false}><sphereGeometry args={[.045,12,8]}/><meshBasicMaterial color={gold} toneMapped={false}/></mesh></group>;
}

class AvatarBoundary extends Component<{fallback: ReactNode; children: ReactNode}, {failed: boolean}> {
  state = {failed: false};

  static getDerivedStateFromError() {
    return {failed: true};
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function NeuralLab({profile,entry,reduced}:{profile:Profile;entry:Entry;reduced:boolean}) {
  const fallback = <ParticleFace profile="low" entry={entry} reduced={reduced}/>;
  return <>
    <Suspense fallback={null}>
      <HubEnvironment profile={profile} reduced={reduced}/>
    </Suspense>
    <HolographicPlatform entry={entry} reduced={reduced}/>
    <AvatarBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <LivingGlassAvatar profile={profile} entry={entry} reduced={reduced}/>
      </Suspense>
    </AvatarBoundary>
    <NeuralSemanticRegions/>
    <GestureInteractionBridge/>
    <SpatialHolographicPanels/>
  </>;
}
