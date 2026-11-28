import { useEffect, useMemo, useRef, useState, type DragEvent, type ChangeEvent } from "react";
import {
  CheckCircle2, Download, FileImage, Fingerprint, MapPin, Image as ImageIcon,
  RotateCcw, ScanSearch, ShieldCheck, UploadCloud, X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { usePlanAccess } from "./planAccess";
import piexif from "piexifjs";
import { SiteHeader, SiteFooter } from "./SiteChrome";

type ToolMode = "gps" | "scanner" | "editor";
type Meta = Record<string, unknown>;
const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp"]);
const bytes = (n:number) => n < 1048576 ? (n/1024).toFixed(0)+" KB" : (n/1048576).toFixed(2)+" MB";
const mimeFor = (file:File) => {
  if (ACCEPTED.has(file.type)) return file.type;
  const ext=file.name.toLowerCase().split(".").pop();
  return ext==="jpg"||ext==="jpeg"?"image/jpeg":ext==="png"?"image/png":ext==="webp"?"image/webp":file.type;
};
const asBlob = (url:string, type:string) => {
  const binary=atob(url.split(",")[1]);
  const data=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)data[i]=binary.charCodeAt(i);
  return new Blob([data],{type});
};
const read = async (file:File):Promise<Meta> => {
  const { default: exifr } = await import("exifr");
  const value=await exifr.parse(file,{exif:true,gps:true,iptc:true,xmp:true,icc:false});
  return value && typeof value==="object" ? value as Meta : {};
};
const gpsKeys = /^(GPS|latitude|longitude|altitude|position)/i;
const sensitiveKeys = /gps|latitude|longitude|altitude|serial|owner|artist|author|creator|copyright|date|time|software|comment|description|usercomment/i;
const hiddenKeys = /^(Thumbnail|MakerNote|ImageData|StripOffsets|StripByteCounts|UserCommentEncoding)/i;
const modeInfo:Record<ToolMode,{title:string;description:string;icon:LucideIcon;helper:string;action:string;steps:[string,string,string]}> = {
 gps:{title:"GPS Location Remover",description:"Find location tags and export a clean image copy without embedded metadata.",icon:MapPin,helper:"JPEG, PNG and WebP · Original file remains unchanged",action:"Choose an image to remove GPS",steps:["Inspect location tags","Create a clean image copy","Download the new file"]},
 scanner:{title:"Image Privacy Scanner",description:"Inspect readable metadata and identify location, device, identity and capture details.",icon:ScanSearch,helper:"Read-only scan · JPEG, PNG and WebP",action:"Choose an image to scan",steps:["Read available metadata","Review privacy findings","Export a scan report"]},
 editor:{title:"EXIF Metadata Editor",description:"Edit common description, author, copyright and capture-time fields in JPEG images.",icon:Fingerprint,helper:"JPEG only · Export a separate edited copy",action:"Choose a JPEG to edit",steps:["Choose a JPEG image","Edit supported EXIF fields","Save a separate edited copy"]}
};
const valueText = (value:unknown):string => {
  if(value instanceof Date)return value.toLocaleString();
  if(Array.isArray(value))return value.map(v=>typeof v==="number"?Number(v.toFixed(6)):String(v)).join(", ");
  if(typeof value==="number")return Number.isInteger(value)?String(value):String(Number(value.toFixed(6)));
  if(typeof value==="object"&&value!==null)return JSON.stringify(value);
  return String(value??"—");
};
const exifDate = (value:unknown):string => {
  if(value instanceof Date){
    const p=(n:number)=>String(n).padStart(2,"0");
    return `${value.getFullYear()}:${p(value.getMonth()+1)}:${p(value.getDate())} ${p(value.getHours())}:${p(value.getMinutes())}:${p(value.getSeconds())}`;
  }
  return typeof value==="string"?value:"";
};
const validExifDate = (value:string) => {
  if(!value.trim())return true;
  const match=/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if(!match)return false;
  const [,y,mo,d,h,mi,s]=match.map(Number);
  const date=new Date(y,mo-1,d,h,mi,s);
  return date.getFullYear()===y&&date.getMonth()===mo-1&&date.getDate()===d&&date.getHours()===h&&date.getMinutes()===mi&&date.getSeconds()===s;
};
const downloadBlob = (blob:Blob,name:string) => {
  const url=URL.createObjectURL(blob);
  const anchor=document.createElement("a");
  anchor.href=url;anchor.download=name;anchor.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),30000);
};

export default function PrivacyTools({mode}:{mode:ToolMode}){
 const {limits,email,loading:planLoading,dailyUsage,consumeImage,isLocked,resetCountdown}=usePlanAccess(mode);
 const [file,setFile]=useState<File|null>(null);
 const [meta,setMeta]=useState<Meta|null>(null);
 const [busy,setBusy]=useState(false);
 const [dragging,setDragging]=useState(false);
 const [notice,setNotice]=useState("");
 const [noticeType,setNoticeType]=useState<"info"|"success"|"error">("info");
 const [output,setOutput]=useState<Blob|null>(null);
 const [description,setDescription]=useState("");
 const [artist,setArtist]=useState("");
 const [copyright,setCopyright]=useState("");
 const [dateTime,setDateTime]=useState("");
 const [make,setMake]=useState("");
 const [model,setModel]=useState("");
 const [software,setSoftware]=useState("");
 const [originalDate,setOriginalDate]=useState("");
 const [removeGps,setRemoveGps]=useState(true);
 const [showAllMetadata,setShowAllMetadata]=useState(false);
 const [inputKey,setInputKey]=useState(0);
 const fileInputRef=useRef<HTMLInputElement>(null);

 const previewUrl=useMemo(()=>file?URL.createObjectURL(file):"",[file]);
 const outputUrl=useMemo(()=>output?URL.createObjectURL(output):"",[output]);
 useEffect(()=>()=>{if(previewUrl)URL.revokeObjectURL(previewUrl);},[previewUrl]);
 useEffect(()=>()=>{if(outputUrl)URL.revokeObjectURL(outputUrl);},[outputUrl]);

 const entries=useMemo(()=>Object.entries(meta??{}).filter(([key,value])=>!hiddenKeys.test(key)&&value!==undefined&&value!==null&&typeof value!=="function"&&!(value instanceof ArrayBuffer)&&!ArrayBuffer.isView(value)),[meta]);
 const findings=useMemo(()=>entries.filter(([key])=>sensitiveKeys.test(key)),[entries]);
 const gps=findings.filter(([key])=>gpsKeys.test(key));
 const InfoIcon=modeInfo[mode].icon;
 const outputName=mode==="gps"?"no-gps-"+(file?.name??"image"):mode==="editor"?"edited-"+(file?.name??"image"):(file?.name??"image")+".privacy-report";

 const setMessage=(message:string,type:"info"|"success"|"error"="info")=>{setNotice(message);setNoticeType(type);};
 const ensureCreditAccess=()=>{
  if(!email)throw new Error("Sign in to use daily "+modeInfo[mode].title+" credits. Open your account from the header.");
  if(planLoading||!dailyUsage)throw new Error("Your daily allowance is still loading. Please try again in a moment.");
  if(isLocked)throw new Error("Your daily "+modeInfo[mode].title+" allowance is used. Credits reset in "+resetCountdown+".");
 };
 const inspect=async(next:File)=>{
  setBusy(true);setMessage("Reading image metadata in this browser…");
  try{
   if(mode==="scanner")ensureCreditAccess();
   const data=await read(next);
   if(mode==="scanner")await consumeImage();
   setMeta(data);
   setDescription(String(data.ImageDescription??""));
   setArtist(String(data.Artist??data.Creator??""));
   setCopyright(String(data.Copyright??""));
   setDateTime(exifDate(data.DateTime??data.CreateDate));
   setOriginalDate(exifDate(data.DateTimeOriginal));
   setMake(String(data.Make??""));
   setModel(String(data.Model??""));
   setSoftware(String(data.Software??""));
   setMessage(Object.keys(data).length?"Inspection complete. Review the findings below.":"No readable metadata fields were found. This does not guarantee the file contains no hidden data.","success");
  }catch{
   setMeta({});
   setMessage("The image was selected, but its metadata could not be read. You can still create a re-encoded copy with the GPS remover.","error");
  }finally{setBusy(false);}
 };
 const pick=async(next:File)=>{
  setMessage("");
  setMeta(null);setOutput(null);setShowAllMetadata(false);
  const mime=mimeFor(next);
  if(!ACCEPTED.has(mime)){setFile(null);setMessage("Unsupported format. Choose a JPEG, PNG or WebP image.", "error");return;}
  if(next.size>limits.maxFileMB*1024*1024){setFile(null);setMessage("This file is larger than your "+limits.maxFileMB+" MB plan limit.", "error");return;}
  if(mode==="editor"&&mime!=="image/jpeg"){setFile(null);setMessage("EXIF editing currently supports JPEG files only. Choose a .jpg or .jpeg image.", "error");return;}
  setFile(next);
  await inspect(next);
 };
 const onFileChange=(event:ChangeEvent<HTMLInputElement>)=>{
  const next=event.currentTarget.files?.[0];
  event.currentTarget.value="";
  if(next)void pick(next);
 };
 const onDrop=(event:DragEvent<HTMLLabelElement>)=>{
  event.preventDefault();setDragging(false);
  const next=event.dataTransfer.files?.[0];
  if(next)void pick(next);
 };
 const clearFile=()=>{
  setFile(null);setMeta(null);setOutput(null);setShowAllMetadata(false);
  setDescription("");setArtist("");setCopyright("");setDateTime("");setMake("");setModel("");setSoftware("");setOriginalDate("");setMessage("");
  setInputKey(v=>v+1);
 };
 const removeMetadata=async()=>{
  if(!file)return;
  try{ensureCreditAccess();}catch(error){setMessage(error instanceof Error?error.message:"Daily credits unavailable.","error");return;}
  setBusy(true);setMessage("Removing embedded image metadata and verifying the exported copy…");
  try{
   const bitmap=await createImageBitmap(file);
   const canvas=document.createElement("canvas");
   canvas.width=bitmap.width;canvas.height=bitmap.height;
   const mime=mimeFor(file);
   const ctx=canvas.getContext("2d",{alpha:mime!=="image/jpeg"});
   if(!ctx)throw new Error("Canvas is unavailable in this browser.");
   if(mime==="image/jpeg"){ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);}
   ctx.drawImage(bitmap,0,0);bitmap.close();
   const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(result=>result?resolve(result):reject(new Error("Image export failed.")),mime,mime==="image/png"?undefined:.94));
   const verified=await read(new File([blob],file.name,{type:blob.type||mime}));
   const remaining=Object.keys(verified).filter(key=>sensitiveKeys.test(key));
   await consumeImage();
   setOutput(blob);
   setMessage(remaining.length?"A clean copy was created, but readable fields remain: "+remaining.slice(0,6).join(", ")+". Review the result before sharing.":"Clean copy created and re-read. No common privacy-sensitive metadata was detected.",remaining.length?"info":"success");
  }catch(error){
   setMessage(error instanceof Error?error.message:"Could not create a clean image copy.", "error");
  }finally{setBusy(false);}
 };
 const saveEdited=async()=>{
  if(!file)return;
  try{ensureCreditAccess();}catch(error){setMessage(error instanceof Error?error.message:"Daily credits unavailable.","error");return;}
  if(!validExifDate(dateTime)||!validExifDate(originalDate)){setMessage("Date fields must use YYYY:MM:DD HH:MM:SS and be valid dates.", "error");return;}
  setBusy(true);setMessage("Updating JPEG EXIF fields and verifying the new file…");
  try{
   const dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error("Could not read the JPEG file."));reader.readAsDataURL(file);});
   const exif=piexif.load(dataUrl);
   exif["0th"]=exif["0th"]??{};
   exif["0th"][piexif.ImageIFD.ImageDescription]=description;
   exif["0th"][piexif.ImageIFD.Artist]=artist;
   exif["0th"][piexif.ImageIFD.Copyright]=copyright;
   exif["0th"][piexif.ImageIFD.DateTime]=dateTime;
   exif["0th"][piexif.ImageIFD.Make]=make;
   exif["0th"][piexif.ImageIFD.Model]=model;
   exif["0th"][piexif.ImageIFD.Software]=software;
   exif["Exif"]=exif["Exif"]??{};
   exif["Exif"][piexif.ExifIFD.DateTimeOriginal]=originalDate;
   if(removeGps)exif["GPS"]={};
   const updated=piexif.insert(piexif.dump(exif),dataUrl);
   const blob=asBlob(updated,"image/jpeg");
   const verified=await read(new File([blob],file.name,{type:"image/jpeg"}));
   await consumeImage();
   setMeta(verified);setOutput(blob);
   setMessage("Edited JPEG created and metadata re-read. Download the separate copy to keep your original unchanged.","success");
  }catch(error){
   setMessage(error instanceof Error?error.message:"Could not edit this JPEG. It may contain an unsupported EXIF structure.", "error");
  }finally{setBusy(false);}
 };
 const download=(format:"txt"|"csv"|"json"="txt")=>{
  if(!file)return;
  if(mode==="scanner"){
   const report={
    tool:"CleanExif Image Privacy Scanner",
    file:file.name,
    scannedAt:new Date().toISOString(),
    readableMetadataCount:entries.length,
    privacySensitiveCount:findings.length,
    gpsFieldCount:gps.length,
    findings:findings.map(([key,value])=>({field:key,value:valueText(value),category:gpsKeys.test(key)?"location":"review"})),
    note:"This report includes metadata readable by the parser. It is not a forensic guarantee."
   };
   if(format==="json"){
    downloadBlob(new Blob([JSON.stringify(report,null,2)],{type:"application/json;charset=utf-8"}),file.name+".privacy-report.json");
   }else if(format==="csv"){
    const quote=(v:string)=>'"'+v.replace(/"/g,'""')+'"';
    const rows=[["Field","Value","Category"],...report.findings.map(row=>[row.field,row.value,row.category])];
    downloadBlob(new Blob([rows.map(row=>row.map(quote).join(",")).join("\r\n")],{type:"text/csv;charset=utf-8"}),file.name+".privacy-report.csv");
   }else{
    const lines=[
     report.tool,"File: "+report.file,"Scanned: "+report.scannedAt,
     "Readable metadata fields: "+report.readableMetadataCount,
     "Privacy-sensitive fields: "+report.privacySensitiveCount,
     "GPS / location fields: "+report.gpsFieldCount,"",
     ...report.findings.map(row=>row.field+": "+row.value+" ["+row.category+"]"),
     "","Note: "+report.note
    ];
    downloadBlob(new Blob([lines.join("\n")],{type:"text/plain;charset=utf-8"}),file.name+".privacy-report.txt");
   }
   return;
  }
  if(output)downloadBlob(output,outputName+".jpg");
 };
 const hasResult=meta!==null;
 const displayImage=outputUrl||previewUrl;
 return <div className="privacy-tools-page">
  <SiteHeader />
  <main className="container privacy-tools-main">
   <a className="privacy-tools-back" href="/#all-tools">← All CleanExif tools</a>
   <div className="privacy-tools-hero">
    <span className="eyebrow"><ShieldCheck size={15}/> PRIVATE, IN-BROWSER IMAGE TOOLS</span>
    <h1><InfoIcon size={34}/> {modeInfo[mode].title}</h1>
    <p>{modeInfo[mode].description}</p>
    <small>{modeInfo[mode].helper} · Up to {limits.maxFileMB} MB per file</small>
    <div className={"privacy-tool-quota"+(isLocked?" is-locked":"")} role="status" aria-live="polite"><div><b>{limits.name} · {modeInfo[mode].title} credits</b><strong>{planLoading?"Checking allowance…":!email?"Sign in required":dailyUsage?dailyUsage.remaining+" / "+dailyUsage.limit+" left today":"Allowance unavailable"}</strong></div><small>{dailyUsage?(isLocked?"Daily limit reached · Resets in "+resetCountdown:"Resets in "+resetCountdown):"Independent daily credits · No rollover"}</small><a href="/plans">View plans</a></div>
   </div>
   <section className="privacy-tool-card">
    <label className={"privacy-tool-upload"+(dragging?" is-dragging":"")+(busy?" is-disabled":"")} htmlFor="privacy-tool-file-input"
      onDragOver={event=>{event.preventDefault();if(!busy)setDragging(true);}}
      onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setDragging(false);}}
      onDrop={onDrop}>
      <UploadCloud size={30}/>
      <b>{file?file.name:"Drop your image here or choose a file"}</b>
      <span>{file?bytes(file.size)+" · "+(mimeFor(file)||"Unknown image type"):(mode==="editor"?"JPEG files only · Up to 50 MB":"Select a JPEG, PNG or WebP image · Up to 50 MB")}</span>
    </label>
    <input ref={fileInputRef} key={inputKey} id="privacy-tool-file-input" className="privacy-tool-file-input" type="file" accept={mode==="editor"?"image/jpeg,.jpg,.jpeg":"image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"} onChange={onFileChange} disabled={busy}/>
    {!file&&<div className="privacy-tool-start-card">
      <div className="privacy-tool-start-copy"><b>{mode==="gps"?"Remove location before you share":mode==="scanner"?"See what your image reveals":"Edit the details stored in your JPEG"}</b><p>{mode==="gps"?"CleanExif re-encodes the image and creates a separate copy without common embedded metadata.":mode==="scanner"?"Review readable GPS, camera, author and date fields. The scan does not change your original image.":"Update common description, author, copyright and date fields, then export a separate JPEG."}</p></div>
      <button className="button button-primary privacy-tool-start-button" type="button" onClick={()=>fileInputRef.current?.click()} disabled={busy}><UploadCloud size={16}/>{modeInfo[mode].action}</button>
      <div className="privacy-tool-steps">{modeInfo[mode].steps.map((step,index)=><span key={step}><i>{String(index+1).padStart(2,"0")}</i>{step}</span>)}</div>
    </div>}
    {hasResult&&file&&<div className="privacy-tool-workflow">
      <aside className="privacy-tool-preview-card">
       <div className="privacy-tool-preview-head"><span><FileImage size={16}/> {output?"Export preview":"Selected image"}</span><button type="button" onClick={clearFile} disabled={busy} aria-label="Remove selected image"><X size={16}/></button></div>
       <div className="privacy-tool-preview-media"><img src={displayImage} alt={output?"Processed image preview":"Selected image preview"}/></div>
       <div className="privacy-tool-preview-meta"><b>{file.name}</b><span>{bytes(file.size)} · {file.type||mimeFor(file)}</span><small>{output?"The exported copy is shown above. Your original file remains unchanged.":"Original file — no changes have been made."}</small></div>
       {output&&<button className="button button-primary privacy-tool-download" type="button" onClick={download}><Download size={16}/> Download {mode==="editor"?"edited JPEG":"clean image"} · {bytes(output.size)}</button>}
      </aside>
      <div className="privacy-tool-work-panel">
       <div className={"privacy-tool-status"+(busy?" is-processing":output?" is-ready":hasResult?" is-reviewed":"")} role="status" aria-live="polite">
        <b>{busy?"Processing image":output?"New file ready":mode==="scanner"?"Privacy scan complete":mode==="gps"?"Image inspection complete":"JPEG inspected — ready to edit"}</b>
        <span>{busy?"Keep this tab open while CleanExif processes the image locally.":mode==="scanner"?"This is a read-only scan. The original image is never changed.":mode==="gps"?"The remover re-encodes image pixels to create a separate copy without common embedded metadata.":"Edit the supported fields and export a separate JPEG. The original file is never overwritten."}</span>
       </div>
       {notice&&<p className={"privacy-tool-notice is-"+noticeType} role="status" aria-live="polite">{notice}</p>}
       {mode==="scanner"&&<div className="privacy-tool-results">
        <div className="privacy-tool-summary">
         <div><span>Readable metadata</span><b>{entries.length}</b></div>
         <div><span>Privacy-sensitive fields</span><b>{findings.length}</b></div>
         <div><span>GPS / location fields</span><b>{gps.length}</b></div>
        </div>
        <div className="privacy-tool-result-heading"><h2><ScanSearch size={19}/> Privacy findings</h2><div className="privacy-tool-report-actions"><button type="button" className="button button-outline" onClick={()=>download("txt")} disabled={busy}>TXT</button><button type="button" className="button button-outline" onClick={()=>download("csv")} disabled={busy}>CSV</button><button type="button" className="button button-outline" onClick={()=>download("json")} disabled={busy}>JSON</button></div></div>
        {findings.length?findings.map(([key,value])=><div className="privacy-tool-row" key={key}><span>{key}</span><b>{valueText(value)}</b><em className={gpsKeys.test(key)?"risk-high":"risk-medium"}>{gpsKeys.test(key)?"Location":"Review"}</em></div>):<div className="privacy-tool-empty"><CheckCircle2 size={20}/><b>No common privacy-sensitive fields detected</b><span>This is a parser-based check, not a forensic guarantee.</span></div>}
        <button type="button" className="privacy-tool-disclosure" onClick={()=>setShowAllMetadata(v=>!v)} aria-expanded={showAllMetadata}>{showAllMetadata?"Hide":"View"} all readable metadata ({entries.length}) <span>{showAllMetadata?"−":"+"}</span></button>
        {showAllMetadata&&<div className="privacy-tool-all-meta">{entries.length?entries.slice(0,100).map(([key,value])=><div className="privacy-tool-row" key={key}><span>{key}</span><b>{valueText(value)}</b></div>):<p>No readable metadata fields were returned by the parser.</p>}</div>}
       </div>}
       {mode==="gps"&&<div className="privacy-tool-results">
        <div className="privacy-tool-summary">
         <div><span>Readable metadata</span><b>{entries.length}</b></div>
         <div><span>GPS / location fields</span><b>{gps.length}</b></div>
         <div><span>File size</span><b>{bytes(file.size)}</b></div>
        </div>
        <h2><MapPin size={19}/> Location metadata</h2>
        {gps.length?gps.map(([key,value])=><div className="privacy-tool-row" key={key}><span>{key}</span><b>{valueText(value)}</b><em className="risk-high">Location</em></div>):<div className="privacy-tool-empty"><CheckCircle2 size={20}/><b>No readable GPS fields found</b><span>You can still re-encode the image to remove common embedded metadata.</span></div>}
        <button type="button" className="button button-primary privacy-tool-action" onClick={()=>void removeMetadata()} disabled={busy||planLoading||!email||!dailyUsage||isLocked}><ShieldCheck size={16}/> Remove GPS / metadata & export</button>
       </div>}
       {mode==="editor"&&<div className="privacy-tool-results">
        <h2><Fingerprint size={19}/> Editable JPEG fields</h2>
        <p className="privacy-tool-editor-note">Supported standard EXIF fields. Leave a field empty to clear it. GPS removal is optional.</p>
        <div className="privacy-tool-editor-grid">
         <label>Description<input value={description} onChange={e=>setDescription(e.target.value)} maxLength={1000} disabled={busy}/></label>
         <label>Artist / Author<input value={artist} onChange={e=>setArtist(e.target.value)} maxLength={200} disabled={busy}/></label>
         <label>Copyright<input value={copyright} onChange={e=>setCopyright(e.target.value)} maxLength={200} disabled={busy}/></label>
         <label>Camera make<input value={make} onChange={e=>setMake(e.target.value)} maxLength={100} disabled={busy}/></label>
         <label>Camera model<input value={model} onChange={e=>setModel(e.target.value)} maxLength={100} disabled={busy}/></label>
         <label>Software<input value={software} onChange={e=>setSoftware(e.target.value)} maxLength={100} disabled={busy}/></label>
         <label>Date & time (YYYY:MM:DD HH:MM:SS)<input value={dateTime} onChange={e=>setDateTime(e.target.value)} maxLength={19} placeholder="2026:11:28 10:30:00" disabled={busy}/></label>
         <label>Original capture time<input value={originalDate} onChange={e=>setOriginalDate(e.target.value)} maxLength={19} placeholder="2026:11:28 10:30:00" disabled={busy}/></label>
        </div>
        <label className="privacy-tool-check"><input type="checkbox" checked={removeGps} onChange={e=>setRemoveGps(e.target.checked)} disabled={busy}/> Remove GPS tags when saving</label>
        <button type="button" className="button button-primary privacy-tool-action" onClick={()=>void saveEdited()} disabled={busy||planLoading||!email||!dailyUsage||isLocked}><CheckCircle2 size={16}/> Save edited JPEG & export</button>
       </div>}
      </div>
    </div>}

    {busy&&<p className="privacy-tool-busy" role="status"><span className="privacy-tool-spinner"/> Working locally in your browser…</p>}
    {file&&<div className="privacy-tool-bottom-actions"><button className="button button-outline" type="button" onClick={clearFile} disabled={busy}><RotateCcw size={15}/> Start over</button><button className="button button-outline" type="button" onClick={()=>void inspect(file)} disabled={busy}><ScanSearch size={15}/> Re-scan image</button></div>}
   </section>
   <section className="privacy-tool-disclaimer"><ShieldCheck size={18}/><p>Processing runs in your browser. The scanner reports metadata readable by the parser; the GPS remover re-encodes pixels and may remove other metadata too. The EXIF editor supports common JPEG fields only. Always independently verify files intended for sensitive use.</p></section>
   <section className="privacy-tool-switch"><h2>More CleanExif tools</h2><div>
    <a href="/#tool"><FileImage/> Image Metadata Cleaner</a><a href="/watermark"><ImageIcon/> Watermark Maker</a><a href="/gps-remover"><MapPin/> GPS Location Remover</a><a href="/privacy-scanner"><ScanSearch/> Image Privacy Scanner</a><a href="/metadata-editor"><Fingerprint/> EXIF Metadata Editor</a>
   </div></section>
  </main>
  <SiteFooter />
 </div>;
}
