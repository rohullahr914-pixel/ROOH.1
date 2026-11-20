"use client";
import {useEffect} from "react";
import {Mic,MicOff,PhoneOff} from "lucide-react";
import {useRooH} from "@/lib/store";
import {useLiveVoice} from "@/hooks/use-live-voice";

export function VoiceControls({onEnd}:{onEnd:()=>void}){
  const {connect,disconnect}=useLiveVoice(),{voice,voiceNetwork,micMuted,set}=useRooH();
  useEffect(()=>{void connect()},[connect]);
  function mute(){const next=!micMuted;set({micMuted:next});window.dispatchEvent(new CustomEvent("rooh:mute",{detail:next}))}
  function end(){disconnect();onEnd()}
  const networkHint=voiceNetwork?`پاسخ: ${voiceNetwork.responseMs===undefined?"—":`${voiceNetwork.responseMs} ms`} · صف: ${voiceNetwork.queuedFrames} · مکث صدا: ${voiceNetwork.playbackUnderruns} · اتصال مجدد: ${voiceNetwork.reconnects}`:undefined;
  return <div className="voice-controls compact" title={networkHint}><button className={`mic-button active ${micMuted?"muted":""}`} onClick={mute} aria-label={micMuted?"Unmute microphone":"Mute microphone"}>{micMuted?<MicOff/>:<Mic/>}<i/></button><button className="end-button" onClick={end} aria-label="End voice session"><PhoneOff/></button><span className={`voice-pulse ${voice}`}/></div>
}
