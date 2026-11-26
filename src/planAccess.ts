import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
const url=import.meta.env.VITE_SUPABASE_URL as string|undefined;
const key=import.meta.env.VITE_SUPABASE_ANON_KEY as string|undefined;
export const cleanexifSupabase=url&&key?createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}):null;
export type PlanLimits={code:string;name:string;maxImages:number;totalMB:number;maxFileMB:number;expiresAt:string|null};
const FREE:PlanLimits={code:"free",name:"Free",maxImages:10,totalMB:100,maxFileMB:25,expiresAt:null};
export function usePlanAccess(){
 const [limits,setLimits]=useState<PlanLimits>(FREE),[email,setEmail]=useState<string|null>(null),[loading,setLoading]=useState(true);
 useEffect(()=>{if(!cleanexifSupabase){setLoading(false);return;}let alive=true;
  const load=async()=>{const {data:{session}}=await cleanexifSupabase!.auth.getSession();if(!alive)return;setEmail(session?.user.email??null);
   if(!session){setLimits(FREE);setLoading(false);return;}
   const {data,error}=await cleanexifSupabase!.rpc("cleanexif_get_my_access");if(!alive)return;
   const row=!error&&Array.isArray(data)?data[0]:null;
   setLimits(row?{code:row.plan_code,name:row.plan_name,maxImages:row.watermark_images_per_batch,totalMB:row.watermark_total_mb,maxFileMB:row.max_file_mb,expiresAt:row.expires_at}:FREE);setLoading(false);
  };
  void load();const {data:{subscription}}=cleanexifSupabase.auth.onAuthStateChange(()=>{window.setTimeout(()=>{if(alive){setLoading(true);void load();}},0);});
  return()=>{alive=false;subscription.unsubscribe();};
 },[]);
 useEffect(()=>{if(!limits.expiresAt)return;const remaining=new Date(limits.expiresAt).getTime()-Date.now();if(remaining<=0){setLimits(FREE);return;}const timer=window.setTimeout(()=>setLimits(FREE),remaining);return()=>window.clearTimeout(timer);},[limits.expiresAt]);
 return {limits,email,loading,isPaid:limits.code!=="free"};
}
