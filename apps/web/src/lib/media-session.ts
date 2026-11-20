let audioMedia:MediaStream|undefined,videoMedia:MediaStream|undefined;
let audioRequest:Promise<MediaStream>|undefined,videoRequest:Promise<MediaStream>|undefined;

export function requestAudioMedia(){
  if(audioMedia?.active)return Promise.resolve(audioMedia);
  if(!navigator.mediaDevices?.getUserMedia)return Promise.reject(new Error("Microphone capture is unavailable in this browser."));
  // Echo cancellation keeps OpenAI's speaker output from being re-captured by
  // the mic and mistaken for a user interruption. Disable extra processing
  // that can pump the input level while the assistant is speaking.
  audioRequest??=navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:false,channelCount:1},video:false}).then(media=>audioMedia=media).finally(()=>{audioRequest=undefined});
  return audioRequest;
}

export function requestVideoMedia(deviceId?:string){
  if(videoMedia?.active)return Promise.resolve(videoMedia);
  if(!navigator.mediaDevices?.getUserMedia)return Promise.reject(new Error("Camera capture is unavailable in this browser."));
  videoRequest??=navigator.mediaDevices.getUserMedia({audio:false,video:{...(deviceId?{deviceId:{exact:deviceId}}:{facingMode:"user"}),width:{ideal:640},height:{ideal:480}}}).then(media=>videoMedia=media).finally(()=>{videoRequest=undefined});
  return videoRequest;
}

export async function requestSharedMedia(){
  const results=await Promise.allSettled([requestAudioMedia(),requestVideoMedia()]);
  const tracks=results.flatMap(result=>result.status==="fulfilled"?result.value.getTracks():[]);
  if(!tracks.length)throw(results.find(result=>result.status==="rejected") as PromiseRejectedResult).reason;
  if(results.some(result=>result.status==="rejected"))throw new Error("Some device permissions were denied. RooH will open with the available camera or microphone.");
  return new MediaStream(tracks);
}

export function audioStream(){const track=audioMedia?.getAudioTracks()[0];return track?.readyState==="live"?new MediaStream([track.clone()]):undefined}
export function videoStream(){const track=videoMedia?.getVideoTracks()[0];return track?.readyState==="live"?new MediaStream([track]):undefined}
export function releaseAudioMedia(){audioMedia?.getTracks().forEach(track=>track.stop());audioMedia=undefined}
export function releaseVideoMedia(){videoMedia?.getTracks().forEach(track=>track.stop());videoMedia=undefined}

// Each consumer owns a clone. The physical camera closes after its last lease.
const cameraLeases=new Set<MediaStream>();
export async function acquireCamera(deviceId?:string){
  if(deviceId&&cameraLeases.size&&videoMedia?.getVideoTracks()[0]?.getSettings().deviceId!==deviceId)throw new Error("Stop hand control before switching cameras.");
  const source=await requestVideoMedia(deviceId);const lease=new MediaStream(source.getVideoTracks().map(track=>track.clone()));cameraLeases.add(lease);return lease;
}
export function releaseCamera(lease:MediaStream){
  lease.getTracks().forEach(track=>track.stop());cameraLeases.delete(lease);
  if(!cameraLeases.size)releaseVideoMedia();
}
