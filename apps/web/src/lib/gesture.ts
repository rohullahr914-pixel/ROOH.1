export type Point = { x: number; y: number };
export type HandPoint = Point & { z?: number };
export type HandPose = "open-palm" | "fist" | "point" | "neutral";

export function smoothPoint(previous: Point, next: Point, smoothing: number): Point {
  const weight = Math.max(0, Math.min(0.98, smoothing));
  return { x: previous.x * weight + next.x * (1 - weight), y: previous.y * weight + next.y * (1 - weight) };
}

export function isPinch(thumb: Point, index: Point, threshold: number): boolean {
  return Math.hypot(index.x - thumb.x, index.y - thumb.y) < threshold;
}

function distance(a: HandPoint, b: HandPoint): number {
  return Math.hypot(a.x-b.x,a.y-b.y,(a.z??0)-(b.z??0));
}

export function classifyHandPose(hand: HandPoint[]): HandPose {
  if(hand.length<21)return "neutral";
  const wrist=hand[0],tips=[8,12,16,20],pips=[6,10,14,18];
  const extended=tips.map((tip,index)=>distance(hand[tip],wrist)>distance(hand[pips[index]],wrist)*1.12);
  const curled=tips.map((tip,index)=>distance(hand[tip],wrist)<distance(hand[pips[index]],wrist)*.96);
  if(extended.every(Boolean))return "open-palm";
  if(curled.every(Boolean))return "fist";
  if(extended[0]&&extended.slice(1).filter(Boolean).length===0)return "point";
  return "neutral";
}

export function detectHorizontalSwipe(startX:number,currentX:number,elapsedMs:number,threshold=.22,maxDurationMs=1400):"left"|"right"|undefined{
  if(elapsedMs>maxDurationMs||Math.abs(currentX-startX)<threshold)return undefined;
  return currentX>startX?"right":"left";
}

export function holdProgress(startedAt:number|undefined,now:number,durationMs:number):number{
  if(startedAt===undefined)return 0;
  return Math.max(0,Math.min(1,(now-startedAt)/durationMs));
}
