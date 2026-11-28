import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  ArrowRight, ChevronDown, Eye, Fingerprint, Grid2X2, Image as ImageIcon, MapPin,
  Menu, ScanSearch, X
} from "lucide-react";
import { cleanexifSupabase } from "./planAccess";
const AccountMenu = lazy(() => import("./AccountMenu").then(module => ({ default: module.AccountMenu })));

const appLinks = [
  { label: "Image Metadata Cleaner", description: "Inspect and remove common image metadata", href: "/#tool", icon: Eye },
  { label: "Watermark Maker", description: "Add a visible watermark to your image", href: "/watermark", icon: ImageIcon },
  { label: "GPS Location Remover", description: "Remove embedded location and metadata", href: "/gps-remover", icon: MapPin },
  { label: "Image Privacy Scanner", description: "Find location, device and identity details", href: "/privacy-scanner", icon: ScanSearch },
  { label: "EXIF Metadata Editor", description: "Edit common EXIF fields in JPEG images", href: "/metadata-editor", icon: Fingerprint }
];

export function SiteHeader(){
 const [open,setOpen]=useState(false);
 const [moreOpen,setMoreOpen]=useState(false);
 const [email,setEmail]=useState<string|null>(null);
 const navRef=useRef<HTMLElement|null>(null);
 const toggleRef=useRef<HTMLButtonElement|null>(null);
 useEffect(()=>{if(!cleanexifSupabase)return;cleanexifSupabase.auth.getSession().then(({data})=>setEmail(data.session?.user.email??null));const {data:{subscription}}=cleanexifSupabase.auth.onAuthStateChange((_event,session)=>setEmail(session?.user.email??null));return()=>subscription.unsubscribe();},[]);
 useEffect(()=>{
  if(!open&&!moreOpen)return;
  const onPointerDown=(event:PointerEvent)=>{
   const target=event.target;
   if(target instanceof Node&&!navRef.current?.contains(target)&&!toggleRef.current?.contains(target)){setOpen(false);setMoreOpen(false);}
  };
  const onKeyDown=(event:KeyboardEvent)=>{
   if(event.key==="Escape"){
    if(moreOpen){setMoreOpen(false);return;}
    setOpen(false);
    toggleRef.current?.focus();
   }
  };
  document.addEventListener("pointerdown",onPointerDown);
  document.addEventListener("keydown",onKeyDown);
  return()=>{document.removeEventListener("pointerdown",onPointerDown);document.removeEventListener("keydown",onKeyDown);};
 },[open,moreOpen]);
 const closeMenus=()=>{setOpen(false);setMoreOpen(false);};
 const isActive=(href:string)=>href==="/#tool"?window.location.pathname==="/"&&window.location.hash==="#tool":window.location.pathname===href;
 return <header className="site-header ce-site-header"><div className="container nav-inner ce-nav-inner">
  <a className="brand" href="/" aria-label="CleanExif home"><img className="brand-logo-image" src="/cleanexif-logo-v2.svg" alt="CleanExif"/></a>
  <button ref={toggleRef} className="ce-mobile-toggle" type="button" aria-label={open?"Close navigation":"Open navigation"} aria-controls="cleanexif-main-navigation" aria-expanded={open} onClick={()=>{setOpen(v=>!v);setMoreOpen(false);}}>{open?<X size={21}/>:<Menu size={21}/>}</button>
  <nav ref={navRef} id="cleanexif-main-navigation" className={"ce-nav-links"+(open?" ce-nav-open":"")} aria-label="Main navigation">
   <div className={"ce-more-apps-wrap"+(moreOpen?" is-open":"")}>
    <button className="ce-more-apps-trigger" type="button" aria-haspopup="true" aria-controls="cleanexif-more-apps" aria-expanded={moreOpen} onClick={()=>setMoreOpen(v=>!v)}>
     <Grid2X2 size={15}/> More Apps <ChevronDown className="ce-more-apps-chevron" size={15}/>
    </button>
    {moreOpen&&<div className="ce-more-apps-menu" id="cleanexif-more-apps">
      <span className="ce-more-apps-heading">IMAGE PRIVACY TOOLS</span>
      {appLinks.map(item=>{const Icon=item.icon;return <a key={item.href} href={item.href} className={isActive(item.href)?"is-active":""} onClick={closeMenus}>
       <span className="ce-more-apps-icon"><Icon size={17}/></span><span className="ce-more-apps-copy"><b>{item.label}</b><small>{item.description}</small></span><ArrowRight className="ce-more-apps-arrow" size={14}/>
      </a>;})}
    </div>}
   </div>
   <a href="/#how-it-works" onClick={closeMenus}>How it works</a>
   <a href="/#privacy" onClick={closeMenus}>Privacy</a>
   <a href="/#faq" onClick={closeMenus}>FAQ</a>
   <a href="/plans" onClick={closeMenus}>Plans</a>
   <a className="button button-primary ce-nav-cta" href="/#tool" onClick={closeMenus}>Start cleaning <ArrowRight size={15}/></a>
   <Suspense fallback={<span className="ce-account-placeholder"/>}><AccountMenu email={email}/></Suspense>
  </nav>
 </div></header>;
}
export function SiteFooter(){
 return <footer className="ce-site-footer"><div className="container ce-footer-inner"><span>© 2026 CleanExif</span><nav aria-label="Legal links"><a href="/privacy-policy">Privacy Policy</a><a href="/terms">Terms</a><a href="/disclaimer">Disclaimer</a><a href="/cookie-policy">Cookie Policy</a></nav></div></footer>;
}
