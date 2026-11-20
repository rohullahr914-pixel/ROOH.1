import downloadedModels from "./downloaded-models.json";
export type AssetSource="khronos"|"procedural"|"sketchfab";

export type ModelAsset={
  id:string;
  name:string;
  nameFa?:string;
  sourceUrl?:string;
  bytes?:number;
  sha256?:string;
  category:string;
  keywords:string[];
  source:AssetSource;
  attribution:string;
  license:string;
  url?:string;
  embedUrl?:string;
  thumbnail?:string;
  animated?:boolean;
};

const KH="https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models";

export const MODEL_CATALOG = downloadedModels as ModelAsset[];
export const DOWNLOADED_MODELS = MODEL_CATALOG.filter(model=>(model.bytes||0)>0);

export const MODEL_ASSETS:ModelAsset[]=[
  ...DOWNLOADED_MODELS,
  {id:"solar-system",name:"Solar System",category:"science",keywords:["solar system","planets","space","منظومه شمسی","سیارات"],source:"procedural",attribution:"RooH procedural model",license:"Project asset"},
  {id:"earth",name:"Earth",category:"science",keywords:["earth","planet","globe","زمین","کره زمین"],source:"procedural",attribution:"RooH procedural model",license:"Project asset"},
  {id:"jet-engine",name:"Jet Engine",category:"engineering",keywords:["jet engine","turbine","aircraft engine","موتور جت","توربین","موتور هواپیما"],source:"procedural",attribution:"RooH parametric assembly",license:"Project asset"},
  {id:"laptop",name:"Laptop",category:"technology",keywords:["laptop","computer","notebook","لپ تاپ","کمپیوتر","رایانه"],source:"procedural",attribution:"RooH procedural model",license:"Project asset"},
  {id:"drone",name:"Quadcopter Drone",category:"technology",keywords:["drone","quadcopter","uav","پهپاد","درون"],source:"procedural",attribution:"RooH procedural model",license:"Project asset"},
  {id:"robot-arm",name:"Robotic Arm",category:"engineering",keywords:["robot arm","robotic arm","industrial robot","بازوی رباتیک","ربات صنعتی"],source:"procedural",attribution:"RooH procedural model",license:"Project asset"},
  {id:"satellite",name:"Satellite",category:"science",keywords:["satellite","spacecraft","space satellite","ماهواره","قمر مصنوعی"],source:"procedural",attribution:"RooH procedural model",license:"Project asset"},
  {id:"wind-turbine",name:"Wind Turbine",category:"energy",keywords:["wind turbine","windmill","renewable energy","توربین بادی","آسیاب بادی"],source:"procedural",attribution:"RooH procedural model",license:"Project asset"},
  {id:"smart-house",name:"Smart House",category:"architecture",keywords:["house","smart house","home","building","خانه","خانه هوشمند","ساختمان"],source:"procedural",attribution:"RooH procedural model",license:"Project asset"},
  {id:"desk-lamp",name:"Desk Lamp",category:"product",keywords:["desk lamp","lamp","light","چراغ مطالعه","لامپ","چراغ"],source:"procedural",attribution:"RooH procedural model",license:"Project asset"},
  {id:"camera",name:"Camera",category:"technology",keywords:["camera","photo camera","photography","دوربین","کمره","عکاسی"],source:"procedural",attribution:"RooH procedural model",license:"Project asset"},
  {id:"microscope",name:"Microscope",category:"science",keywords:["microscope","laboratory","science","میکروسکوپ","آزمایشگاه"],source:"procedural",attribution:"RooH procedural model",license:"Project asset"},
  {id:"gearbox",name:"Gearbox",category:"engineering",keywords:["gearbox","gears","transmission","گیربکس","چرخ دنده","جعبه دنده"],source:"procedural",attribution:"RooH procedural model",license:"Project asset"},
  {id:"car-concept",name:"Concept Car",category:"vehicle",keywords:["car","vehicle","automobile","concept car","موتر","ماشین","خودرو","اتومبیل"],source:"khronos",attribution:"Khronos glTF Sample Assets / Unity Fan",license:"CC BY 4.0",url:`${KH}/CarConcept/glTF-Binary/CarConcept.glb`},
  {id:"cesium-milk-truck",name:"Cesium Milk Truck",category:"vehicle",keywords:["truck","milk truck","کامیون","موتر باربری"],source:"khronos",attribution:"Khronos glTF Sample Assets / Cesium",license:"CC BY 3.0",url:`${KH}/CesiumMilkTruck/glTF-Binary/CesiumMilkTruck.glb`},
  {id:"avocado",name:"Avocado",category:"biology",keywords:["avocado","fruit","food","آووکادو","میوه"],source:"khronos",attribution:"Khronos glTF Sample Assets",license:"CC0",url:`${KH}/Avocado/glTF-Binary/Avocado.glb`},
  {id:"duck",name:"Duck",category:"animal",keywords:["duck","bird","animal","اردک","پرنده"],source:"khronos",attribution:"Khronos glTF Sample Assets / Sony",license:"SCEA Shared Source",url:`${KH}/Duck/glTF-Binary/Duck.glb`},
];

const normalize=(value:string)=>value.toLocaleLowerCase().replace(/[\-_\u200c]/g," ").replace(/ي/g,"ی").replace(/ك/g,"ک").replace(/\s+/g," ").trim();

export function findModelAsset(query:string){
  const q=normalize(query);
  if(!q)return undefined;
  const exact=MODEL_ASSETS.find(asset=>normalize(asset.id)===q||normalize(asset.name)===q||normalize(asset.nameFa||"\0")===q);
  if(exact)return exact;
  const queryWords=new Set(q.split(/\s+/).filter(Boolean));
  let best:{asset:ModelAsset;score:number}|undefined;
  for(const asset of MODEL_ASSETS){
    const terms=[asset.name,asset.nameFa||asset.name,...asset.keywords].map(normalize);
    let score=terms.reduce((n,t)=>{const words=t.split(/\s+/).filter(Boolean),phrase=q.includes(t)||t.includes(q);const wordMatch=words.some(x=>x.length>2&&queryWords.has(x));return n+(q===t?20:phrase&&t.length>3?8:wordMatch?2:0)},0);
    if(asset.id===q)score+=30;
    if(!best||score>best.score)best={asset,score};
  }
  return best&&best.score>0?best.asset:undefined;
}
