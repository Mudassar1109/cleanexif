import { useMemo, useState } from "react";
import { Download, Fingerprint, MapPin, ScanSearch, ShieldCheck, UploadCloud } from "lucide-react";
import piexif from "piexifjs";
import { SiteHeader, SiteFooter } from "./SiteChrome";

type ToolMode = "gps" | "scanner" | "editor";
type Meta = Record<string, unknown>;
const ACCEPT = ["image/jpeg", "image/png", "image/webp"];
const bytes = (n:number) => n < 1048576 ? (n/1024).toFixed(0)+" KB" : (n/1048576).toFixed(2)+" MB";
const asBlob = (url:string, type:string) => { const binary=atob(url.split(",")[1]); const data=new Uint8Array(binary.length); for(let i=0;i<binary.length;i++)data[i]=binary.charCodeAt(i); return new Blob([data],{type}); };
const read = async (file:File):Promise<Meta> => { const { default: exifr } = await import("exifr"); const value=await exifr.parse(file,{exif:true,gps:true,iptc:true,xmp:true,icc:false}); return value && typeof value==="object" ? value as Meta : {}; };
const gpsKeys = /^(GPS|latitude|longitude|altitude|position)/i;
const sensitiveKeys = /gps|latitude|longitude|altitude|serial|owner|artist|author|creator|copyright|date|time|software|comment|description|usercomment/i;
const modeInfo:Record<ToolMode,{title:string;description:string;icon:any}> = {
 gps:{title:"GPS Location Remover",description:"Find location tags and export a fresh copy without embedded metadata.",icon:MapPin},
 scanner:{title:"Image Privacy Scanner",description:"Scan readable metadata and highlight location, identity and device information.",icon:ScanSearch},
 editor:{title:"EXIF Metadata Editor",description:"Edit common JPEG EXIF description, author, copyright and capture-time fields.",icon:Fingerprint}
};
export default function PrivacyTools({mode}:{mode:ToolMode}){
 const [file,setFile]=useState<File|null>(null),[meta,setMeta]=useState<Meta|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(""),[output,setOutput]=useState<Blob|null>(null);
 const [description,setDescription]=useState(""),[artist,setArtist]=useState(""),[copyright,setCopyright]=useState(""),[dateTime,setDateTime]=useState(""),[removeGps,setRemoveGps]=useState(true);
 const findings=useMemo(()=>Object.entries(meta??{}).filter(([key,value])=>sensitiveKeys.test(key)&&value!==null&&value!==undefined),[meta]);
 const gps=findings.filter(([key])=>gpsKeys.test(key));
 const pick=async(next:File)=>{
  setNotice("");setOutput(null);setMeta(null);
  if(!ACCEPT.includes(next.type)){setNotice("Unsupported format. Choose JPEG, PNG or WebP.");return;}
  if(next.size>50*1024*1024){setNotice("File exceeds the 50 MB tool limit.");return;}
  if(mode==="editor"&&next.type!=="image/jpeg"){setNotice("EXIF editing currently supports JPEG files only. GPS removal and privacy scanning support JPEG, PNG and WebP.");return;}
  setBusy(true);setFile(next);
  try{const data=await read(next);setMeta(data);setDescription(String(data.ImageDescription??""));setArtist(String(data.Artist??""));setCopyright(String(data.Copyright??""));setDateTime(String(data.DateTime??""));setNotice(Object.keys(data).length?"Scan complete. Review the fields below.":"No readable metadata fields were found.");}
  catch{setNotice("Could not read metadata from this image.");}
  finally{setBusy(false);}
 };
 const exportGps=async()=>{
  if(!file)return;setBusy(true);setNotice("Removing embedded metadata and verifying the new image…");
  try{
   const bitmap=await createImageBitmap(file,{imageOrientation:"from-image"});
   const canvas=document.createElement("canvas");canvas.width=bitmap.width;canvas.height=bitmap.height;
   const ctx=canvas.getContext("2d",{alpha:file.type!=="image/jpeg"});if(!ctx)throw new Error("Canvas is unavailable in this browser.");
   if(file.type==="image/jpeg"){ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);}
   ctx.drawImage(bitmap,0,0);bitmap.close();
   const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error("Image export failed.")),file.type,.94));
   const verify=await read(new File([blob],file.name,{type:blob.type}));
   const remaining=Object.keys(verify).filter(k=>sensitiveKeys.test(k));
   setOutput(blob);setNotice(remaining.length?"Export ready, but readable fields remain: "+remaining.slice(0,5).join(", ")+". Verify independently before sharing.":"Export ready. No readable privacy-sensitive metadata was detected in the re-read copy.");
  }catch(e){setNotice(e instanceof Error?e.message:"Could not export this image.");}finally{setBusy(false);}
 };
 const saveEdited=async()=>{
  if(!file)return;setBusy(true);setNotice("Updating JPEG EXIF fields…");
  try{
   const dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error("Could not read JPEG."));reader.readAsDataURL(file);});
   const exif=piexif.load(dataUrl);
   exif["0th"][piexif.ImageIFD.ImageDescription]=description||"";
   exif["0th"][piexif.ImageIFD.Artist]=artist||"";
   exif["0th"][piexif.ImageIFD.Copyright]=copyright||"";
   exif["0th"][piexif.ImageIFD.DateTime]=dateTime||"";
   if(removeGps)exif["GPS"]={};
   const result=piexif.insert(piexif.dump(exif),dataUrl);
   const blob=asBlob(result,"image/jpeg");setOutput(blob);
   const check=await read(new File([blob],file.name,{type:"image/jpeg"}));
   setMeta(check);setNotice("Edited JPEG exported. Re-opened metadata is shown below; verify the downloaded file before sharing.");
  }catch(e){setNotice(e instanceof Error?e.message:"Could not edit this JPEG. The source may contain unsupported EXIF structures.");}finally{setBusy(false);}
 };
 const download=()=>{if(!output||!file)return;const url=URL.createObjectURL(output);const a=document.createElement("a");a.href=url;a.download=(mode==="gps"?"no-gps-":mode==="editor"?"edited-":"scanned-")+file.name;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),30000);};
 const InfoIcon=modeInfo[mode].icon;
 return <div className="privacy-tools-page">
  <SiteHeader />
  <main className="container privacy-tools-main">
   <a className="privacy-tools-back" href="/">← Back to CleanExif</a>
   <div className="privacy-tools-hero"><span className="eyebrow"><ShieldCheck size={15}/> PRIVATE, IN-BROWSER IMAGE TOOLS</span><h1><InfoIcon size={34}/> {modeInfo[mode].title}</h1><p>{modeInfo[mode].description}</p><small>JPEG, PNG and WebP · Up to 50 MB · Files stay in this browser</small></div>
   <section className="privacy-tool-card">
    <label className="privacy-tool-upload"><UploadCloud size={28}/><b>{file?file.name:"Choose an image to get started"}</b><span>{file?bytes(file.size)+" · "+file.type:"Select a JPEG, PNG or WebP image"}</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{const f=e.target.files?.[0];if(f)void pick(f);e.currentTarget.value="";}}/></label>
    <div className={"privacy-tool-status"+(busy?" is-processing":output?" is-ready":meta?" is-reviewed":"")} role="status" aria-live="polite"><b>{busy?"Processing image":output?"New image ready":meta?(mode==="scanner"?"Privacy scan complete":"Image inspected — no changes saved yet"):file?"Image selected — scan in progress":"No image selected"}</b><span>{busy?"Keep this tab open while CleanExif processes the image locally.":output?"A separate output file has been created. Use the Download button below to save it.":meta?(mode==="scanner"?"The scanner only reports readable metadata; it does not remove or change anything.":mode==="gps"?"The original file is unchanged. Select Remove GPS / metadata to create a cleaned copy.":"Edit the fields and select Save edited JPEG to create a separate copy."):"Select a file to begin. Your original image will not be overwritten."}</span></div>
    {busy&&<p className="privacy-tool-notice" role="status">Processing locally in your browser…</p>}
    {notice&&!busy&&<p className="privacy-tool-notice" role="status">{notice}</p>}
    {meta&&<div className="privacy-tool-results">
      <div className="privacy-tool-summary"><div><span>Readable metadata fields</span><b>{Object.keys(meta).length}</b></div><div><span>Privacy-sensitive fields</span><b>{findings.length}</b></div><div><span>GPS fields</span><b>{gps.length}</b></div></div>
      {mode==="scanner"&&<><h2><ScanSearch size={19}/> Privacy findings</h2>{findings.length?findings.map(([key,value])=><div className="privacy-tool-row" key={key}><span>{key}</span><b>{value instanceof Date?value.toLocaleString():Array.isArray(value)?value.join(", "):typeof value==="object"?"Available":String(value)}</b><em className={gpsKeys.test(key)?"risk-high":"risk-medium"}>{gpsKeys.test(key)?"Location":"Review"}</em></div>):<p>No readable privacy-sensitive fields detected. This is not a forensic guarantee.</p>}</>}
      {mode==="gps"&&<><h2><MapPin size={19}/> Location metadata</h2><p>{gps.length?gps.map(([key,value])=><span className="gps-value" key={key}>{key}: {Array.isArray(value)?value.join(", "):String(value)}</span>):"No readable GPS fields were found in this file."}</p><button className="button button-primary" disabled={busy} onClick={()=>void exportGps()}>Remove GPS / metadata & export</button></>}
      {mode==="editor"&&<><h2><Fingerprint size={19}/> Editable JPEG fields</h2><p className="privacy-tool-editor-note">Supported standard EXIF fields. Empty a field to clear it. GPS removal is optional. This editor currently writes JPEG EXIF only.</p>
       <label>Description<input value={description} onChange={e=>setDescription(e.target.value)} maxLength={1000}/></label>
       <label>Artist / Author<input value={artist} onChange={e=>setArtist(e.target.value)} maxLength={200}/></label>
       <label>Copyright<input value={copyright} onChange={e=>setCopyright(e.target.value)} maxLength={200}/></label>
       <label>Date & time (YYYY:MM:DD HH:MM:SS)<input value={dateTime} onChange={e=>setDateTime(e.target.value)} maxLength={19}/></label>
       <label className="privacy-tool-check"><input type="checkbox" checked={removeGps} onChange={e=>setRemoveGps(e.target.checked)}/> Remove GPS tags when saving</label>
       <button className="button button-primary" disabled={busy} onClick={()=>void saveEdited()}>Save edited JPEG</button>
      </>}
      {output&&<button className="button button-primary privacy-tool-download" onClick={download}><Download size={17}/> Download {mode==="editor"?"edited":"processed"} image · {bytes(output.size)}</button>}
    </div>}
   </section>
   <section className="privacy-tool-disclaimer"><ShieldCheck size={18}/><p>Processing runs in your browser. The scanner reports metadata readable by the parser; the GPS remover re-encodes pixels and may remove other metadata too. The EXIF editor supports common JPEG fields only. Always independently verify files intended for sensitive use.</p></section>
   <section className="privacy-tool-switch"><h2>More CleanExif privacy tools</h2><div><a href="/gps-remover"><MapPin/> GPS Location Remover</a><a href="/privacy-scanner"><ScanSearch/> Image Privacy Scanner</a><a href="/metadata-editor"><Fingerprint/> EXIF Metadata Editor</a></div></section>
  </main>
  <SiteFooter />
 </div>;
}
