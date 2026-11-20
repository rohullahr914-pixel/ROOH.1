import {expect,it} from "vitest";
import {pcmToUlaw,ulawToPcm} from "./audio-codec";

it("halves PCM payload while preserving intelligible sample amplitude",()=>{
  const source=new Int16Array([0,1000,-1000,8000,-8000,20000,-20000]);
  const encoded=pcmToUlaw(source);
  const decoded=ulawToPcm(encoded);
  expect(encoded.byteLength).toBe(source.byteLength/2);
  decoded.forEach((value,index)=>expect(Math.abs(value-source[index])).toBeLessThan(Math.max(40,Math.abs(source[index])*0.08)));
});
