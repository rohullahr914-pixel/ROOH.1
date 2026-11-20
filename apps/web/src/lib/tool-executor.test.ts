import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {executeTool} from "./tool-executor";
import {useRooH} from "./store";

describe("3D tool execution",()=>{
  beforeEach(()=>useRooH.getState().clear());

  it.each([
    ["منظومه شمسی","solar-system"],
    ["کره زمین","earth"],
    ["موتور جت","jet-engine"],
    ["لپ تاپ","geometry"],
    ["پهپاد","geometry"],
  ])("loads %s without an internet asset",async(query,kind)=>{
    const result=await executeTool("load_3d_model",{query});
    const object=useRooH.getState().objects.at(-1);
    expect(result).toMatchObject({loaded:true,source:"built-in",offline:true});
    expect(object).toMatchObject({kind});
    expect(object?.assetUrl).toBeUndefined();
  });
});


describe("voice workspace navigation",()=>{
  beforeEach(()=>{
    useRooH.getState().clear();
    vi.stubGlobal("window",{dispatchEvent:vi.fn(),innerWidth:1200});
  });
  afterEach(()=>vi.unstubAllGlobals());
  it.each(["youtube","knowledge","models","trading"])("opens %s by voice",async section=>{
    await executeTool("open_section",{section});
    expect(useRooH.getState().panels.some(p=>p.kind===section)).toBe(true);
  });
  it("returns home and closes overlays without disconnecting voice",async()=>{
    useRooH.getState().set({voice:"listening"});
    useRooH.getState().openPanel("vision","Vision");
    await executeTool("go_back",{});
    expect(useRooH.getState().panels).toEqual([]);
    expect(useRooH.getState().voice).toBe("listening");
    const events=vi.mocked(window.dispatchEvent).mock.calls.map(([event])=>event.type);
    expect(events).toContain("rooh:stop-vision");
    expect(events).toContain("rooh:close-overlays");
  });
  it("reports the required click when browser rejects voice fullscreen",async()=>{
    vi.stubGlobal("document",{fullscreenElement:null,documentElement:{requestFullscreen:vi.fn().mockRejectedValue(new Error("User gesture required"))}});
    expect(await executeTool("set_fullscreen",{enabled:true})).toMatchObject({fullscreen:false,requires_click:true});
  });
  it("exits fullscreen",async()=>{
    const exitFullscreen=vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("document",{fullscreenElement:{},exitFullscreen});
    expect(await executeTool("set_fullscreen",{enabled:false})).toEqual({fullscreen:false});
    expect(exitFullscreen).toHaveBeenCalledOnce();
  });
});
