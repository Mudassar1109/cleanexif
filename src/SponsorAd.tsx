import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { ExternalLink } from "lucide-react";
type Placement="blog_inline"|"blog_end"|"blog_sidebar";
type Ad={id:string;sponsor_name:string;headline:string;body:string;destination_url:string;image_url:string|null;placement:Placement;starts_at:string|null;ends_at:string|null};
const url=import.meta.env.VITE_SUPABASE_URL as string|undefined;
const anon=import.meta.env.VITE_SUPABASE_ANON_KEY as string|undefined;
const client=url&&anon?createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}}):null;
export default function SponsorAd({placement}:{placement:Placement}){
 const [ad,setAd]=useState<Ad|null>(null);
 useEffect(()=>{let active=true;if(!client)return;client.from("cleanexif_sponsor_ads").select("id,sponsor_name,headline,body,destination_url,image_url,placement,starts_at,ends_at").eq("placement",placement).eq("status","approved").order("created_at",{ascending:false}).limit(20).then(({data})=>{if(!active||!data)return;const now=Date.now();const eligible=(data as Ad[]).filter(item=>(!item.starts_at||new Date(item.starts_at).getTime()<=now)&&(!item.ends_at||new Date(item.ends_at).getTime()>now));if(eligible[0])setAd(eligible[0]);});return()=>{active=false;};},[placement]);
 if(!ad)return null;
 let safeUrl:string;try{const parsed=new URL(ad.destination_url);if(parsed.protocol!=="https:")return null;safeUrl=parsed.href;}catch{return null;}
 return <aside className={"sponsor-ad sponsor-ad-"+placement} aria-label="Sponsored advertisement"><div className="sponsor-ad-label">SPONSORED</div><a className="sponsor-ad-link" href={safeUrl} target="_blank" rel="sponsored noopener noreferrer"><div className="sponsor-ad-copy"><span className="sponsor-ad-brand">{ad.sponsor_name}</span><h3>{ad.headline}</h3><p>{ad.body}</p><span className="sponsor-ad-visit">Visit sponsor <ExternalLink size={13}/></span></div>{ad.image_url&&<img src={ad.image_url} alt="" loading="lazy" referrerPolicy="no-referrer"/>}</a></aside>;
}
