export type VoiceState="idle"|"connecting"|"listening"|"processing"|"speaking"|"interrupted"|"reconnecting"|"disconnected"|"error";
export type CameraState="disabled"|"requesting"|"active"|"hand-detected"|"gesture-active"|"tracking-lost"|"error";
export type PanelKind="knowledge"|"youtube"|"models"|"transcript"|"vision"|"trading";
export type SceneObjectKind="solar-system"|"earth"|"jet-engine"|"geometry"|"model";
export type Transcript={id:string;role:"user"|"assistant";text:string};
export type YouTubeItem={id:string;title:string;channel:string;thumbnail:string};
export type ModelItem={uid:string;name:string;author:string;thumbnail?:string;viewer_url?:string;license?:string;source?:"sketchfab"|"khronos"|"polyhaven"|"smithsonian"|"wikimedia";asset_url?:string};
export type Profile={title:string;description?:string;extract:string;page_url:string;image?:{url:string;width?:number;height?:number};language:string};
export type SpatialPanel={id:string;kind:PanelKind;title:string;x:number;y:number;width:number;height:number;z:number;minimized?:boolean};
export type SceneObject={id:string;kind:SceneObjectKind;label:string;position:[number,number,number];rotation:[number,number,number];scale:number;assetId?:string;assetUrl?:string;attribution?:string;license?:string;model?:ModelItem;selectedPart?:string;exploded?:boolean;holographic?:boolean;playAnimation?:boolean};
export type GestureFrame={pointer:{x:number;y:number};hands:number;pinching:boolean;openPalm:boolean;pose?:"open-palm"|"fist"|"point"|"neutral";holdProgress?:number;rotation?:number;spread?:number;target?:"panel"|"object"|"control"|"scene"|"region"};
export type WorkspaceAction=
 |{type:"open_knowledge_panel";query:string;language?:string}
 |{type:"search_youtube";query:string}
 |{type:"open_video_panel";video_id:string}
 |{type:"load_3d_model";kind:"solar-system"|"earth"|"geometry";label?:string}
 |{type:"focus_object";object_id:string}
 |{type:"rotate_object";object_id?:string;x?:number;y?:number;z?:number}
 |{type:"scale_object";object_id?:string;scale:number}
 |{type:"close_panel";panel_id?:string;kind?:PanelKind}
 |{type:"arrange_workspace"}
 |{type:"clear_workspace"};
