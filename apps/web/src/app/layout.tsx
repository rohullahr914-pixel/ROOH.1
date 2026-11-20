import type { Metadata } from "next";
import "./globals.css";
import "./workspace.css";
import "./neural-interface.css";
import "./cosmic-universe.css";
import "./cinematic.css";
import "./neural-lab.css";
export const metadata: Metadata = { title:"RooH — Living Intelligence", description:"A voice-first multimodal intelligence" };
export default function Layout({children}:{children:React.ReactNode}) { return <html lang="fa" dir="ltr"><body>{children}</body></html> }
