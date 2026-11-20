"use client";
import {useCallback,useEffect,useRef} from "react";
import {waNewSession,waVoiceApproval} from "@/lib/whatsapp";
import {api} from "@/lib/api";
import {pcmToUlaw,ulawToPcm} from "@/lib/audio-codec";
import {executeTool} from "@/lib/tool-executor";
import {useRooH} from "@/lib/store";
import {audioStream,releaseAudioMedia,requestAudioMedia} from "@/lib/media-session";
import {AdaptiveAudioBuffer,AdaptiveVoiceActivityGate,OutgoingAudioQueue,applyMicrophoneMute,backoffMs,pcmRms,schedulePCMChunk,stateTransition,websocketHighWaterMark,type VoiceRuntimeState} from "@/lib/voice-runtime";

const INPUT_SAMPLE_RATE=24000;
const COMPRESSED_VOICE=process.env.NEXT_PUBLIC_COMPRESSED_VOICE==="true";
const RELAY_ENDPOINT=`${api.base.replace(/^http/,"ws")}/ws/live?compressed=${COMPRESSED_VOICE}`;

function sendText(ws:WebSocket,text:string){
  ws.send(JSON.stringify({type:"conversation.item.create",item:{type:"message",role:"user",content:[{type:"input_text",text}]}}));
  ws.send(JSON.stringify({type:"response.create"}));
}

function floatToPCM16(input:Float32Array){const out=new Int16Array(input.length);for(let i=0;i<input.length;i++)out[i]=Math.max(-1,Math.min(1,input[i]))*0x7fff;return out}
function base64(bytes:ArrayBufferLike|Uint8Array){const view=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);let s="";for(let i=0;i<view.length;i+=0x8000)s+=String.fromCharCode(...view.subarray(i,i+0x8000));return btoa(s)}
function from64(s:string){const b=atob(s),u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u.buffer}

export function useLiveVoice(){
  const socket=useRef<WebSocket|null>(null),inputCtx=useRef<AudioContext|null>(null),outputCtx=useRef<AudioContext|null>(null),stream=useRef<MediaStream|null>(null),source=useRef<MediaStreamAudioSourceNode|null>(null),processor=useRef<AudioWorkletNode|null>(null),silentGain=useRef<GainNode|null>(null),reconnectTimer=useRef<ReturnType<typeof setTimeout>|null>(null),reasonTimer=useRef<ReturnType<typeof setTimeout>|null>(null),manuallyClosed=useRef(false),connectionAttempt=useRef(0),sessionReady=useRef(false),announcements=useRef<string[]>([]),playQueue=useRef<AudioBufferSourceNode[]>([]),playAt=useRef(0),playbackChain=useRef(Promise.resolve()),playbackEpoch=useRef(0),reconnectCount=useRef(0),audioBuffer=useRef(new AdaptiveAudioBuffer()),speechGate=useRef(new AdaptiveVoiceActivityGate()),preRoll=useRef<Float32Array[]>([]),networkAudio=useRef(new OutgoingAudioQueue()),inputPaused=useRef(false),turnFinished=useRef(false),drainTimer=useRef<ReturnType<typeof setInterval>|null>(null),peakBuffered=useRef(0),playbackUnderruns=useRef(0),audioLost=useRef(false),turnSentAt=useRef<number|null>(null);
  const set=useRooH(x=>x.set),add=useRooH(x=>x.addTranscript);
  const recordNetwork=useCallback((queuedFrames:number)=>set({voiceNetwork:{peakBufferedBytes:peakBuffered.current,queuedFrames,playbackUnderruns:playbackUnderruns.current,reconnects:useRooH.getState().voiceNetwork?.reconnects||0,responseMs:useRooH.getState().voiceNetwork?.responseMs}}),[set]);
  const setVoiceState=useCallback((next:VoiceRuntimeState,error?:string)=>{const current=useRooH.getState().voice as VoiceRuntimeState;const resolved=stateTransition(current,next);set({voice:resolved,error:error ?? (audioLost.current?"بخشی از صحبت نرسید؛ لطفاً جمله را تکرار کنید.":undefined)})},[set]);
  const stopPlayback=useCallback(()=>{playbackEpoch.current+=1;for(const node of playQueue.current){try{node.stop()}catch{}}playQueue.current=[];playAt.current=0;playbackChain.current=Promise.resolve();audioBuffer.current.reset();turnFinished.current=false;window.dispatchEvent(new CustomEvent("rooh:output-amplitude",{detail:0}))},[]);
  const stopInput=useCallback(()=>{if(drainTimer.current){clearInterval(drainTimer.current);drainTimer.current=null}if(processor.current)processor.current.port.onmessage=null;processor.current?.disconnect();source.current?.disconnect();silentGain.current?.disconnect();if(inputCtx.current && inputCtx.current.state !== "closed"){void inputCtx.current.close().catch(()=>undefined)};stream.current?.getTracks().forEach(track=>track.stop());processor.current=null;source.current=null;silentGain.current=null;stream.current=null;inputCtx.current=null;speechGate.current.reset();preRoll.current=[];networkAudio.current.reset();inputPaused.current=false},[]);
  const playPCM=useCallback((data:string,mime:string,epoch:number)=>{
    if(epoch!==playbackEpoch.current)return;
    if(turnSentAt.current!==null){
      const responseMs=Math.round(performance.now()-turnSentAt.current);turnSentAt.current=null;
      set({voiceNetwork:{peakBufferedBytes:peakBuffered.current,queuedFrames:networkAudio.current.length,playbackUnderruns:playbackUnderruns.current,reconnects:useRooH.getState().voiceNetwork?.reconnects||0,responseMs}});
    }
    const rate=Number(mime.match(/rate=(\d+)/)?.[1]||24000);
    if(!outputCtx.current)outputCtx.current=new AudioContext({sampleRate:rate,latencyHint:"playback"});
    const ctx=outputCtx.current,pcm=mime.startsWith("audio/ulaw")?ulawToPcm(new Uint8Array(from64(data))):new Int16Array(from64(data)),buffer=ctx.createBuffer(1,pcm.length,rate),samples=buffer.getChannelData(0);
    let energy=0;
    for(let i=0;i<pcm.length;i++){samples[i]=pcm[i]/32768;energy+=samples[i]*samples[i];}
    const level=Math.min(1,Math.sqrt(energy/Math.max(1,pcm.length))*6);
    const node=ctx.createBufferSource();node.buffer=buffer;node.connect(ctx.destination);
    const lead=audioBuffer.current.observe(performance.now()/1000,buffer.duration);
    if(playAt.current>0&&playAt.current<=ctx.currentTime+0.04){playbackUnderruns.current++;recordNetwork(networkAudio.current.length)}
    const timing=schedulePCMChunk(ctx.currentTime,playAt.current,buffer.duration,lead);
    node.start(timing.startAt);playAt.current=timing.queuedUntil;playQueue.current.push(node);
    window.setTimeout(()=>{if(epoch===playbackEpoch.current)window.dispatchEvent(new CustomEvent("rooh:output-amplitude",{detail:level}))},Math.max(0,(timing.startAt-ctx.currentTime)*1000));
    node.onended=()=>{playQueue.current=playQueue.current.filter(item=>item!==node);if(!playQueue.current.length&&epoch===playbackEpoch.current){window.dispatchEvent(new CustomEvent("rooh:output-amplitude",{detail:0}));if(turnFinished.current){
      turnFinished.current=false;
      const ws=socket.current;
      if(announcements.current.length&&ws?.readyState===WebSocket.OPEN){
        setVoiceState("processing");sendText(ws,announcements.current.splice(0).join("\n"));
      }else setVoiceState("listening");
    }}};
    setVoiceState("speaking");if(ctx.state==="suspended")void ctx.resume().catch(()=>undefined);
  },[recordNetwork,set,setVoiceState]);
  const startInput=useCallback(async(ws:WebSocket,media:MediaStream)=>{
    if(!media.active||socket.current!==ws)return;
    applyMicrophoneMute(media,useRooH.getState().micMuted);
    const ctx=inputCtx.current ?? new AudioContext({sampleRate:INPUT_SAMPLE_RATE,latencyHint:"interactive"});inputCtx.current=ctx;await ctx.resume();
    if(socket.current!==ws||!sessionReady.current)return;
    source.current??=ctx.createMediaStreamSource(media);
    await ctx.audioWorklet.addModule("/audio-capture-worklet.js");
    if(socket.current!==ws||!sessionReady.current)return;
    const procedure=new AudioWorkletNode(ctx,"rooh-audio-capture",{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});processor.current=procedure;
    const silent=ctx.createGain();silent.gain.value=0;silentGain.current=silent;
    const packet=(frame:Float32Array)=>{const pcm=floatToPCM16(frame);return JSON.stringify({type:"input_audio_buffer.append",audio:base64(COMPRESSED_VOICE?pcmToUlaw(pcm):pcm.buffer)})};
    const drain=()=>{
      if(ws.readyState!==WebSocket.OPEN||socket.current!==ws||!sessionReady.current)return;
      const connection=(navigator as Navigator & {connection?:{effectiveType?:string}}).connection,limit=websocketHighWaterMark(connection?.effectiveType),now=performance.now();
      peakBuffered.current=Math.max(peakBuffered.current,ws.bufferedAmount);
      if(networkAudio.current.expired(now)){
        audioLost.current=true;set({error:"بخشی از صحبت به‌دلیل کندی اینترنت نرسید؛ لطفاً جمله را دوباره بگویید."});recordNetwork(0);
        networkAudio.current.reset();ws.close(4000,"audio upload stalled");return;
      }
      networkAudio.current.flush(ws.bufferedAmount,limit,item=>{ws.send(item);if(item.includes('"input_audio_buffer.commit"')){turnSentAt.current=performance.now();setVoiceState("processing")}},now);
      const queued=networkAudio.current.length;
      if(queued||inputPaused.current)recordNetwork(queued);
      if(inputPaused.current&&!networkAudio.current.pending&&ws.bufferedAmount<=limit){inputPaused.current=false;set({error:undefined})}
    };
    drainTimer.current=setInterval(drain,50);
    procedure.port.onmessage=(event:MessageEvent<Float32Array>)=>{
      if(ws.readyState!==WebSocket.OPEN||!sessionReady.current||socket.current!==ws)return;
      if(useRooH.getState().micMuted){speechGate.current.reset();preRoll.current=[];set({amplitude:0});return}
      const samples=event.data,rms=pcmRms(samples);set({amplitude:Math.min(1,rms*6)});
      const voice=useRooH.getState().voice;if(voice==="speaking"||voice==="processing"){speechGate.current.reset();preRoll.current=[];return}
      const decision=speechGate.current.next(rms);preRoll.current.push(samples);if(preRoll.current.length>10)preRoll.current.shift();
      if(!decision.speech&&!decision.speechEnded)return;
      const frames=decision.speechStarted?[...preRoll.current]:[samples],packets=frames.map(packet);
      if(!networkAudio.current.enqueue(packets,performance.now())){
        audioLost.current=true;set({error:"بخشی از صحبت به‌دلیل کندی اینترنت نرسید؛ لطفاً جمله را دوباره بگویید."});
        networkAudio.current.reset();ws.close(4000,"audio queue full");return;
      }
      drain();
      if(networkAudio.current.length&&!inputPaused.current){inputPaused.current=true;set({error:"اینترنت ضعیف است؛ صدا موقتاً در صف ارسال قرار دارد."})}
      if(decision.speechStarted&&audioLost.current){audioLost.current=false;set({error:undefined})}
      if(reasonTimer.current){clearTimeout(reasonTimer.current);reasonTimer.current=null}
      if(decision.speechEnded){networkAudio.current.end(performance.now());drain();reasonTimer.current=setTimeout(()=>{if(useRooH.getState().voice!=="speaking"&&useRooH.getState().voice!=="processing")setVoiceState("listening")},1400)}
    };
    source.current.connect(procedure);procedure.connect(silent);silent.connect(ctx.destination);
  },[recordNetwork,set,setVoiceState]);
  const disconnect=useCallback(()=>{announcements.current=[];void waNewSession().catch(()=>{});connectionAttempt.current+=1;manuallyClosed.current=true;sessionReady.current=false;if(reconnectTimer.current){clearTimeout(reconnectTimer.current);reconnectTimer.current=null}if(reasonTimer.current){clearTimeout(reasonTimer.current);reasonTimer.current=null}if(socket.current){if(socket.current.readyState===WebSocket.OPEN||socket.current.readyState===WebSocket.CONNECTING)socket.current.close(1000,"client disconnect")}socket.current=null;stopInput();releaseAudioMedia();if(outputCtx.current && outputCtx.current.state !== "closed"){void outputCtx.current.close().catch(()=>undefined)}outputCtx.current=null;stopPlayback();setVoiceState("disconnected", "Voice session ended.");set({amplitude:0})},[set, setVoiceState, stopInput, stopPlayback]);
  const connect=useCallback(async()=>{
    if(socket.current?.readyState===WebSocket.OPEN||socket.current?.readyState===WebSocket.CONNECTING)return;const attempt=++connectionAttempt.current;manuallyClosed.current=false;sessionReady.current=false;setVoiceState(reconnectCount.current?"reconnecting":"connecting");
    try{
      announcements.current=[];await waNewSession().catch(()=>{});
      await requestAudioMedia();if(attempt!==connectionAttempt.current||manuallyClosed.current){if(manuallyClosed.current)releaseAudioMedia();return}const media=audioStream();if(!media)throw new Error("Microphone is unavailable");applyMicrophoneMute(media,useRooH.getState().micMuted);stream.current=media;
      const ws=new WebSocket(RELAY_ENDPOINT);socket.current=ws;
      const current=()=>attempt===connectionAttempt.current&&socket.current===ws&&ws.readyState===WebSocket.OPEN;
      const fail=(message:string)=>{setVoiceState("error",message);manuallyClosed.current=true;ws.close()};
      ws.onmessage=async event=>{
        if(!current())return;
        try{
          const message=JSON.parse(event.data);
          switch(message.type){
            case "fatal": fail(message.message); return;
            case "error":
              if(!sessionReady.current){fail("OpenAI rejected the voice session configuration.");return}
              if(message.error?.code!=="conversation_already_has_active_response"){
                set({error:"OpenAI could not process the latest voice event."});
                if(!playQueue.current.length)setVoiceState("listening","OpenAI could not process the latest voice event.");
              }
              return;
            case "session.updated":
              if(sessionReady.current)return;
              sessionReady.current=true;reconnectCount.current=0;
              await startInput(ws,media);
              if(current()){
                setVoiceState("processing");
                sendText(ws,"Voice session started. Say your short opening greeting now.");
              }
              return;
            case "rooh.audio_too_short":
              setVoiceState("listening");
              return;
            case "conversation.item.input_audio_transcription.completed":{
              const transcript=message.transcript;
              if(!transcript?.trim())return;
              add("user",transcript);
              const result=await waVoiceApproval(transcript);
              if(result&&current()){
                const notice=`WhatsApp confirmation controller result: ${JSON.stringify(result)}. Report this accurately. SENT means accepted, not confirmed delivered.`;
                if(useRooH.getState().voice==="listening"){setVoiceState("processing");sendText(ws,notice)}
                else announcements.current.push(notice);
              }
              return;
            }
            case "response.output_audio_transcript.done":
              if(message.transcript)add("assistant",message.transcript);
              return;
            case "response.output_audio.delta":{
              const epoch=playbackEpoch.current;
              playbackChain.current=playbackChain.current.then(()=>playPCM(message.delta,COMPRESSED_VOICE?"audio/ulaw;rate=24000":"audio/pcm;rate=24000",epoch)).catch(()=>undefined);
              return;
            }
            case "response.done":{
              const calls=message.response?.status==="completed" ? (message.response.output||[]).filter((item:{type:string})=>item.type==="function_call") : [];
              if(calls.length){
                setVoiceState("processing");
                for(const call of calls){
                  let output;
                  try{output={ok:true,...await executeTool(call.name,JSON.parse(call.arguments||"{}"))}}
                  catch(error){output={ok:false,error:error instanceof Error?error.message:"Tool failed"}}
                  if(!current())return;
                  ws.send(JSON.stringify({type:"conversation.item.create",item:{type:"function_call_output",call_id:call.call_id,output:JSON.stringify(output)}}));
                }
                ws.send(JSON.stringify({type:"response.create"}));
                return;
              }
              await playbackChain.current;
              if(!current())return;
              turnFinished.current=true;
              if(!playQueue.current.length){
                turnFinished.current=false;
                setVoiceState("listening",message.response?.status==="failed"?"OpenAI did not complete the response.":undefined);
              }
              if(!playQueue.current.length&&announcements.current.length){
                setVoiceState("processing");
                sendText(ws,announcements.current.splice(0).join("\n"));
              }
              return;
            }
          }
        }catch(error){if(current())fail(error instanceof Error?error.message:"Voice session failed.")}
      };
      ws.onerror=()=>{if(attempt===connectionAttempt.current&&socket.current===ws)setVoiceState("error","Could not connect to the RooH voice server.")};
      ws.onclose=()=>{if(socket.current===ws)socket.current=null;if(attempt!==connectionAttempt.current)return;announcements.current=[];void waNewSession().catch(()=>{});sessionReady.current=false;stopInput();stopPlayback();if(manuallyClosed.current)return;const retryMessage=audioLost.current?"بخشی از صحبت نرسید؛ پس از اتصال دوباره، لطفاً جمله را تکرار کنید.":"Voice connection lost.";if(reconnectCount.current >= 4){setVoiceState("error",retryMessage);return;}const delay=backoffMs(reconnectCount.current);reconnectCount.current+=1;set({voiceNetwork:{peakBufferedBytes:peakBuffered.current,queuedFrames:0,playbackUnderruns:playbackUnderruns.current,reconnects:(useRooH.getState().voiceNetwork?.reconnects||0)+1}});setVoiceState("reconnecting",retryMessage);reconnectTimer.current=setTimeout(()=>window.dispatchEvent(new Event("rooh:reconnect")),delay)};
    }catch(error){if(attempt!==connectionAttempt.current)return;stopInput();releaseAudioMedia();setVoiceState("error",error instanceof Error?error.message:"Could not start OpenAI Realtime.");}
  },[add,playPCM,set,setVoiceState,startInput,stopInput,stopPlayback]);
  useEffect(()=>{const linked=()=>{const ws=socket.current;if(ws?.readyState===WebSocket.OPEN&&sessionReady.current){const notice="The WhatsApp controller reports CONNECTED. Tell me my WhatsApp account is now connected.";if(useRooH.getState().voice==="listening"){setVoiceState("processing");sendText(ws,notice)}else announcements.current.push(notice)}};window.addEventListener("rooh:whatsapp-connected",linked);const retry=()=>{if(!manuallyClosed.current){void connect()}};const mute=(event:Event)=>{const detail=(event as CustomEvent<boolean>).detail;if(stream.current)applyMicrophoneMute(stream.current,detail);if(detail){speechGate.current.reset();preRoll.current=[];set({amplitude:0});networkAudio.current.reset();if(socket.current?.readyState===WebSocket.OPEN&&sessionReady.current)socket.current.send(JSON.stringify({type:"input_audio_buffer.clear"}))}};window.addEventListener("rooh:reconnect",retry);window.addEventListener("rooh:mute",mute);return()=>{window.removeEventListener("rooh:whatsapp-connected",linked);window.removeEventListener("rooh:reconnect",retry);window.removeEventListener("rooh:mute",mute);disconnect()};},[connect,disconnect,set,setVoiceState]);
  return{connect,disconnect};
}
