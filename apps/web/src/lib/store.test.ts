import {beforeEach,describe,expect,it} from "vitest";
import {useRooH} from "./store";

describe("floating panel layout",()=>{
  beforeEach(()=>useRooH.getState().clear());
  it("retains moved and resized positions when focused again",()=>{
    const s=useRooH.getState(),id=s.openPanel("knowledge","Knowledge");
    s.movePanel(id,5,10);s.resizePanel(id,40,50);s.focusPanel(id);
    expect(useRooH.getState().panels[0]).toMatchObject({id,x:5,y:10,width:40,height:50});
    expect(s.openPanel("knowledge","Knowledge")).toBe(id);
    expect(useRooH.getState().panels).toHaveLength(1);
    expect(useRooH.getState().panels[0].x).toBe(5);
  });
  it("keeps an enlarged panel inside the workspace",()=>{
    const s=useRooH.getState(),id=s.openPanel("youtube","Media");
    s.resizePanel(id,30,30);s.movePanel(id,69,66);s.resizePanel(id,70,78);
    const p=useRooH.getState().panels[0];
    expect(p.x+p.width).toBeLessThanOrEqual(99);
    expect(p.y+p.height).toBeLessThanOrEqual(96);
  });
});
