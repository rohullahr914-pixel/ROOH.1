"use client";
import {useEffect,useRef,useState} from "react";
import {acquireCamera,releaseCamera} from "@/lib/media-session";
import {attachVision,analyzeVision} from "@/lib/vision";
export function VisionPanel(){
 const video=useRef<HTMLVideoElement>(null),stream=useRef<MediaStream>(),generation=useRef(0);
 const [active,setActive]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[analysis,setAnalysis]=useState(""),[devices,setDevices]=useState<MediaDeviceInfo[]>([]),[device,setDevice]=useState("");
 function stop(){generation.current++;attachVision();if(stream.current)releaseCamera(stream.current);stream.current=undefined;if(video.current)video.current.srcObject=null;setActive(false);setBusy(false);}
 async function start(){const token=++generation.current;setBusy(true);setError("");try{
   if(!navigator.mediaDevices?.getUserMedia)throw new Error("Camera requires localhost or HTTPS.");
   const media=await acquireCamera(device||undefined);
   if(token!==generation.current){releaseCamera(media);return;}
   stream.current=media;media.getVideoTracks()[0].onended=()=>{stop();setError("Camera disconnected.");};
   if(video.current){video.current.srcObject=media;await video.current.play();attachVision(video.current);}
   setActive(true);setDevices((await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==="videoinput"));
 }catch(e){if(token===generation.current){stop();setError(e instanceof Error?e.message:"Camera unavailable");}}finally{if(token===generation.current)setBusy(false);}}
 useEffect(()=>{const result=(e:Event)=>setAnalysis((e as CustomEvent<string>).detail);window.addEventListener("rooh:stop-vision",stop);window.addEventListener("rooh:vision-result",result);return()=>{stop();window.removeEventListener("rooh:stop-vision",stop);window.removeEventListener("rooh:vision-result",result);};},[]);
 return <section style={{padding:16,display:"grid",gap:12}}><small>{active?"CAMERA LIVE · SNAPSHOTS ON REQUEST":"VISION · CAMERA OFF"}</small><video ref={video} muted playsInline style={{width:"100%",maxHeight:280,borderRadius:12}}/>{!active&&<p>Enable your camera to preview it. When you ask a visual question, one resized image is sent to OpenAI. Images are not saved by ROOH.</p>}{devices.length>1&&!active&&<select aria-label="Camera device" value={device} onChange={e=>setDevice(e.target.value)}>{devices.map(d=><option key={d.deviceId} value={d.deviceId}>{d.label||"Camera"}</option>)}</select>}<div><button disabled={busy} onClick={()=>active?stop():void start()}>{busy?"Starting…":active?"Stop camera":"Enable camera"}</button>{active&&<button disabled={busy} onClick={async()=>{setBusy(true);setError("");try{await analyzeVision("Describe what you see. State any uncertainty.");}catch(e){setError(e instanceof Error?e.message:"Analysis failed");}finally{setBusy(false);}}}>Analyze snapshot</button>}</div>{error&&<p role="alert">{error}</p>}{analysis&&<article aria-live="polite"><small>OPENAI · VISUAL ANALYSIS · IDENTITY UNVERIFIED</small><p dir="auto">{analysis}</p></article>}</section>;
}
