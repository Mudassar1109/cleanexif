import { lazy, Suspense, useEffect, useState } from "react";
import { ArrowRight, Menu, X } from "lucide-react";
import { cleanexifSupabase } from "./planAccess";
const AccountMenu = lazy(() => import("./AccountPage").then(module => ({ default: module.AccountMenu })));

export function SiteHeader(){
 const [open,setOpen]=useState(false);
 const [email,setEmail]=useState<string|null>(null);
 useEffect(()=>{if(!cleanexifSupabase)return;cleanexifSupabase.auth.getSession().then(({data})=>setEmail(data.session?.user.email??null));const {data:{subscription}}=cleanexifSupabase.auth.onAuthStateChange((_event,session)=>setEmail(session?.user.email??null));return()=>subscription.unsubscribe();},[]);
 const links=[
  {label:"Cleaner",href:"/#tool"},
  {label:"Watermark",href:"/watermark"},
  {label:"GPS remover",href:"/gps-remover"},
  {label:"Privacy scanner",href:"/privacy-scanner"},
  {label:"EXIF editor",href:"/metadata-editor"},
  {label:"How it works",href:"/#how-it-works"},
  {label:"Privacy",href:"/#privacy"},
  {label:"FAQ",href:"/#faq"},
  {label:"Plans",href:"/plans"}
 ];
 return <header className="site-header ce-site-header"><div className="container nav-inner ce-nav-inner">
  <a className="brand" href="/" aria-label="CleanExif home"><img className="brand-logo-image" src="/cleanexif-logo-v2.svg" alt="CleanExif"/></a>
  <button className="ce-mobile-toggle" type="button" aria-label={open?"Close navigation":"Open navigation"} aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{open?<X size={21}/>:<Menu size={21}/>}</button>
  <nav className={"ce-nav-links"+(open?" ce-nav-open":"")} aria-label="Main navigation">
   {links.map(link=><a key={link.href+link.label} href={link.href} onClick={()=>setOpen(false)}>{link.label}</a>)}
   <a className="button button-primary ce-nav-cta" href="/#tool" onClick={()=>setOpen(false)}>Start cleaning <ArrowRight size={15}/></a>
   <Suspense fallback={<span className="ce-account-placeholder"/>}><AccountMenu email={email}/></Suspense>
  </nav>
 </div></header>;
}
export function SiteFooter(){
 return <footer className="ce-site-footer"><div className="container ce-footer-inner"><span>© 2026 CleanExif</span><nav aria-label="Legal links"><a href="/privacy-policy">Privacy Policy</a><a href="/terms">Terms</a><a href="/disclaimer">Disclaimer</a><a href="/cookie-policy">Cookie Policy</a></nav></div></footer>;
}
