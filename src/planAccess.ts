import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
const url=import.meta.env.VITE_SUPABASE_URL as string|undefined;
const key=import.meta.env.VITE_SUPABASE_ANON_KEY as string|undefined;
export const cleanexifSupabase=url&&key?createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}):null;
export type PlanLimits={code:string;name:string;maxImages:number;totalMB:number;maxFileMB:number;dailyImages:number;expiresAt:string|null};
const FREE:PlanLimits={code:"free",name:"Free",maxImages:10,totalMB:100,maxFileMB:25,dailyImages:10,expiresAt:null};
export function usePlanAccess(){
 const [limits,setLimits]=useState<PlanLimits>(FREE),[email,setEmail]=useState<string|null>(null),[loading,setLoading]=useState(true),[dailyUsage,setDailyUsage]=useState<{used:number;limit:number;remaining:number;resetsAt:string}|null>(null);
 useEffect(()=>{if(!cleanexifSupabase){setLoading(false);return;}let alive=true;
  const load=async()=>{const {data:{session}}=await cleanexifSupabase!.auth.getSession();if(!alive)return;setEmail(session?.user.email??null);
   if(!session){setLimits(FREE);setDailyUsage(null);setLoading(false);return;}
   const {data,error}=await cleanexifSupabase!.rpc("cleanexif_get_my_access");if(!alive)return;
   const row=!error&&Array.isArray(data)?data[0]:null;
   setLimits(row?{code:row.plan_code,name:row.plan_name,maxImages:row.watermark_images_per_batch,totalMB:row.watermark_total_mb,maxFileMB:row.max_file_mb,dailyImages:row.daily_images_limit??10,expiresAt:row.expires_at} : FREE);
   const usage=await cleanexifSupabase!.rpc("cleanexif_get_my_daily_usage");\n   if(alive&&!usage.error&&Array.isArray(usage.data)&&usage.data[0]){const u=usage.data[0];setDailyUsage({used:u.used_count,limit:u.daily_limit,remaining:u.remaining,resetsAt:u.resets_at});}\n   else if(alive)setDailyUsage(null);setLoading(false);
  };
  void load();const {data:{subscription}}=cleanexifSupabase.auth.onAuthStateChange(()=>{window.setTimeout(()=>{if(alive){setLoading(true);void load();}},0);});
  return()=>{alive=false;subscription.unsubscribe();};
 },[]);
 useEffect(()=>{if(!limits.expiresAt)return;const remaining=new Date(limits.expiresAt).getTime()-Date.now();if(remaining<=0){setLimits(FREE);return;}const timer=window.setTimeout(()=>setLimits(FREE),remaining);return()=>window.clearTimeout(timer);},[limits.expiresAt]);
 const consumeImage=async()=>{
  if(!cleanexifSupabase)throw new Error("Daily usage service is unavailable. Please try again later.");
  const {data,error}=await cleanexifSupabase.rpc("cleanexif_consume_daily_image");
  if(error)throw new Error("Could not verify your daily allowance. Please sign in and try again.");
  const row=Array.isArray(data)?data[0]:null;
  if(!row)throw new Error("Daily allowance could not be verified. Please try again.");
  setDailyUsage({used:row.used_count,limit:row.daily_limit,remaining:row.remaining,resetsAt:row.resets_at});
  if(!row.allowed)throw new Error("Daily limit reached ("+row.daily_limit+" images). Your credits reset at midnight Pakistan time. View plans to upgrade.");
  return row;
 };
 return {limits,email,loading,isPaid:limits.code!=="free",dailyUsage,consumeImage};
}
