import { useCallback, useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const url=import.meta.env.VITE_SUPABASE_URL as string|undefined;
const key=import.meta.env.VITE_SUPABASE_ANON_KEY as string|undefined;

export const cleanexifSupabase=url&&key
  ?createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}})
  :null;

export type CleanExifTool="metadata"|"watermark"|"gps"|"scanner"|"editor";
export type PlanLimits={
  code:string;
  name:string;
  maxImages:number;
  totalMB:number;
  maxFileMB:number;
  dailyImages:number;
  metadataDailyImages:number;
  watermarkDailyImages:number;
  gpsDailyImages:number;
  scannerDailyImages:number;
  editorDailyImages:number;
  expiresAt:string|null;
};
type DailyUsage={used:number;limit:number;remaining:number;resetsAt:string};

const FREE:PlanLimits={
  code:"free",name:"Free",maxImages:10,totalMB:100,maxFileMB:25,dailyImages:10,
  metadataDailyImages:10,watermarkDailyImages:10,gpsDailyImages:5,
  scannerDailyImages:5,editorDailyImages:2,expiresAt:null
};

function getToolLimit(tool:CleanExifTool,limits:PlanLimits){
  switch(tool){
    case "watermark":return limits.watermarkDailyImages;
    case "gps":return limits.gpsDailyImages;
    case "scanner":return limits.scannerDailyImages;
    case "editor":return limits.editorDailyImages;
    default:return limits.metadataDailyImages;
  }
}

export function usePlanAccess(tool:CleanExifTool="metadata"){
 const [limits,setLimits]=useState<PlanLimits>(FREE);
 const [email,setEmail]=useState<string|null>(null);
 const [loading,setLoading]=useState(true);
 const [dailyUsage,setDailyUsage]=useState<DailyUsage|null>(null);
 const [now,setNow]=useState(Date.now());

 const refresh=useCallback(async()=>{
  if(!cleanexifSupabase){setLoading(false);setEmail(null);setDailyUsage(null);return;}
  const {data:{session}}=await cleanexifSupabase.auth.getSession();
  setEmail(session?.user.email??null);
  if(!session){
    setLimits(FREE);
    setDailyUsage(null);
    setLoading(false);
    return;
  }
  const [access,usage]=await Promise.all([
    cleanexifSupabase.rpc("cleanexif_get_my_access"),
    cleanexifSupabase.rpc("cleanexif_get_my_daily_usage",{p_tool:tool})
  ]);
  const row=!access.error&&Array.isArray(access.data)?access.data[0]:null;
  const legacyDaily=Number(row?.daily_images_limit??10);
  const metadataDaily=Number(row?.metadata_daily_limit??legacyDaily);
  const nextLimits:PlanLimits=row?{
    code:row.plan_code,
    name:row.plan_name,
    maxImages:Number(row.watermark_images_per_batch??10),
    totalMB:Number(row.watermark_total_mb??100),
    maxFileMB:Number(row.max_file_mb??25),
    dailyImages:metadataDaily,
    metadataDailyImages:metadataDaily,
    watermarkDailyImages:Number(row.watermark_daily_limit??legacyDaily),
    gpsDailyImages:Number(row.gps_daily_limit??5),
    scannerDailyImages:Number(row.scanner_daily_limit??legacyDaily),
    editorDailyImages:Number(row.editor_daily_limit??2),
    expiresAt:row.expires_at??null
  }:FREE;
  setLimits(nextLimits);
  if(!usage.error&&Array.isArray(usage.data)&&usage.data[0]){
    const u=usage.data[0];
    setDailyUsage({
      used:Number(u.used_count),
      limit:Number(u.daily_limit),
      remaining:Number(u.remaining),
      resetsAt:u.resets_at
    });
  }else setDailyUsage(null);
  setLoading(false);
 },[tool]);

 useEffect(()=>{
  if(!cleanexifSupabase){setLoading(false);return;}
  let alive=true;
  const run=async()=>{if(alive)await refresh();};
  void run();
  const {data:{subscription}}=cleanexifSupabase.auth.onAuthStateChange(()=>{
    window.setTimeout(()=>{if(alive){setLoading(true);void run();}},0);
  });
  const onFocus=()=>void run();
  window.addEventListener("focus",onFocus);
  const poll=window.setInterval(()=>void run(),60000);
  const clock=window.setInterval(()=>setNow(Date.now()),1000);
  return()=>{
    alive=false;
    subscription.unsubscribe();
    window.removeEventListener("focus",onFocus);
    window.clearInterval(poll);
    window.clearInterval(clock);
  };
 },[refresh]);

 const resetMs=dailyUsage?Math.max(0,new Date(dailyUsage.resetsAt).getTime()-now):0;
 const resetCountdown=Math.floor(resetMs/3600000)+"h "+
   Math.floor((resetMs%3600000)/60000)+"m "+
   Math.floor((resetMs%60000)/1000)+"s";
 const expiryMs=limits.expiresAt?new Date(limits.expiresAt).getTime()-now:null;
 const isPlanExpired=expiryMs!==null&&expiryMs<=0;
 const expiryCountdown=expiryMs===null?null:isPlanExpired?"Expired":
   Math.floor(expiryMs/86400000)+"d "+
   Math.floor((expiryMs%86400000)/3600000)+"h "+
   Math.floor((expiryMs%3600000)/60000)+"m "+
   Math.floor((expiryMs%60000)/1000)+"s";
 const effectiveLimits=isPlanExpired?FREE:limits;
 const isLocked=!!dailyUsage&&dailyUsage.remaining<=0;

 const consumeImage=async()=>{
  if(!cleanexifSupabase)throw new Error("Daily usage service is unavailable. Please try again later.");
  if(isLocked)throw new Error("Daily limit reached. Your next allowance starts in "+resetCountdown+".");
  const {data,error}=await cleanexifSupabase.rpc("cleanexif_consume_daily_image",{p_tool:tool});
  if(error)throw new Error(error.message||"Could not verify your daily allowance. Please sign in and try again.");
  const row=Array.isArray(data)?data[0]:null;
  if(!row)throw new Error("Daily allowance could not be verified. Please try again.");
  setDailyUsage({
    used:Number(row.used_count),limit:Number(row.daily_limit),
    remaining:Number(row.remaining),resetsAt:row.resets_at
  });
  if(!row.allowed)throw new Error("Daily limit reached ("+row.daily_limit+" "+tool+" credits). Your credits reset at "+new Date(row.resets_at).toLocaleTimeString()+".");
  return row;
 };

 return{
  limits:effectiveLimits,
  email,
  loading,
  isPaid:effectiveLimits.code!=="free",
  dailyUsage,
  consumeImage,
  refresh,
  isLocked,
  resetCountdown,
  isPlanExpired,
  expiryCountdown,
  toolDailyLimit:getToolLimit(tool,effectiveLimits)
 };
}
