"use client";
import {useEffect,useState} from 'react';
import {motion,AnimatePresence} from 'framer-motion';
import {WhatsAppRequestError,waArm,waCancel,waConfirm,waDraft,waRequest,waStream,waUnlockLocal,waTool} from '@/lib/whatsapp';
import './whatsapp.css';

type Connection={state:string;qr?:string|null;expires_at?:number|null;account?:string|null;error?:string|null};
type Problem={message:string;transient:boolean};
export function WhatsAppPanel(){
 const [open,setOpen]=useState(false),[state,setState]=useState<Connection>({state:'DISCONNECTED'});
  useEffect(()=>{const close=()=>setOpen(false);window.addEventListener("rooh:close-overlays",close);return()=>window.removeEventListener("rooh:close-overlays",close)},[]);
 const [,setRevision]=useState(0),[error,setError]=useState<Problem|null>(null),[streamError,setStreamError]=useState(''),[notice,setNotice]=useState('');
 const [autoConnect,setAutoConnect]=useState(false),[name,setName]=useState(''),[phone,setPhone]=useState(''),[contacts,setContacts]=useState<{id:string;name:string;phone:string}[]>([]),[now,setNow]=useState(Date.now()),[requesting,setRequesting]=useState(false),[connectStarted,setConnectStarted]=useState(0);
 const [people,setPeople]=useState<{id:string;name:string;phone:string}[]>([]),[selected,setSelected]=useState<{id:string;name:string;phone:string}|null>(null),[messages,setMessages]=useState<{id:string;body:string;fromMe:boolean;hasMedia:boolean}[]>([]),[text,setText]=useState(''),[search,setSearch]=useState('');
 useEffect(()=>{if(!open||state.state!=='CONNECTED')return;let active=true;const refresh=async()=>{try{const [contacts,chats]=await Promise.all([waRequest('/directory'),waRequest('/chats')]);if(active)setPeople(Array.from(new Map([...contacts,...chats].map((c:any)=>[c.id,c])).values()) as typeof people)}catch(e){if(active)setError({message:e instanceof Error?e.message:'Unable to load contacts',transient:true})}};void refresh();const timer=setInterval(()=>void refresh(),30000);return()=>{active=false;clearInterval(timer)}},[open,state.state]);
 useEffect(()=>{setMessages([]);if(!open||state.state!=='CONNECTED'||!selected)return;let active=true;const refresh=async()=>{try{const rows=await waRequest(`/messages?chat=${encodeURIComponent(selected.id)}`);if(active)setMessages(rows)}catch(e){if(active)setError({message:e instanceof Error?e.message:'Unable to load conversation',transient:true})}};void refresh();const timer=setInterval(()=>void refresh(),10000);return()=>{active=false;clearInterval(timer)}},[open,state.state,selected]);
 const {draft,armed,unlocked}=waDraft();
 const busy=requesting||['INITIALIZING','RECONNECTING','AUTHENTICATING'].includes(state.state);
 const run=async(action:()=>Promise<unknown>)=>{try{setError(null);await action()}catch(e){setError({message:e instanceof Error?e.message:'WhatsApp unavailable',transient:e instanceof TypeError||e instanceof WhatsAppRequestError&&e.status>=500})}};
 useEffect(()=>{
   const show=(e:Event)=>{setAutoConnect((e as CustomEvent).detail?.autoConnect!==false);setOpen(true)},update=()=>setRevision(x=>x+1);
   const result=(e:Event)=>{const d=(e as CustomEvent).detail;setNotice(`Message result: ${d.status}. ${d.status==='SENT'?'Accepted by WhatsApp; recipient delivery is not confirmed.':'Check WhatsApp before sending again.'}`)};
   window.addEventListener('rooh:whatsapp-open',show);window.addEventListener('rooh:whatsapp-update',update);window.addEventListener('rooh:whatsapp-result',result);
   const timer=setInterval(()=>setNow(Date.now()),1000);
   return()=>{clearInterval(timer);window.removeEventListener('rooh:whatsapp-open',show);window.removeEventListener('rooh:whatsapp-update',update);window.removeEventListener('rooh:whatsapp-result',result)};
 },[]);
 useEffect(()=>{
   if(!unlocked)return;
   const controller=new AbortController();let retry:ReturnType<typeof setTimeout>;let previous='';
   const receive=(s:Connection)=>{
     if(controller.signal.aborted)return;
     if(s.state==='CONNECTED'&&previous!=='CONNECTED')window.dispatchEvent(new Event('rooh:whatsapp-connected'));
     previous=s.state;setState(s);setStreamError('');
     // A current server event supersedes an earlier service outage, while
     // contact validation errors and message results retain their meaning.
     setError(current=>current?.transient?null:current);
     if(s.state!=='CONNECTED')void waCancel().catch(()=>{});
   };
   const connect=()=>{void waStream(controller.signal,receive).catch(e=>{
     if(controller.signal.aborted)return;
     setState({state:'ERROR'});setStreamError(e.message);void waCancel().catch(()=>{});
     retry=setTimeout(connect,3000);
   })};
   connect();void waRequest('/contacts').then(setContacts).catch(()=>{});
   return()=>{controller.abort();clearTimeout(retry)};
 },[unlocked]);
 const connectAccount=async()=>{
   setRequesting(true);setError(null);setConnectStarted(Date.now());
   try{
     await waUnlockLocal();
     const current:Connection=await waRequest('/status');
     if(autoConnect&&['DISCONNECTED','ERROR'].includes(current.state))await waRequest('/connect',{});
     setState(await waRequest('/status'));
   }finally{setRequesting(false)}
 };
 useEffect(()=>{
   if(!open)return;
   void run(connectAccount);
   // The user's panel-open action starts the QR flow once. Server events
   // update the panel without starting another connection attempt.
   // eslint-disable-next-line react-hooks/exhaustive-deps
 },[open,autoConnect]);
 const remaining=draft?Math.max(0,Math.ceil(draft.expires-now/1000)):0;
 const qrVisible=Boolean(state.qr&&state.expires_at&&state.expires_at>now);
 const qrSeconds=state.expires_at?Math.max(0,Math.ceil((state.expires_at-now)/1000)):0;
 const slowStart=Boolean(connectStarted&&now-connectStarted>15000&&['INITIALIZING','RECONNECTING'].includes(state.state));
 return <>
   <button className="wa-launch" onClick={()=>{setAutoConnect(true);setOpen(x=>!x)}}>◉ WhatsApp{state.state==='CONNECTED'?' ✓':''}</button>
   <AnimatePresence>{open&&<motion.section className="wa-panel" initial={{opacity:0,scale:.9,y:30}} animate={{opacity:1,scale:1,y:0}} exit={{opacity:0,scale:.9}} aria-label="WhatsApp connection">
     <header><b>WhatsApp</b><button onClick={()=>setOpen(false)} aria-label="Close WhatsApp panel">×</button></header>
     {state.state==='CONNECTED'&&<div className="wa-connected" role="status"><i/> <span><b>واتساپ متصل است</b><small>{state.account?`حساب +${state.account}`:'این دستگاه آماده است'}</small></span></div>}
     {(!unlocked||requesting||['DISCONNECTED','INITIALIZING','RECONNECTING'].includes(state.state))&&!error&&!streamError&&!slowStart&&<p className="wa-progress" role="status" dir="rtl">در حال آماده‌سازی کد QR…</p>}
     {slowStart&&!error&&!streamError&&<div className="wa-slow" role="status" dir="rtl"><b>واتساپ هنوز در حال بارگیری است</b><p>برای ساخت QR، هم web.whatsapp.com و هم static.whatsapp.net باید از طریق اینترنت یا VPN در دسترس باشند.</p></div>}
     {qrVisible&&<div className="wa-qr" dir="rtl"><div className="wa-qr-frame"><span className="wa-corner wa-corner-a"/><span className="wa-corner wa-corner-b"/><span className="wa-corner wa-corner-c"/><span className="wa-corner wa-corner-d"/><img src={state.qr!} alt="کد واقعی اتصال واتساپ؛ با گوشی اسکن کنید" width={320} height={320}/></div><h3>اتصال WhatsApp به ROOH</h3><p>در گوشی وارد «دستگاه‌های مرتبط» شو و این کد را اسکن کن.</p><small>WhatsApp ← Linked devices ← Link a device</small><div className="wa-qr-life"><span style={{width:`${Math.min(100,qrSeconds/60*100)}%`}}/><b>{qrSeconds} ثانیه</b></div></div>}
     {state.state==='WAITING_FOR_QR'&&!qrVisible&&<p role="status" dir="rtl">کد تازه تا چند لحظهٔ دیگر ظاهر می‌شود…</p>}
     {state.state==='AUTHENTICATING'&&<p role="status" dir="rtl">در حال وصل‌شدن…</p>}
       {state.state==='CONNECTED'&&<section className="wa-inbox"><h3>Contacts & conversations</h3><input aria-label="Search contacts" placeholder="Search name or number" value={search} onChange={e=>setSearch(e.target.value)}/><div className="wa-contact-list">{people.filter(c=>`${c.name} ${c.phone}`.toLowerCase().includes(search.toLowerCase())).map(c=><button key={c.id} onClick={()=>setSelected(c)} aria-pressed={selected?.id===c.id}>{c.name} · {c.phone}</button>)}{!people.length&&<p>No synced contacts yet.</p>}</div>{selected&&<><h4>{selected.name}</h4><div className="wa-message-list" role="log">{messages.map(m=><p dir="auto" key={m.id}><small>{m.fromMe?'You':selected.name}</small>{m.body||(m.hasMedia?'[Media attachment]':'[Message]')}</p>)}</div><form onSubmit={e=>{e.preventDefault();void run(async()=>{if(!contacts.some(c=>c.phone===selected.phone)){await waRequest('/contacts',{name:selected.name.slice(0,80),phone:selected.phone});setContacts(await waRequest('/contacts'))}await waTool('prepare_whatsapp_message',{recipient:selected.phone,message:text});setText('')})}}><input aria-label="Message" placeholder="Write a message" value={text} onChange={e=>setText(e.target.value)} maxLength={4000} required/><button disabled={!text.trim()}>Review message</button></form></>}</section>}
       {draft&&<article><b>Confirm exact message · {remaining}s</b><p>{draft.recipient} · {draft.phone}</p><blockquote>{draft.message}</blockquote><button disabled={!remaining||armed} onClick={()=>void run(waArm)}>{armed?'Say “Yes, send it” now':'Enable voice confirmation'}</button><button disabled={!remaining} onClick={()=>void run(async()=>{if(!armed)await waArm();await waConfirm('yes, send it')})}>Confirm & send</button><button onClick={()=>void run(waCancel)}>Cancel</button></article>}
       {state.state==='CONNECTED'&&<details><summary>Approved contacts ({contacts.length})</summary>
         {contacts.map(c=><p key={c.id}>{c.name} · {c.phone} <button onClick={()=>void run(async()=>{await waRequest(`/contacts/${c.id}/remove`,{});await waCancel();setContacts(await waRequest('/contacts'))})}>Remove</button></p>)}
         <form onSubmit={e=>{e.preventDefault();void run(async()=>{await waRequest('/contacts',{name,phone});setContacts(await waRequest('/contacts'));setName('');setPhone('')})}}><input aria-label="Contact name" placeholder="Name" value={name} onChange={e=>setName(e.target.value)} required maxLength={80}/><input aria-label="International phone number" placeholder="+14155552671" value={phone} onChange={e=>setPhone(e.target.value)} required pattern="\+[1-9][0-9]{7,14}"/><button>Add approved contact</button></form>
       </details>}
     {state.state==='CONNECTED'&&<button onClick={()=>void run(async()=>{await waCancel();await waRequest('/disconnect',{});setState(await waRequest('/status'));setOpen(false)})}>قطع اتصال</button>}
     {(error?.message||streamError||state.error)&&<div role="alert"><p>{error?.message||streamError||state.error}</p><button disabled={busy} onClick={()=>void run(connectAccount)}>تلاش دوباره</button></div>}
     {notice&&<p role="status">{notice}</p>}
   </motion.section>}</AnimatePresence>
 </>;
}
