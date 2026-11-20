import {setBrowserFullscreen} from "./browser-controls";
import {waTool} from "./whatsapp";
import {api} from "./api";
import {findModelAsset,MODEL_ASSETS} from "./asset-registry";
import {multiSourceModelSearch, findClosestModel} from "./multi-source-models";
import {useRooH} from "./store";

const text=(v:unknown,name:string)=>{if(typeof v!=="string"||!v.trim())throw new Error(`${name} is required`);return v.trim()};
const number=(v:unknown,fallback:number)=>typeof v==="number"&&Number.isFinite(v)?v:fallback;

export async function executeTool(name:string,args:Record<string,unknown>){
  if(typeof window!=="undefined")window.dispatchEvent(new CustomEvent("rooh:tool-action",{detail:{name}}));
  if(["connect_whatsapp","get_whatsapp_status","prepare_whatsapp_message","cancel_whatsapp_message"].includes(name))return waTool(name,args);
  const s=useRooH.getState();
  if(name==="set_fullscreen"){
    if(typeof args.enabled!=="boolean")throw new Error("enabled must be a boolean");
    return setBrowserFullscreen(args.enabled);
  }
  if(name==="go_back"){
    window.dispatchEvent(new Event("rooh:close-overlays"));
    window.dispatchEvent(new Event("rooh:stop-vision"));
    s.clear();
    window.dispatchEvent(new CustomEvent("rooh:navigate",{detail:{destination:"core"}}));
    return{returned:true,destination:"home"};
  }
  if(name==="open_section"){
    const section=String(args.section);
    if(section==="home")return executeTool("go_back",{});
    if(section==="website")return executeTool("open_website_builder",{});
    if(section==="whatsapp")return executeTool("connect_whatsapp",{});
    if(section==="vision")return executeTool("activate_vision",{});
    const titles={youtube:"Media",knowledge:"Knowledge",models:"مدل‌های سه‌بعدی",trading:"Market Analyst"} as const;
    if(!(section in titles))throw new Error("Unknown section");
    s.openPanel(section as keyof typeof titles,titles[section as keyof typeof titles]);
    return{opened:true,section};
  }
  if(name==="open_trading_analyst"||name==="analyze_market"){
    const symbol=String(args.symbol||"XAUUSD"),timeframe=String(args.timeframe||"1h");
    if(!["XAUUSD","EURUSD","GBPUSD"].includes(symbol)||!["1m","5m","15m","1h","4h","1d"].includes(timeframe))throw new Error("Unsupported market selection");
    s.openPanel("trading","MT5 Trading Analyst");
    window.dispatchEvent(new CustomEvent("rooh:trading",{detail:{symbol,timeframe}}));
    if(name==="open_trading_analyst")return{opened:true,symbol,timeframe};
    const r=await fetch(`${api.base}/api/trading/analysis?symbol=${symbol}&timeframe=${timeframe}`,{method:"POST"});
    const body=await r.json();if(!r.ok)throw new Error(body.detail||"Analysis unavailable");
    return body;
  }
  if(name==="open_website_builder"||name==="edit_website"){
    window.dispatchEvent(new CustomEvent("rooh:website-builder",{detail:{prompt:typeof args.prompt==="string"?args.prompt:"",edit:name==="edit_website",auto:true}}));
    return {opened:true,message:"Website builder opened. Generation requires the v0 API key on the server."};
  }
  if(name==="navigate_neural_universe"){
    const destination=String(args.destination||"core");
    if(!["closer","core","network","universe","galaxy"].includes(destination))throw new Error("Unknown neural-space destination");
    window.dispatchEvent(new CustomEvent("rooh:navigate",{detail:{destination}}));
    return{navigating:true,destination};
  }
  if(name==="activate_vision"){s.openPanel("vision","ROOH Vision");return{opened:true,message:"Enable the camera in the panel to consent to snapshots being sent to OpenAI."}}
  if(name==="stop_vision"){window.dispatchEvent(new Event("rooh:stop-vision"));const p=s.panels.find(p=>p.kind==="vision");if(p)s.closePanel(p.id);return{stopped:true}}
  if(name==="analyze_vision"){const {analyzeVision}=await import("./vision");return analyzeVision(text(args.question,"question"));}
  if(["focus_panel","move_panel","resize_panel"].includes(name)){
    const p=s.panels.find(p=>p.id===args.panel_id||p.kind===args.kind);if(!p)throw new Error("Panel not found");
    if(name==="focus_panel")s.focusPanel(p.id);
    const finite=(v:unknown)=>{if(typeof v!=="number"||!Number.isFinite(v))throw new Error("Coordinates must be finite numbers");return v};
    if(name==="move_panel")s.movePanel(p.id,finite(args.x),finite(args.y));
    if(name==="resize_panel")s.resizePanel(p.id,finite(args.width),finite(args.height));
    return{updated:true,panel_id:p.id};
  }
  switch(name){
    case"open_knowledge_panel":case"search_wikipedia":case"open_knowledge_profile":{
      const q=text(args.query,"query"),p=await api.profile(q,String(args.language||"fa"));
      s.set({profile:p});s.openPanel("knowledge",p.title);return{displayed:true,title:p.title,source:p.page_url};
    }
    case"search_youtube":{
      const query=text(args.query,"query"),d=await api.youtube(query);s.set({youtube:d.items,youtubeQuery:query,videoId:undefined,error:undefined});s.openPanel("youtube","Media");
      return{found:true,count:d.items.length,results:d.items.slice(0,5).map(x=>({video_id:x.id,title:x.title,channel:x.channel}))};
    }
    case"open_video_panel":case"open_youtube_video":{
      const id=text(args.video_id,"video_id");
      if(!s.youtube.some(x=>x.id===id))throw new Error("Search YouTube first and choose a video_id from verified results");
      s.set({videoId:id});s.openPanel("youtube","Media");return{opened:true,video_id:id};
    }
    case"control_youtube_player":{
      const action=text(args.action,"action");
      if(action==="close"){
        const panel=s.panels.find(item=>item.kind==="youtube");
        s.set({videoId:undefined});
        if(panel)s.closePanel(panel.id);
        return{closed:true};
      }
      if(action==="next"){
        if(!s.youtube.length)throw new Error("Search YouTube before asking for another video");
        const current=s.youtube.findIndex(item=>item.id===s.videoId),next=s.youtube[(current+1)%s.youtube.length];
        s.set({videoId:next.id,error:undefined});
        if(!s.panels.some(item=>item.kind==="youtube"))s.openPanel("youtube","Media");
        return{opened:true,video_id:next.id,title:next.title};
      }
      if(!s.videoId)throw new Error("Open a YouTube result before controlling playback");
      if(!["play","pause","seek","volume"].includes(action))throw new Error(`Unsupported YouTube action: ${action}`);
      window.dispatchEvent(new CustomEvent("rooh:youtube",{detail:args}));
      return{sent:true,action};
    }
    case"load_3d_model":case"LOAD_MODEL":{
      const query=text(args.query||args.kind||args.asset_id,"query");
      const builtIn=findModelAsset(query);
      if(builtIn?.source==="procedural"){
        const dedicated=["solar-system","earth","jet-engine"].includes(builtIn.id);
        const kind=(dedicated?builtIn.id:"geometry") as "solar-system"|"earth"|"jet-engine"|"geometry";
        s.set({objects:s.objects.filter(o=>!(["model","geometry","solar-system","earth","jet-engine"] as string[]).includes(o.kind)),error:undefined});
        const id=s.addObject(kind,builtIn.name,undefined,{assetId:builtIn.id,attribution:builtIn.attribution,license:builtIn.license,holographic:Boolean(args.holographic)});
        return{loaded:true,object_id:id,name:builtIn.name,source:"built-in",license:builtIn.license,offline:true};
      }
      // Multi-source search
      const results = await multiSourceModelSearch(query);
      const model = results[0];
      if(model){
        if(model.asset_url){
          s.set({objects:s.objects.filter(o=>!o.assetUrl)});
          const id=s.addObject("model",model.name,undefined,{assetId:model.uid,assetUrl:model.asset_url,attribution:model.author,license:model.license,playAnimation:Boolean(builtIn?.animated),holographic:Boolean(args.holographic)});
          return{loaded:true,object_id:id,name:model.name,source:model.source||"registry",license:model.license||"See source"};
        }
        if(model.viewer_url){
          s.set({externalModel:model});
          return{loaded:true,mode:"official_embed",name:model.name,source:model.source||"embed",license:model.license||"See source"};
        }
      }
      return{loaded:false,query,reason:"No reliable matching 3D asset was found. Ask for a broader subject or list available models. A generic model is not an exact digital twin."};
    }
    case"search_3d_models":{
      const query=text(args.query,"query");
      const results = await multiSourceModelSearch(query);
      s.set({models:results});
      return{items:results.slice(0,5).map(m=>({asset_id:m.uid,name:m.name,source:m.source,license:m.license}))};
    }
    case"list_3d_models":{
      s.openPanel("models","مدل‌های سه‌بعدی");
      const items=MODEL_ASSETS.map(asset=>({name:asset.nameFa||asset.name,category:asset.category,examples:asset.keywords.slice(0,4),source:asset.source,license:asset.license}));
      return{items,online_search:"Other subjects can be searched on Sketchfab when its server token is configured. Exact availability is not guaranteed."};
    }
    case"focus_object":s.set({selectedId:text(args.object_id,"object_id")});return{focused:true};
    case"rotate_object":case"ROTATE_MODEL":{const id=String(args.object_id||s.selectedId||""),o=s.objects.find(x=>x.id===id);if(!o)throw new Error("No selected object");s.transformObject(id,{rotation:[number(args.x,o.rotation[0]),number(args.y,o.rotation[1]+.5),number(args.z,o.rotation[2])]});return{rotated:true};}
    case"scale_object":case"SCALE_MODEL":{const id=String(args.object_id||s.selectedId||""),o=s.objects.find(x=>x.id===id);if(!o)throw new Error("No selected object");s.transformObject(id,{scale:Math.max(.25,Math.min(4,number(args.scale,o.scale)))});return{scaled:true};}
    case"reset_model":case"RESET_MODEL":{const id=String(args.object_id||s.selectedId||"");if(!s.objects.some(x=>x.id===id))throw new Error("No selected object");s.transformObject(id,{position:[0,0,0],rotation:[0,0,0],scale:1,selectedPart:undefined,exploded:false});return{reset:true};}
    case"select_model_part":case"highlight_model_part":case"SELECT_PART":case"HIGHLIGHT_PART":{const id=String(args.object_id||s.selectedId||""),part=text(args.part||args.part_name,"part");if(!s.objects.some(x=>x.id===id))throw new Error("No selected object");s.transformObject(id,{selectedPart:part});return{selected:true,part};}
    case"explode_model":case"EXPLODE_MODEL":{const id=String(args.object_id||s.selectedId||""),o=s.objects.find(x=>x.id===id);if(!o)throw new Error("No selected object");const exploded=args.enabled===undefined?!o.exploded:Boolean(args.enabled);s.transformObject(id,{exploded});return{exploded};}
    case"play_model_animation":case"PLAY_ANIMATION":{const id=String(args.object_id||s.selectedId||""),o=s.objects.find(x=>x.id===id);if(!o)throw new Error("No selected object");s.transformObject(id,{playAnimation:args.enabled===undefined?true:Boolean(args.enabled)});return{playing:args.enabled!==false};}
    case"close_model":case"CLOSE_MODEL":{const id=String(args.object_id||s.selectedId||"");if(id)s.removeObject(id);else s.set({externalModel:undefined});return{closed:true};}
    case"close_panel":{const p=s.panels.find(x=>x.id===args.panel_id||x.kind===args.kind);if(!p)throw new Error("Panel not found");s.closePanel(p.id);return{closed:true};}
    case"arrange_workspace":s.arrange();return{arranged:true,count:s.panels.length};
    case"clear_workspace":s.clear();return{cleared:true};
    default:throw new Error(`Unsupported workspace action: ${name}`);
  }
}
