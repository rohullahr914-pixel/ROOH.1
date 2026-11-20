export async function setBrowserFullscreen(enabled:boolean){
  if(!enabled){
    if(document.fullscreenElement)await document.exitFullscreen();
    return{fullscreen:false};
  }
  if(document.fullscreenElement)return{fullscreen:true};
  if(!document.documentElement.requestFullscreen)throw new Error("Fullscreen is unavailable in this browser");
  try{
    await document.documentElement.requestFullscreen();
    return{fullscreen:true};
  }catch{
    window.dispatchEvent(new Event("rooh:fullscreen-pending"));
    return{fullscreen:false,requires_click:true,message:"برای ورود به تمام‌صفحه، روی دکمهٔ تمام‌صفحه کلیک کنید."};
  }
}
