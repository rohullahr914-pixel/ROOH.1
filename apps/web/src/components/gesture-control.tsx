"use client";
import {useEffect,useRef,useState,type CSSProperties} from "react";
import {Hand,Power,Rotate3D,SlidersHorizontal,X} from "lucide-react";
import {FilesetResolver,GestureRecognizer,type NormalizedLandmark} from "@mediapipe/tasks-vision";
import {useRooH} from "@/lib/store";
import {normalizedDistance,pinchWithHysteresis} from "@/lib/spatial";
import {classifyHandPose,detectHorizontalSwipe,holdProgress,smoothPoint,type HandPose,type Point} from "@/lib/gesture";
import {acquireCamera,releaseCamera} from "@/lib/media-session";

const WASM="/mediapipe";
const MODEL="/mediapipe/gesture_recognizer.task";
const FIST_HOLD_MS=900;
const CONNECTIONS=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]] as const;
const poseLabels:Record<HandPose,string>={"open-palm":"OPEN PALM","fist":"HOLD TO CLOSE","point":"POINTER","neutral":"HAND READY"};

export function GestureControl({onDisable}:{onDisable:()=>void}){
  const [settings,setSettings]=useState(false),[smoothing,setSmoothing]=useState(.74),[engine,setEngine]=useState<"GPU"|"CPU">("GPU"),[pose,setPose]=useState<HandPose>("neutral"),[fistProgress,setFistProgress]=useState(0),[tutorial,setTutorial]=useState(0),[feedback,setFeedback]=useState("SHOW OPEN PALM TO BEGIN"),[modelMode,setModelMode]=useState<"rotate"|"move">("rotate");
  const video=useRef<HTMLVideoElement>(null),canvas=useRef<HTMLCanvasElement>(null),raf=useRef(0),lastFrame=useRef(0),missedFrames=useRef(0),last=useRef<Point>({x:.5,y:.5}),pinching=useRef(false),grab=useRef<{type:"panel"|"object"|"control";id:string;dx:number;dy:number;start:Point}>(),targetRef=useRef<"panel"|"object"|"control"|"scene"|"region">(),previousSpread=useRef<number>(),previousAngle=useRef<number>(),smoothingRef=useRef(smoothing),modelModeRef=useRef(modelMode),tutorialRef=useRef(0),openPalmStart=useRef<{x:number;time:number}>(),lastGestureAction=useRef(0),fistStarted=useRef<number>(),fistCommitted=useRef(false),armed=useRef(false);
  useEffect(()=>{smoothingRef.current=smoothing},[smoothing]);
  useEffect(()=>{modelModeRef.current=modelMode},[modelMode]);
  useEffect(()=>{const next=localStorage.getItem("rooh:gesture-onboarding")==="done"?3:0;tutorialRef.current=next;setTutorial(next)},[]);
  const {set,movePanel,transformObject,closePanel,camera}=useRooH();
  useEffect(()=>{
    let dead=false,tracker:GestureRecognizer|undefined;
    async function create(files:Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>){
      const common={baseOptions:{modelAssetPath:MODEL},runningMode:"VIDEO" as const,numHands:2,minHandDetectionConfidence:.58,minHandPresenceConfidence:.56,minTrackingConfidence:.56};
      try{const value=await GestureRecognizer.createFromOptions(files,{...common,baseOptions:{...common.baseOptions,delegate:"GPU"}});setEngine("GPU");return value}
      catch{const value=await GestureRecognizer.createFromOptions(files,{...common,baseOptions:{...common.baseOptions,delegate:"CPU"}});setEngine("CPU");return value}
    }
    async function start(){
      set({camera:"requesting",error:undefined});
      try{
        const stream=await acquireCamera(),element=video.current;if(!element||dead){releaseCamera(stream);return;}
        element.srcObject=stream;try{await element.play()}catch(e){if(!(e instanceof DOMException&&e.name==="AbortError"))throw e}
        if(dead)return;const files=await FilesetResolver.forVisionTasks(WASM);if(dead)return;tracker=await create(files);
        if(dead){tracker.close();return}set({camera:"active"});tick();
      }catch(e){if(!dead)set({camera:"error",error:e instanceof Error?`Hand tracking: ${e.message}`:"Hand tracking could not start."})}
    }
    function tick(time=performance.now()){
      if(dead||!tracker||!video.current||!canvas.current)return;
      raf.current=requestAnimationFrame(tick);if(time-lastFrame.current<33||video.current.readyState<2)return;lastFrame.current=time;
      let hands:NormalizedLandmark[][]=[];try{hands=tracker.recognizeForVideo(video.current,time).landmarks}catch{return}
      const ctx=canvas.current.getContext("2d")!;ctx.clearRect(0,0,640,480);
      if(!hands.length){missedFrames.current+=1;if(missedFrames.current<6)return;hideCursor();pinching.current=false;grab.current=undefined;targetRef.current=undefined;openPalmStart.current=undefined;fistStarted.current=undefined;fistCommitted.current=false;armed.current=false;setFeedback("SHOW YOUR HAND TO BEGIN");setFistProgress(0);setPose("neutral");set({camera:"tracking-lost",gesture:undefined});return}missedFrames.current=0;
      const hand=hands[0],currentPose=classifyHandPose(hand),nowPinching=pinchWithHysteresis(normalizedDistance(hand[4],hand[8]),pinching.current),raw={x:1-(nowPinching?(hand[4].x+hand[8].x)/2:hand[8].x),y:nowPinching?(hand[4].y+hand[8].y)/2:hand[8].y};hands.forEach(h=>draw(ctx,h,currentPose));last.current=smoothPoint(last.current,raw,nowPinching?Math.min(smoothingRef.current,.5):smoothingRef.current);
      const cursor=document.getElementById("gesture-cursor");setPose(currentPose);
      if(cursor){cursor.style.left=`${last.current.x*100}vw`;cursor.style.top=`${last.current.y*100}vh`;cursor.style.opacity="1";cursor.classList.toggle("pinching",nowPinching);cursor.classList.toggle("confirming",currentPose==="fist")}
      if(tutorialRef.current===0){tutorialRef.current=1;setTutorial(1)}else if(tutorialRef.current===1&&currentPose==="open-palm"){tutorialRef.current=2;setTutorial(2)}else if(tutorialRef.current===2&&nowPinching)completeTutorial();
      const store=useRooH.getState();
      if(currentPose==="open-palm"){
        if(!openPalmStart.current){openPalmStart.current={x:last.current.x,time};armed.current=true;setFeedback("HAND CONTROL READY");if(time-lastGestureAction.current>650)set({panels:store.panels.map(panel=>({...panel,minimized:false}))})}
        const swipe=detectHorizontalSwipe(openPalmStart.current.x,last.current.x,time-openPalmStart.current.time);
        if(swipe&&time-lastGestureAction.current>700){
          const current=useRooH.getState(),step=swipe==="left"?1:-1;
          if(current.panels.some(panel=>panel.kind==="youtube")&&current.youtube.length){const index=current.youtube.findIndex(item=>item.id===current.videoId),item=current.youtube[(index+step+current.youtube.length)%current.youtube.length];set({videoId:item.id,error:undefined})}
          else if(current.objects.length){const index=Math.max(0,current.objects.findIndex(object=>object.id===current.selectedId));set({selectedId:current.objects[(index+step+current.objects.length)%current.objects.length].id})}
          setFeedback(swipe==="left"?"NEXT ITEM":"PREVIOUS ITEM");lastGestureAction.current=time;openPalmStart.current={x:last.current.x,time};
        }
      }else openPalmStart.current=undefined;
      if(currentPose==="fist"){
        fistStarted.current??=time;const progress=holdProgress(fistStarted.current,time,FIST_HOLD_MS);setFistProgress(progress);
        if(grab.current){grab.current=undefined;pinching.current=false;setFeedback("ACTION CANCELLED")}
        if(progress===1&&!fistCommitted.current){const current=useRooH.getState(),top=[...current.panels].sort((a,b)=>b.z-a.z)[0];if(top){closePanel(top.id);setFeedback("PANEL CLOSED")}else if(current.externalModel){set({externalModel:undefined});setFeedback("MODEL CLOSED")}else setFeedback("NOTHING TO CLOSE");fistCommitted.current=true;lastGestureAction.current=time}
      }else{fistStarted.current=undefined;fistCommitted.current=false;setFistProgress(0)}
      if(nowPinching&&!pinching.current){const target=document.elementFromPoint(last.current.x*innerWidth,last.current.y*innerHeight) as HTMLElement|null,control=target?.closest("button,a,input,select,summary") as HTMLElement|null,handle=target?.closest(".panel-handle") as HTMLElement|null,el=handle?.closest("[data-panel-id]") as HTMLElement|null;if(control){grab.current={type:"control",id:"",dx:0,dy:0,start:{...last.current}};targetRef.current="control";setFeedback("RELEASE TO SELECT")}else if(el){const rect=el.getBoundingClientRect();grab.current={type:"panel",id:el.dataset.panelId!,dx:last.current.x*100-rect.left/innerWidth*100,dy:last.current.y*100-rect.top/innerHeight*100,start:{...last.current}};targetRef.current="panel";setFeedback("MOVING PANEL")}else if(target?.closest("[data-panel-id]")){targetRef.current="control";setFeedback("PANEL READY")}else{const pick:{pointer:Point;objectId?:string;regionKind?:string}={pointer:{...last.current}};window.dispatchEvent(new CustomEvent("rooh:gesture-pick",{detail:pick}));if(pick.objectId){grab.current={type:"object",id:pick.objectId,dx:0,dy:0,start:{...last.current}};targetRef.current="object";setFeedback(modelModeRef.current==="rotate"?"ROTATING MODEL":"MOVING MODEL")}else if(pick.regionKind){targetRef.current="region";setFeedback("PANEL OPENED")}else{targetRef.current="scene";setFeedback("ORBITING HUB")}}}
      if(nowPinching&&grab.current?.type==="panel")movePanel(grab.current.id,last.current.x*100-grab.current.dx,last.current.y*100-grab.current.dy);
      if(nowPinching&&grab.current?.type==="object"){const object=useRooH.getState().objects.find(item=>item.id===grab.current!.id);if(object){const dx=last.current.x-grab.current.start.x,dy=last.current.y-grab.current.start.y;if(modelModeRef.current==="rotate")transformObject(object.id,{rotation:[object.rotation[0]+dy*2.2,object.rotation[1]+dx*3.2,object.rotation[2]]});else transformObject(object.id,{position:[(last.current.x-.5)*7,(.5-last.current.y)*4,object.position[2]]});grab.current.start={...last.current}}}
      if(!nowPinching&&pinching.current){if(grab.current?.type==="control"&&Math.hypot(last.current.x-grab.current.start.x,last.current.y-grab.current.start.y)<.035){const target=document.elementFromPoint(last.current.x*innerWidth,last.current.y*innerHeight) as HTMLElement|null;(target?.closest("button,a,summary") as HTMLElement|null)?.click();setFeedback("SELECTED")}grab.current=undefined;targetRef.current=undefined}
      if(hands.length===2){const a=hands[0][8],b=hands[1][8],spread=normalizedDistance(a,b),angle=Math.atan2(b.y-a.y,b.x-a.x),id=useRooH.getState().selectedId,object=useRooH.getState().objects.find(item=>item.id===id);if(object){const scaleDelta=previousSpread.current===undefined?1:Math.max(.85,Math.min(1.15,spread/Math.max(.01,previousSpread.current))),angleDelta=previousAngle.current===undefined?0:Math.atan2(Math.sin(angle-previousAngle.current),Math.cos(angle-previousAngle.current));if(Math.abs(scaleDelta-1)>.006||Math.abs(angleDelta)>.012)transformObject(object.id,{scale:Math.max(.25,Math.min(4,object.scale*scaleDelta)),rotation:[object.rotation[0],object.rotation[1]+angleDelta,object.rotation[2]]});setFeedback("SCALING MODEL")}else setFeedback("ZOOMING HUB");previousSpread.current=spread;previousAngle.current=angle}else{previousSpread.current=undefined;previousAngle.current=undefined}
      const activeHold=holdProgress(fistStarted.current,time,FIST_HOLD_MS);pinching.current=nowPinching;set({camera:nowPinching||currentPose!=="neutral"?"gesture-active":"hand-detected",gesture:{pointer:last.current,hands:hands.length,pinching:nowPinching,openPalm:currentPose==="open-palm",pose:currentPose,holdProgress:activeHold,spread:previousSpread.current,target:targetRef.current}});
    }
    start();return()=>{dead=true;cancelAnimationFrame(raf.current);tracker?.close();const element=video.current;if(element){element.pause();if(element.srcObject)releaseCamera(element.srcObject as MediaStream);element.srcObject=null}set({camera:"disabled",gesture:undefined})};
  },[closePanel,movePanel,set,transformObject]);
  function completeTutorial(){localStorage.setItem("rooh:gesture-onboarding","done");tutorialRef.current=3;setTutorial(3)}
  function hideCursor(){const cursor=document.getElementById("gesture-cursor");if(cursor)cursor.style.opacity="0"}
  function draw(ctx:CanvasRenderingContext2D,hand:NormalizedLandmark[],currentPose:HandPose){const color=currentPose==="fist"?"#ffba72":currentPose==="open-palm"?"#7fffd7":"#76eaff";ctx.lineWidth=2;ctx.strokeStyle=color;ctx.shadowBlur=8;ctx.shadowColor=color;for(const [from,to] of CONNECTIONS){ctx.beginPath();ctx.moveTo((1-hand[from].x)*640,hand[from].y*480);ctx.lineTo((1-hand[to].x)*640,hand[to].y*480);ctx.stroke()}ctx.fillStyle=color;for(const point of hand){ctx.beginPath();ctx.arc((1-point.x)*640,point.y*480,3.5,0,Math.PI*2);ctx.fill()}ctx.shadowBlur=0}
  const instruction=tutorial===0?"Place one hand inside the camera frame":tutorial===1?"Open your palm to reveal the workspace":"Pinch your thumb and index finger to select";
  return <>
    <aside className={`camera-orb ${camera} pose-${pose}`}><video ref={video} muted playsInline/><canvas ref={canvas} width={640} height={480}/><div className="camera-status"><span>{poseLabels[pose]}</span>{pose==="fist"&&<div className="hold-meter"><i style={{width:`${fistProgress*100}%`}}/></div>}</div><div className="camera-actions"><button onClick={()=>setSettings(value=>!value)} aria-label="Gesture calibration" title="Gesture calibration">{settings?<X/>:<SlidersHorizontal/>}</button><button onClick={onDisable} aria-label="Turn off hand control" title="Turn off hand control"><Power/></button></div><i className="camera-live"/><small className="tracking-engine">{engine}</small></aside>
    <div className="gesture-feedback" aria-live="polite"><i/><span>{feedback}</span></div>
    <div className="gesture-quickguide" aria-label="Hand gesture guide"><span><i>01</i><b>OPEN</b><small>WAKE</small></span><span><i>02</i><b>PINCH</b><small>SELECT</small></span><span><i>03</i><b>2 HANDS</b><small>3D SCALE</small></span><span><i>04</i><b>FIST</b><small>CANCEL</small></span></div>
    {settings&&<div className="gesture-settings"><small>GESTURE CONTROL · {engine}</small><label><span>Smoothing</span><output>{Math.round(smoothing*100)}%</output></label><input type="range" min="0" max=".92" step=".02" value={smoothing} onChange={event=>setSmoothing(+event.target.value)}/><div className="gesture-mode"><button className={modelMode==="rotate"?"active":""} onClick={()=>setModelMode("rotate")}><Rotate3D/> Rotate</button><button className={modelMode==="move"?"active":""} onClick={()=>setModelMode("move")}><Hand/> Move</button></div><ul><li><b>Open palm</b><span>Wake and browse</span></li><li><b>Pinch</b><span>Select or control</span></li><li><b>Two hands</b><span>Scale and rotate 3D</span></li><li><b>Hold fist</b><span>Close active panel</span></li></ul></div>}
    {tutorial<3&&<section className="gesture-onboarding" aria-live="polite"><div className="tutorial-icon"><Hand/></div><small>HAND CONTROL · STEP {tutorial+1} OF 3</small><h2>{instruction}</h2><p>Your camera stays on this device. Mouse, touch and voice remain available.</p><div className="tutorial-steps"><i className={tutorial>=0?"active":""}/><i className={tutorial>=1?"active":""}/><i className={tutorial>=2?"active":""}/></div><button onClick={completeTutorial}>Skip tutorial</button></section>}
    <div id="gesture-cursor" style={{"--hold":fistProgress} as CSSProperties}/>
  </>;
}
