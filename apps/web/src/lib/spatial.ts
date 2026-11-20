import type {SpatialPanel} from "./types";
export const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
export function pinchWithHysteresis(distance:number,wasPinching:boolean,start=.052,end=.075){return wasPinching?distance<end:distance<start}
export function normalizedDistance(a:{x:number;y:number;z?:number},b:{x:number;y:number;z?:number}){return Math.hypot(a.x-b.x,a.y-b.y,(a.z||0)-(b.z||0))}
export function nextCollisionFree(panels:SpatialPanel[],width=38,height=48){const candidates=[[4,12],[58,10],[6,52],[60,50],[31,24]];return candidates.find(([x,y])=>!panels.some(p=>x<p.x+p.width&&x+width>p.x&&y<p.y+p.height&&y+height>p.y))||candidates[panels.length%candidates.length]}
