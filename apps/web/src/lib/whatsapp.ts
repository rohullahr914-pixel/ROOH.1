import {api} from './api';
export type WADraft={id:string;recipient:string;phone:string;message:string;expires:number;confirmation_token:string};
export class WhatsAppRequestError extends Error {
  constructor(message:string,public status:number){super(message);this.name='WhatsAppRequestError'}
}
let token='',session='',draft:WADraft|undefined,armed=false,unlocked=false;
let localUnlock:Promise<void>|undefined;
export function waNotify(){window.dispatchEvent(new Event('rooh:whatsapp-update'))}
export function waOpen(autoConnect=true){window.dispatchEvent(new CustomEvent('rooh:whatsapp-open',{detail:{autoConnect}}))}
export function waDraft(){return {draft,armed,unlocked}}
function expireLocalSession(){unlocked=false;session='';draft=undefined;armed=false;waNotify()}
export async function waRequest(path:string,body?:unknown,signal?:AbortSignal){const r=await fetch(`${api.base}/api/whatsapp${path}`,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`}:{ }),'Content-Type':'application/json','X-ROOH-Local':'1'},credentials:'include',body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal});if(!r.ok){const d=await r.json().catch(()=>({}));if(r.status===401&&!token)expireLocalSession();throw new WhatsAppRequestError(typeof d.detail==='string'?d.detail:'WhatsApp request failed',r.status)}return r.json()}
// Retained for existing programmatic callers; the spatial UI uses an
// HttpOnly local session and never asks the owner to copy a server secret.
export async function waUnlock(value:string){token=value;unlocked=true;try{await waNewSession()}catch(e){token='';unlocked=false;throw e}}
export async function waUnlockLocal(){
  if(localUnlock)return localUnlock;
  if(unlocked)return;
  if(!localUnlock)localUnlock=(async()=>{
    await waRequest('/local-session',{});unlocked=true;
    try{await waNewSession()}catch(error){unlocked=false;throw error}
  })().finally(()=>{localUnlock=undefined});
  return localUnlock;
}
export async function waNewSession(){draft=undefined;armed=false;if(unlocked){session=(await waRequest('/session',{})).session}waNotify()}
export async function waCancel(){draft=undefined;armed=false;waNotify();if(unlocked)return waRequest('/cancel',{})}
export async function waTool(name:string,args:Record<string,unknown>){if(name==='connect_whatsapp'||name==='prepare_whatsapp_message')waOpen(name==='connect_whatsapp');await waUnlockLocal();if(name==='connect_whatsapp'){await waRequest('/connect',{});return {opened:true,...await waRequest('/status'),qr:undefined}}if(name==='get_whatsapp_status'){const s=await waRequest('/status');return {state:s.state,account:s.account,error:s.error}}if(name==='cancel_whatsapp_message'){await waCancel();return {cancelled:true}}if(name==='prepare_whatsapp_message'){const d=await waRequest('/drafts',{recipient:args.recipient,message:args.message,session});if(d.prepared){draft=d;armed=false;waNotify()}const {confirmation_token,...safe}=d;return safe}throw Error('Unsupported WhatsApp action')}
export async function waArm(){if(!draft)throw Error('No draft');await waRequest(`/drafts/${draft.id}/arm`,{session,token:draft.confirmation_token,approval:''});armed=true;waNotify()}
export async function waConfirm(approval:string){const d=draft;if(!d||!armed||Date.now()/1000>d.expires)return;armed=false;draft=undefined;waNotify();const result=await waRequest(`/drafts/${d.id}/confirm`,{session,token:d.confirmation_token,approval});window.dispatchEvent(new CustomEvent('rooh:whatsapp-result',{detail:result}));return result}
export async function waVoiceApproval(text:string){if(armed&&['yes, send it','yes send it','بله ارسال کن','بفرست'].includes(text.trim().toLowerCase().replace(/[.!?؟]+$/u,'')))return waConfirm(text)}
export async function waStream(signal:AbortSignal,onStatus:(s:any)=>void){const r=await fetch(`${api.base}/api/whatsapp/events`,{headers:token?{Authorization:`Bearer ${token}`}:{},credentials:'include',cache:'no-store',signal});if(!r.ok||!r.body)throw Error('WhatsApp event connection unavailable');const reader=r.body.getReader(),decoder=new TextDecoder();let buffer='';while(true){const {done,value}=await reader.read();if(done)throw Error('WhatsApp event connection closed');buffer+=decoder.decode(value,{stream:true});let end;while((end=buffer.indexOf('\n\n'))>=0){const event=buffer.slice(0,end);buffer=buffer.slice(end+2);if(event.includes('event: failure'))throw Error('WhatsApp bridge disconnected');const line=event.split('\n').find(x=>x.startsWith('data: '));if(line)onStatus(JSON.parse(line.slice(6)))}}}
