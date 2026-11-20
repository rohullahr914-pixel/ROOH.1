"use client";

import {PointerEvent,useRef} from "react";
import {Maximize2,Minus,X} from "lucide-react";
import {useRooH} from "@/lib/store";
import type {PanelKind,SpatialPanel as Panel} from "@/lib/types";

const roleMarks:Record<PanelKind,string>={youtube:"▶",knowledge:"◆",models:"◇",transcript:"≋",vision:"◉",trading:"↗"};

function PanelRobot({kind}:{kind:PanelKind}){
  return <span className={`panel-robot panel-robot--${kind}`} aria-hidden="true">
    <i className="panel-robot__antenna"/>
    <i className="panel-robot__head"><i className="panel-robot__eyes"/></i>
    <i className="panel-robot__body">{roleMarks[kind]}</i>
    <i className="panel-robot__arm panel-robot__arm--left"/>
    <i className="panel-robot__arm panel-robot__arm--right"/>
  </span>;
}

export function SpatialPanel({panel,children}:{panel:Panel;children:React.ReactNode}){
  const {closePanel,focusPanel,movePanel,resizePanel,set}=useRooH();
  const drag=useRef<{x:number;y:number;px:number;py:number}>();
  function down(e:PointerEvent){if((e.target as HTMLElement).closest("button,input,a"))return;drag.current={x:e.clientX,y:e.clientY,px:panel.x,py:panel.y};e.currentTarget.setPointerCapture(e.pointerId);focusPanel(panel.id)}
  function move(e:PointerEvent){if(!drag.current)return;movePanel(panel.id,drag.current.px+(e.clientX-drag.current.x)/innerWidth*100,drag.current.py+(e.clientY-drag.current.y)/innerHeight*100)}
  return <section data-panel-id={panel.id} data-panel-kind={panel.kind} className="spatial-panel" style={{left:`${panel.x}%`,top:`${panel.y}%`,width:`${panel.width}%`,height:panel.minimized?"48px":`${panel.height}%`,zIndex:panel.z}} onPointerDown={()=>focusPanel(panel.id)}>
    <header onPointerDown={down} onPointerMove={move} onPointerUp={()=>drag.current=undefined} onPointerCancel={()=>drag.current=undefined} onLostPointerCapture={()=>drag.current=undefined} className="panel-handle">
      <span className="signal-dot"/><PanelRobot kind={panel.kind}/><b>{panel.title}</b>
      <div><button aria-label={panel.minimized?"Restore panel":"Minimize panel"} onClick={()=>set({panels:useRooH.getState().panels.map(p=>p.id===panel.id?{...p,minimized:!p.minimized}:p)})}><Minus/></button><button aria-label="Resize panel" onClick={()=>resizePanel(panel.id,panel.width>55?38:62,panel.height>65?48:72)}><Maximize2/></button><button aria-label="Close panel" onClick={()=>closePanel(panel.id)}><X/></button></div>
    </header>
    <div className="panel-content scrollbar" hidden={panel.minimized} style={panel.minimized ? {display:"none"} : undefined}>{children}</div>
  </section>;
}
