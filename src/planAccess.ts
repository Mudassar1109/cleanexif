import { useCallback, useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
const url=import.meta.env.VITE_SUPABASE_URL as string|undefined;
const key=import.meta.env.VITE_SUPABASE_ANON_KEY as string|undefined;
export const cleanexifSupabase=url&&key?createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}):null;
export type PlanLimits={code:string;name:string;maxImages:number;totalMB:number;maxFileMB:number;dailyImages:number;expiresAt:string|null};
const FREE:PlanLimits={code:"free",name:"Free",maxImages:10,totalMB:100,maxFileMB:25,dailyImages:10,expiresAt:null};
type DailyUsage={used:number;limit:number;remaining:number;resetsAt:string};
export type CleanExifTool = "metadata" | "watermark";
export function usePlanAccess(tool: CleanExifTool = "metadata"){
 const [limits,setLimits]=useState<PlanLimits>(FREE),[email,setEmail]=useState<string|null>(null),[loading,setLoading]=useState(true),[dailyUsage,setDailyUsage]=useState<DailyUsage|null>(null),[now,setNow]=useState(Date.now());
 const refresh=useCallback(async()=>{
  if(!cleanexifSupabase){setLoading(false);return;}
  const {data:{session}}=await cleanexifSupabase.auth.getSession();
  setEmail(session?.user.email??null);
  if(!session){setLimits(FREE);setDailyUsage(null);setLoading(false);return;}
  const [access,usage]=await Promise.all([cleanexifSupabase.rpc("cleanexif_get_my_access"),cleanexifSupabase.rpc("cleanexif_get_my_daily_usage",{p_tool:tool})]);
  const row=!access.error&&Array.isArray(access.data)?access.data[0]:null;
  setLimits(row?{code:row.plan_code,name:row.plan_name,maxImages:row.watermark_images_per_batch,totalMB:row.watermark_total_mb,maxFileMB:row.max_file_mb,dailyImages:row.daily_images_limit??10,expiresAt:row.expires_at}:FREE);
  if(!usage.error&&Array.isArray(usage.data)&&usage.data[0]){const u=usage.data[0];setDailyUsage({used:Number(u.used_count),limit:Number(u.daily_limit),remaining:Number(u.remaining),resetsAt:u.resets_at});}
  else setDailyUsage(null);
  setLoading(false);
 },[tool]);
 useEffect(()=>{
  if(!cleanexifSupabase){setLoading(false);return;}
  let alive=true;
  const run=async()=>{if(alive)await refresh();};
  void run();
  const {data:{subscription}}=cleanexifSupabase.auth.onAuthStateChange(()=>{window.setTimeout(()=>{if(alive){setLoading(true);void run();}},0);});
  const onFocus=()=>void run();
  window.addEventListener("focus",onFocus);
  const poll=window.setInterval(()=>void run(),60000);
  const clock=window.setInterval(()=>setNow(Date.now()),1000);
  return()=>{alive=false;subscription.unsubscribe();window.removeEventListener("focus",onFocus);window.clearInterval(poll);window.clearInterval(clock);};
 },[refresh]);
 const resetMs=dailyUsage?Math.max(0,new Date(dailyUsage.resetsAt).getTime()-now):0;
 const resetCountdown=Math.floor(resetMs/3600000)+"h "+Math.floor((resetMs%3600000)/60000)+"m "+Math.floor((resetMs%60000)/1000)+"s";
 const isLocked=!!dailyUsage&&dailyUsage.remaining<=0;
 const consumeImage=async()=>{
  if(!cleanexifSupabase)throw new Error("Daily usage service is unavailable. Please try again later.");
  if(isLocked)throw new Error("Daily limit reached. Your next allowance starts in "+resetCountdown+".");
  const {data,error}=await cleanexifSupabase.rpc("cleanexif_consume_daily_image",{p_tool:tool});
  if(error)throw new Error(error.message||"Could not verify your daily allowance. Please sign in and try again.");
  const row=Array.isArray(data)?data[0]:null;
  if(!row)throw new Error("Daily allowance could not be verified. Please try again.");
  setDailyUsage({used:Number(row.used_count),limit:Number(row.daily_limit),remaining:Number(row.remaining),resetsAt:row.resets_at});
  if(!row.allowed)throw new Error("Daily limit reached ("+row.daily_limit+" images). Your credits reset at "+new Date(row.resets_at).toLocaleTimeString()+".");
  return row;
 };
 return {limits,email,loading,isPaid:limits.code!=="free",dailyUsage,consumeImage,refresh,isLocked,resetCountdown};
}
