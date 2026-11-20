"use client";
import {useMemo,useState} from "react";
import {Box,Search,ExternalLink,Play} from "lucide-react";
import {DOWNLOADED_MODELS} from "@/lib/asset-registry";
import {executeTool} from "@/lib/tool-executor";
import {useRooH} from "@/lib/store";

const categories:Record<string,string>={all:"همه",technology:"فناوری",product:"وسایل روزمره",furniture:"مبلمان",engineering:"مهندسی",nature:"طبیعت",education:"آموزشی",animal:"حیوانات"};
export function ModelLibrary(){
  const [query,setQuery]=useState(""),[category,setCategory]=useState("all"),[busy,setBusy]=useState<string>();
  const selectedId=useRooH(s=>s.selectedId),objects=useRooH(s=>s.objects);
  const selected=objects.find(object=>object.id===selectedId)?.assetId;
  const items=useMemo(()=>DOWNLOADED_MODELS.filter(model=>(category==="all"||model.category===category)&&[model.name,model.nameFa,...model.keywords].join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),[query,category]);
  async function open(id:string){
    setBusy(id);
    try{
      await executeTool("load_3d_model",{asset_id:id});
      const store=useRooH.getState(),panel=store.panels.find(item=>item.kind==="models");
      if(panel)store.closePanel(panel.id);
    }catch(error){useRooH.getState().set({error:error instanceof Error?error.message:"مدل باز نشد؛ دوباره تلاش کنید."})}
    finally{setBusy(undefined)}
  }
  return <section className="model-library" dir="rtl">
    <div className="model-library-intro"><Box/><div><h2>کتابخانه سه‌بعدی روح</h2><p>{DOWNLOADED_MODELS.length} مدل با فایل و بافت محلی · برای نمایش، یک مدل را انتخاب کنید</p></div></div>
    <label className="model-library-search"><Search/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="جستجو؛ مثلاً ساعت، مبل، روباه…" aria-label="جستجوی مدل سه‌بعدی"/></label>
    <div className="model-categories" role="group" aria-label="دسته‌بندی مدل‌ها">{Object.entries(categories).map(([key,label])=><button key={key} aria-pressed={category===key} onClick={()=>setCategory(key)}>{label}</button>)}</div>
    <p className="model-count" role="status">{items.length} مدل · چرخش با ماوس یا دست، بزرگ‌نمایی با اسکرول</p>
    <div className="model-gallery">{items.map(model=><article className={`model-card${selected===model.id?" is-selected":""}`} key={model.id}>
      <button className="model-preview" onClick={()=>void open(model.id)} disabled={Boolean(busy)} aria-label={`نمایش ${model.nameFa||model.name}`}><img src={model.thumbnail} alt={model.nameFa||model.name} loading="lazy"/>{model.animated&&<span className="model-animated"><Play/>متحرک</span>}</button>
      <div className="model-card-info"><h3>{model.nameFa||model.name}</h3><small dir="ltr">{model.name} · {((model.bytes||0)/1048576).toFixed(1)} MB</small><button className="model-open" disabled={Boolean(busy)} onClick={()=>void open(model.id)}>{busy===model.id?"در حال باز کردن…":"نمایش سه‌بعدی"}</button><details><summary>سازنده و مجوز</summary><p dir="ltr">{model.attribution}<br/>{model.license}</p><a href={model.sourceUrl} target="_blank" rel="noreferrer">منبع اصلی <ExternalLink/></a><a href={`/models/${model.id}/SOURCE.md`} target="_blank" rel="noreferrer">اطلاعات مجوز</a></details></div>
    </article>)}</div>
    {!items.length&&<p className="model-empty">مدلی با این نام پیدا نشد. دسته یا عبارت جستجو را تغییر دهید.</p>}
  </section>
}
