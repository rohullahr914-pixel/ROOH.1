import {api} from "./api";
let camera:HTMLVideoElement|undefined, pending:AbortController|undefined,lastRequest=0;
export function attachVision(video?:HTMLVideoElement){camera=video;if(!video){pending?.abort();pending=undefined;}}
export async function analyzeVision(question:string){
  if(!camera||camera.readyState<2||!(camera.srcObject as MediaStream)?.active)throw new Error("Enable the Vision camera first and wait for its preview.");
  if(pending)throw new Error("A visual analysis is already running.");
  if(Date.now()-lastRequest<3000)throw new Error("Wait a moment before another snapshot.");
  const canvas=document.createElement("canvas"),ratio=Math.min(1,768/camera.videoWidth);
  canvas.width=Math.round(camera.videoWidth*ratio);canvas.height=Math.round(camera.videoHeight*ratio);
  const context=canvas.getContext("2d");if(!context)throw new Error("Snapshot capture is unavailable.");
  context.drawImage(camera,0,0,canvas.width,canvas.height);
  const image=canvas.toDataURL("image/jpeg",.72).split(",")[1];canvas.width=canvas.height=0;
  const controller=new AbortController();pending=controller;lastRequest=Date.now();const timeout=setTimeout(()=>controller.abort(),28000);
  try{
    const response=await fetch(`${api.base}/api/vision/analyze`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({image,question}),signal:controller.signal});
    const result=await response.json();if(!response.ok)throw new Error(result.detail||"Vision failed");
    window.dispatchEvent(new CustomEvent("rooh:vision-result",{detail:result.analysis}));return result as {analysis:string;source:string};
  }finally{clearTimeout(timeout);if(pending===controller)pending=undefined;}
}
