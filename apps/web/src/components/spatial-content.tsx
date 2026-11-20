"use client";
import {useEffect,useRef} from "react";
import {ExternalLink,Play,SkipForward,X} from "lucide-react";
import {useRooH} from "@/lib/store";
import {VisionPanel} from "./vision-panel";
import {ModelLibrary} from "./model-library";
import type {PanelKind} from "@/lib/types";
import {TradingPanel} from "./trading-panel";
declare global{interface Window{YT?:{Player:new(id:string,opts:object)=>YTPlayer};onYouTubeIframeAPIReady?:()=>void}}type YTPlayer={playVideo():void;pauseVideo():void;seekTo(v:number,a:boolean):void;setVolume(v:number):void;getCurrentTime():number;destroy():void};
export function SpatialContent({kind}:{kind:PanelKind}){if(kind==="trading")return <TradingPanel/>;if(kind==="vision")return <VisionPanel/>;if(kind==="knowledge")return <Knowledge/>;if(kind==="youtube")return <YouTube/>;if(kind==="models")return <ModelLibrary/>;return null}
function Knowledge(){const profile=useRooH(s=>s.profile);if(!profile)return null;return <article dir={profile.language==="fa"?"rtl":"ltr"} className="knowledge-card focused">{profile.image&&<img src={profile.image.url} alt={profile.title}/>}<div><small>WIKIPEDIA · SOURCE LINKED</small><h2>{profile.title}</h2>{profile.description&&<em>{profile.description}</em>}<p>{profile.extract}</p><a href={profile.page_url} target="_blank" rel="noreferrer">Open source <ExternalLink/></a></div></article>}
function YouTube(){
	const {videoId,youtube,youtubeQuery,set,openPanel,closePanel,panels}=useRooH(),player=useRef<YTPlayer>();
	useEffect(()=>{
		if(!videoId)return;
		const build=()=>{player.current?.destroy();player.current=new window.YT!.Player("spatial-youtube-player",{videoId,playerVars:{playsinline:1,rel:0,autoplay:1},events:{onReady:()=>player.current?.playVideo(),onError:()=>set({error:"This video cannot be embedded. Choose another result or open it on YouTube."})}})};
		if(window.YT)build();else{window.onYouTubeIframeAPIReady=build;if(!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')){const script=document.createElement("script");script.src="https://www.youtube.com/iframe_api";script.onerror=()=>set({error:"The YouTube player could not load. Check your connection and try again."});document.head.appendChild(script)}}
		const control=(event:Event)=>{const detail=(event as CustomEvent).detail,p=player.current;if(!p)return;if(detail.action==="play")p.playVideo();if(detail.action==="pause")p.pauseVideo();if(detail.action==="seek")p.seekTo(detail.relative?p.getCurrentTime()+detail.value:detail.value,true);if(detail.action==="volume")p.setVolume(detail.value??50)};
		window.addEventListener("rooh:youtube",control);
		return()=>{window.removeEventListener("rooh:youtube",control);player.current?.destroy();player.current=undefined};
	},[videoId,set]);
	function choose(id:string){set({videoId:id,error:undefined});if(!panels.some(panel=>panel.kind==="youtube"))openPanel("youtube","Media")}
	function next(){const current=youtube.findIndex(item=>item.id===videoId),item=youtube[(current+1)%youtube.length];if(item)choose(item.id)}
	function close(){set({videoId:undefined});const panel=panels.find(item=>item.kind==="youtube");if(panel)closePanel(panel.id)}
	return <section className="youtube-workspace">
		{videoId?<><div className="video-frame immersive"><div id="spatial-youtube-player"/></div><div className="youtube-current"><span>{youtube.find(item=>item.id===videoId)?.title||"Now playing"}</span><div><button onClick={next} aria-label="Play next result" title="Next result"><SkipForward/></button><button onClick={close} aria-label="Close YouTube" title="Close YouTube"><X/></button></div></div></>:youtube.length===0?<p className="youtube-empty">{youtubeQuery?`No videos found for “${youtubeQuery}”. Try a broader search.`:"Search YouTube by voice to see real results."}</p>:null}
		{youtube.length>0&&<div className="youtube-results" aria-label="YouTube search results">{youtube.map((item,index)=><button className={`youtube-result${item.id===videoId?" selected":""}`} key={item.id} onClick={()=>choose(item.id)}><img src={item.thumbnail} alt="" loading="lazy"/><span><b>{item.title}</b><small>{item.channel}</small></span><i>{item.id===videoId?"PLAYING":<><Play/> {index+1}</>}</i></button>)}</div>}
	</section>
}
