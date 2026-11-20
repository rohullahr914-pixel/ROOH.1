import {describe,expect,it} from "vitest";
import {createNeuralGeometry} from "./geometry";

describe("holographic neural geometry",()=>{
  it("generates a deterministic, bounded graph with connected render buffers",()=>{
    const a=createNeuralGeometry("low"),b=createNeuralGeometry("low");
    try{
      const points=a.points.getAttribute("position"),lines=a.lines.getAttribute("position");
      expect(a.nodeCount).toBeGreaterThan(600);
      expect(lines.count).toBeGreaterThan(points.count);
      expect(Array.from(points.array)).toEqual(Array.from(b.points.getAttribute("position").array));
      for(let i=0;i<points.count;i++)expect(Math.hypot(points.getX(i),points.getY(i),points.getZ(i))).toBeLessThanOrEqual(1.5);
      const positions=new Set(Array.from({length:points.count},(_,i)=>`${points.getX(i)},${points.getY(i)},${points.getZ(i)}`));
      for(let i=0;i<lines.count;i++)expect(positions.has(`${lines.getX(i)},${lines.getY(i)},${lines.getZ(i)}`)).toBe(true);
    }finally{a.dispose();b.dispose();}
  });
});
