import {describe,expect,it} from "vitest";import {clamp,pinchWithHysteresis} from "./spatial";
describe("spatial interaction",()=>{it("uses pinch hysteresis to prevent chatter",()=>{expect(pinchWithHysteresis(.06,false)).toBe(false);expect(pinchWithHysteresis(.06,true)).toBe(true);expect(pinchWithHysteresis(.08,true)).toBe(false)});it("constrains transforms",()=>expect(clamp(12,0,4)).toBe(4))});
