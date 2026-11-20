import { describe, expect, it } from "vitest";
import { classifyHandPose, detectHorizontalSwipe, holdProgress, isPinch, smoothPoint, type HandPoint } from "./gesture";

function hand(tips:[number,number,number,number],pips:[number,number,number,number]):HandPoint[]{
  const points=Array.from({length:21},()=>({x:0,y:0,z:0}));
  points[0]={x:0,y:0,z:0};
  [8,12,16,20].forEach((index,i)=>points[index]={x:0,y:tips[i],z:0});
  [6,10,14,18].forEach((index,i)=>points[index]={x:0,y:pips[i],z:0});
  return points;
}

describe("gesture signal processing", () => {
  it("detects a pinch only inside the calibrated threshold", () => {
    expect(isPinch({ x: 0, y: 0 }, { x: 0.03, y: 0.02 }, 0.05)).toBe(true);
    expect(isPinch({ x: 0, y: 0 }, { x: 0.08, y: 0 }, 0.05)).toBe(false);
  });

  it("smooths noisy pointer movement", () => {
    expect(smoothPoint({ x: 0, y: 0 }, { x: 1, y: 1 }, 0.75)).toEqual({ x: 0.25, y: 0.25 });
  });

  it("classifies an open palm from extended fingers",()=>{
    expect(classifyHandPose(hand([1,1,1,1],[.55,.55,.55,.55]))).toBe("open-palm");
  });

  it("classifies a fist from curled fingers",()=>{
    expect(classifyHandPose(hand([.35,.35,.35,.35],[.62,.62,.62,.62]))).toBe("fist");
  });

  it("requires distance and timing for a horizontal swipe",()=>{
    expect(detectHorizontalSwipe(.5,.2,600)).toBe("left");
    expect(detectHorizontalSwipe(.5,.8,600)).toBe("right");
    expect(detectHorizontalSwipe(.5,.8,1600)).toBeUndefined();
    expect(detectHorizontalSwipe(.5,.6,500)).toBeUndefined();
  });

  it("clamps hold confirmation progress",()=>{
    expect(holdProgress(100,550,900)).toBe(.5);
    expect(holdProgress(100,1200,900)).toBe(1);
  });
});
