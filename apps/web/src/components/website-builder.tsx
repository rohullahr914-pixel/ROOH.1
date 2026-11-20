"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import "./website-builder.css";

type Project = {id:string;title:string;status:string;message_id?:string;deployment_id?:string;message?:string};
const base = `${api.base}/api/website`;
async function request<T>(path:string, options?:RequestInit):Promise<T> {
  const response = await fetch(base + path, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.detail === "string" ? body.detail : `Request failed (${response.status})`);
  }
  return response.json();
}

export function WebsiteBuilder() {
  const [open,setOpen]=useState(false),[projects,setProjects]=useState<Project[]>([]),[current,setCurrent]=useState<Project|null>(null);
  const [prompt,setPrompt]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[viewport,setViewport]=useState<"desktop"|"tablet"|"mobile">("desktop");
  const [messages,setMessages]=useState<Array<{id:string;role:string;content:string}>>([]),[files,setFiles]=useState<Array<{path:string;content:string;encoding:string}>>([]),[tab,setTab]=useState<"preview"|"code">("preview"),[file,setFile]=useState("");
  useEffect(()=>{const close=()=>setOpen(false);window.addEventListener("rooh:close-overlays",close);return()=>window.removeEventListener("rooh:close-overlays",close)},[]);
  const refresh=useCallback(async()=>{try{setProjects((await request<{projects:Project[]}>("/projects")).projects)}catch(e){setError((e as Error).message)}},[]);
  useEffect(()=>{const handler=(event:Event)=>{setOpen(true);const detail=(event as CustomEvent<{prompt?:string;edit?:boolean;auto?:boolean}>).detail;const p=detail?.prompt;if(p){setPrompt(p);if(detail.auto)void sendPrompt(p,Boolean(detail.edit))}};window.addEventListener("rooh:website-builder",handler);return()=>window.removeEventListener("rooh:website-builder",handler)},[current,busy]);
  useEffect(()=>{if(open)void refresh()},[open,refresh]);
  useEffect(()=>{if(!open||!current)return;let cancelled=false;const poll=async()=>{try{const next=await request<Project>(`/projects/${current.id}`);if(cancelled)return;setCurrent(next);if(next.status!=="queued"){
    const [history,source]=await Promise.all([request<{messages?:typeof messages;data?:typeof messages}>(`/projects/${next.id}/messages`),request<{files:typeof files}>(`/projects/${next.id}/files`)]);
    if(!cancelled){setMessages(history.messages||history.data||[]);setFiles(source.files||[]);setFile(f=>f||source.files?.[0]?.path||"")}
  }}catch(e){if(!cancelled)setError((e as Error).message)}};void poll();const timer=setInterval(poll,current.status==="queued"?4000:12000);return()=>{cancelled=true;clearInterval(timer)}},[open,current?.id,current?.status]);
  async function sendPrompt(value:string, edit:boolean){const text=value.trim();if(!text||busy)return;if(edit&&!current){setError("Select a website to edit first");return}setBusy(true);setError("");try{const next=await request<Project>(edit?`/projects/${current!.id}/messages`:"/projects",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:text})});setCurrent(next);setPrompt("");setTab("preview");await refresh()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  async function submit(){await sendPrompt(prompt,Boolean(current))}
  async function publish(){if(!current)return;setBusy(true);setError("");try{const result=await request<{deploymentId?:string;vercelProjectId?:string}>(`/projects/${current.id}/publish`,{method:"POST"});setCurrent({...current,deployment_id:result.deploymentId});await refresh()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  if(!open)return null;
  return <section className="website-builder" aria-label="AI website builder"><header><div><small>ROOH / CREATION STUDIO</small><h2>Website Builder</h2></div><button onClick={()=>setOpen(false)} aria-label="Close website builder">×</button></header>
    <div className="website-layout"><aside><button onClick={()=>{setCurrent(null);setMessages([]);setFiles([]);setPrompt("")}}>+ New website</button><small>PROJECT HISTORY</small>{projects.map(p=><button key={p.id} className={current?.id===p.id?"selected":""} onClick={()=>{setCurrent(p);setMessages([]);setFiles([])}}><b>{p.title}</b><span>{p.status}</span></button>)}</aside>
    <div className="website-main"><div className="website-toolbar"><div><button className={tab==="preview"?"selected":""} onClick={()=>setTab("preview")}>Live preview</button><button className={tab==="code"?"selected":""} onClick={()=>setTab("code")}>Source code</button></div><div><select aria-label="Preview size" value={viewport} onChange={e=>setViewport(e.target.value as typeof viewport)}><option value="desktop">Desktop</option><option value="tablet">Tablet</option><option value="mobile">Mobile</option></select>{current&&<a href={`${base}/projects/${current.id}/export`}>Export ZIP</a>}{current?.status==="ready"&&<button onClick={publish} disabled={busy}>Publish</button>}</div></div>
    {current?<><div className="website-canvas">{tab==="preview"?<div className={`website-frame ${viewport}`}><iframe key={`${current.id}:${current.status}`} title="Generated website preview" src={`/api/v0-preview/${current.id}/`} sandbox="allow-scripts allow-forms allow-popups" /></div>:<div className="website-code"><select aria-label="Source file" value={file} onChange={e=>setFile(e.target.value)}>{files.map(f=><option key={f.path}>{f.path}</option>)}</select><pre>{files.find(f=>f.path===file)?.encoding==="utf8"?files.find(f=>f.path===file)?.content:"Binary file — use Export ZIP"}</pre></div>}</div><div className="website-conversation">{messages.map(m=><p key={m.id}><b>{m.role}</b> {m.content}</p>)}</div><p className="website-status">{current.status==="queued"?"v0 is building your website…":current.status==="error"?"Generation failed. You can send a new instruction.":current.deployment_id?`Deployment started: ${current.deployment_id}`:"Ready for edits"}</p></>:<div className="website-empty"><h3>Describe a website to build</h3><p>Start with a goal, style, and the pages you need. You can also ask ROOH by voice to open the builder.</p></div>}
    <form onSubmit={e=>{e.preventDefault();void submit()}}><textarea aria-label={current?"Describe an edit":"Describe a website"} placeholder={current?"Describe what to change…":"Build a responsive portfolio for…"} value={prompt} onChange={e=>setPrompt(e.target.value)} maxLength={8000}/><button disabled={busy||prompt.trim().length<3||current?.status==="queued"}>{busy?"Sending…":current?"Edit website":"Generate website"}</button></form>{error&&<p role="alert" className="website-error">{error}</p>}</div></div></section>
}
