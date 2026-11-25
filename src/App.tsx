import { useCallback, useMemo, useRef, useState, useEffect, type ChangeEvent } from "react";
import exifr from "exifr";
import JSZip from "jszip";
import {
  AlertCircle, ArrowRight, Camera, Check, CheckCircle2, ChevronDown,
  Download, Eye, FilePlus2, Fingerprint, Globe2, Image as ImageIcon,
  LockKeyhole, MapPin, Menu, Monitor, RefreshCw, Shield, ShieldCheck,
  Trash2, UploadCloud, X, Zap
} from "lucide-react";

type Meta = Record<string, unknown>;
type ImageRecord = {
  id: string; file: File; preview: string; width: number; height: number;
  metadata: Meta | null; cleaned?: Blob; cleanedUrl?: string; cleanError?: string; cleanCheck?: Meta | null; cleanCheckError?: boolean;
  status: "ready" | "cleaning" | "clean";
};

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_TOTAL_SIZE = 100 * 1024 * 1024;
const MAX_FILES = 20;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
const formatBytes = (bytes: number) => bytes < 1024 * 1024
  ? (bytes / 1024).toFixed(0) + " KB" : (bytes / (1024 * 1024)).toFixed(2) + " MB";
const displayValue = (value: unknown): string => {
  if (value instanceof Date) return value.toLocaleString();
  if (Array.isArray(value)) return value.map(v => typeof v === "number" ? Number(v.toFixed(5)) : String(v)).join(", ");
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(5)));
  if (typeof value === "object" && value !== null) return "Available";
  return String(value ?? "—");
};
function uniqueZipFilename(original: string, used: Set<string>): string {
  const dot = original.lastIndexOf(".");
  const base = dot > 0 ? original.slice(0, dot) : original;
  const extension = dot > 0 ? original.slice(dot) : "";
  let candidate = "clean-" + original;
  let counter = 2;
  while (used.has(candidate.toLowerCase())) candidate = "clean-" + base + "-" + counter++ + extension;
  used.add(candidate.toLowerCase());
  return candidate;
}
const labelMetadataKey = (key: string) => key
  .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
  .replace(/GPS/g, "GPS").replace(/IPTC/g, "IPTC").replace(/XMP/g, "XMP")
  .replace(/_/g, " ").trim();
const getMetaCategories = (meta: Meta | null) => {
  const groups = [
    { id: "gps", label: "GPS & location", rows: [] as { key: string; label: string; value: string }[] },
    { id: "camera", label: "Camera & device", rows: [] as { key: string; label: string; value: string }[] },
    { id: "datetime", label: "Date & time", rows: [] as { key: string; label: string; value: string }[] },
    { id: "capture", label: "Exposure & capture", rows: [] as { key: string; label: string; value: string }[] },
    { id: "other", label: "Other metadata", rows: [] as { key: string; label: string; value: string }[] }
  ];
  if (!meta) return groups;
  const excluded = /^(?:Thumbnail|MakerNote|UserCommentEncoding|Binary|JFIFThumbnail|ImageData|StripOffsets|StripByteCounts)/i;
  for (const [key, value] of Object.entries(meta)) {
    if (excluded.test(key) || value === undefined || value === null || typeof value === "function" || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) continue;
    const row = { key, label: labelMetadataKey(key), value: displayValue(value) };
    const index = /^GPS|Latitude|Longitude|Altitude|Position/i.test(key) ? 0
      : /Make|Model|Lens|Camera|BodySerial|SerialNumber|OwnerName|Software|HostComputer/i.test(key) ? 1
      : /Date|Time|OffsetTime|SubSec/i.test(key) ? 2
      : /ISO|Exposure|FNumber|Aperture|Shutter|Focal|Flash|Metering|WhiteBalance|Scene|Orientation|Resolution|ColorSpace/i.test(key) ? 3 : 4;
    groups[index].rows.push(row);
  }
  return groups.filter(group => group.rows.length);
};
async function readMetadata(blob: Blob): Promise<Meta | null> {
  try {
    // ICC color profiles describe color rendering, not personal EXIF/location data.
    // Exclude them from the privacy verification result to avoid false warnings.
    const result = await exifr.parse(blob as File, { exif: true, gps: true, iptc: true, xmp: true, icc: false });
    return result && typeof result === "object" ? result as Meta : null;
  } catch { return null; }
}
async function verifyMetadata(blob: Blob): Promise<{ metadata: Meta | null; error: boolean }> {
  try {
    // Verify privacy-sensitive metadata only. ICC profile fields describe color
    // rendering and are not camera, location, date, or user-identifying metadata.
    const result = await exifr.parse(blob as File, { exif: true, gps: true, iptc: true, xmp: true, icc: false });
    if (!result || typeof result !== "object") return { metadata: null, error: false };
    const nonPrivacyKeys = new Set([
      "ProfileCMMType", "ProfileVersion", "ProfileClass", "ColorSpaceData",
      "ProfileConnectionSpace", "ProfileDateTime", "ProfileFileSignature",
      "PrimaryPlatform", "RenderingIntent", "ProfileCreator", "ProfileID",
      "ProfileDescription", "ProfileCopyright", "MediaWhitePoint",
      "RedMatrixColumn", "GreenMatrixColumn", "BlueMatrixColumn",
      "RedTRC", "GreenTRC", "BlueTRC", "ChromaticAdaptation", "Luminance"
    ]);
    const privacyFields = Object.fromEntries(
      Object.entries(result as Record<string, unknown>).filter(([key]) => !nonPrivacyKeys.has(key))
    );
    return { metadata: Object.keys(privacyFields).length ? privacyFields as Meta : null, error: false };
  } catch { return { metadata: null, error: true }; }
}
async function cleanImage(file: File, onStage?: (stage: string) => void): Promise<Blob> {
  onStage?.("Decoding image");
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    onStage?.("Preparing clean image");
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { alpha: file.type !== "image/jpeg" });
    if (!context) throw new Error("Your browser could not prepare this image.");
    if (file.type === "image/jpeg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(bitmap, 0, 0);
    onStage?.("Re-encoding image");
    const output = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Image export failed. Please try another image.")), file.type, 0.94);
    });
    if (output.type !== file.type) throw new Error("This browser cannot export the original image format. Try a different browser.");
    return output;
  } finally { bitmap.close(); }
}
function Logo({ small = false }: { small?: boolean }) {
  return <a className={"brand" + (small ? " brand-small" : "")} href="/" aria-label="CleanExif home">
    <span className="brand-mark"><Shield size={small ? 22 : 25} strokeWidth={2.5} /><Camera className="brand-camera" size={small ? 10 : 11} /></span>
    <span>Clean<span>Exif</span></span>
  </a>;
}
function LegalPage({ type }: { type: string }) {
  const titles: Record<string, string> = {
    "privacy-policy": "Privacy Policy", terms: "Terms of Service",
    disclaimer: "Disclaimer", "cookie-policy": "Cookie Policy"
  };
  const title = titles[type] ?? "Legal";
  const descriptions: Record<string, string> = {
    "privacy-policy": "Read how CleanExif handles image files, browser processing, website requests and privacy-related information.",
    terms: "Review the terms for using CleanExif, including supported image processing, user responsibilities and service limitations.",
    disclaimer: "Understand CleanExif's image metadata removal limitations and important information before relying on cleaned files.",
    "cookie-policy": "Learn how CleanExif uses essential browser functionality and handles cookies, analytics and third-party resources."
  };
  useEffect(() => {
    const description = descriptions[type] ?? "CleanExif website policies and information.";
    const canonicalUrl = window.location.origin + window.location.pathname;
    document.title = title + " | CleanExif";
    const setMeta = (selector: string, attribute: string, value: string) => {
      let element = document.head.querySelector(selector) as HTMLMetaElement | null;
      if (!element) {
        element = document.createElement("meta");
        const [key, contentValue] = selector.match(/\[(name|property)="([^"]+)"\]/)?.slice(1) ?? [];
        if (key && contentValue) element.setAttribute(key, contentValue);
        document.head.appendChild(element);
      }
      element.setAttribute(attribute, value);
    };
    setMeta('meta[name="description"]', "content", description);
    setMeta('meta[property="og:title"]', "content", title + " | CleanExif");
    setMeta('meta[property="og:description"]', "content", description);
    setMeta('meta[property="og:url"]', "content", canonicalUrl);
    setMeta('meta[name="twitter:title"]', "content", title + " | CleanExif");
    setMeta('meta[name="twitter:description"]', "content", description);
    let canonical = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = canonicalUrl;
  }, [type, title]);
  const content: Record<string, string[]> = {
    "privacy-policy": [
      "CleanExif is designed to process image files locally in your web browser. The image-processing feature does not upload your selected photos to CleanExif application servers.",
      "When you visit this website, your hosting provider or network infrastructure may process standard connection information such as IP address, request time and browser details in routine server logs. CleanExif does not add analytics or advertising trackers in this version.",
      "Selected image files and generated clean copies remain in your browser session. They are not saved to a CleanExif account or database. Clearing the page or closing the tab may remove access to temporary results.",
      "This website uses essential browser functionality only. Third-party font delivery may make a request to Google Fonts; you can replace hosted fonts with local font files if you prefer to avoid that request.",
      "The tool is provided as-is. Metadata formats vary, so users should verify cleaned files before sharing sensitive images."
    ],
    terms: [
      "CleanExif is provided free of charge for personal and professional use. You are responsible for ensuring you have the rights to process each image you select.",
      "The tool re-encodes supported image formats to remove embedded metadata. It is not a forensic sanitization guarantee and may not remove every proprietary or non-standard data structure in every file.",
      "You are responsible for checking the output, retaining your original files and deciding whether the cleaned image is suitable for your intended use.",
      "The service is provided without warranties to the extent permitted by applicable law. We may update or discontinue features as the product evolves."
    ],
    disclaimer: [
      "CleanExif is a general-purpose utility. It does not provide legal, security or forensic advice.",
      "Although supported images are re-encoded in the browser to remove embedded metadata, no tool can guarantee removal of every possible metadata field or hidden payload from every image format and browser implementation.",
      "Always inspect the resulting file and use appropriate specialist tools when handling highly sensitive, regulated or evidentiary material."
    ],
    "cookie-policy": [
      "CleanExif does not intentionally set analytics, advertising or tracking cookies in this version of the website.",
      "The application uses browser memory and temporary object URLs to preview and process images. These are not cookies and are not sent as image uploads to CleanExif.",
      "Third-party font resources may be requested from Google Fonts. Browser or hosting infrastructure may also use technically necessary mechanisms to deliver the website."
    ]
  };
  return <div className="legal-page"><header className="site-header"><div className="container nav-inner"><Logo /><a className="nav-link" href="/">Back to home</a></div></header>
    <main className="container legal-content"><span className="eyebrow"><ShieldCheck size={15} /> CLEANEXIF POLICIES</span><h1>{title}</h1>
      <p className="legal-date">Last updated: November 25, 2026</p>
      {(content[type] ?? []).map((p, i) => <p key={i}>{p}</p>)}
    </main><Footer /></div>;
}
function Footer() {
  return <footer className="footer"><div className="container footer-inner"><div className="footer-brand"><Logo small /><span>A simple, privacy-first image metadata tool.</span></div>
    <div className="footer-links"><span>© 2026 CleanExif</span><a href="/blog">Blog</a><a href="/privacy-policy">Privacy Policy</a><a href="/terms">Terms of Service</a><a href="/disclaimer">Disclaimer</a><a href="/cookie-policy">Cookie Policy</a></div></div></footer>;
}

const blogArticles = [
{slug:"what-is-exif-data",title:"What Is EXIF Data? A Complete Beginner's Guide",description:"Learn what EXIF data is, what information photos can contain, how GPS location gets embedded, and how to inspect and remove image metadata.",intro:"A photo can contain more information than the pixels you see. Alongside the visible image, many files store details about the camera, capture settings, date and sometimes the location where the photo was taken. This information is commonly called image metadata. One widely used part of it is EXIF data.",sections:[
["What does EXIF mean?",["EXIF stands for Exchangeable Image File Format. It is a standard for storing information inside image files, especially photographs captured by digital cameras and smartphones. EXIF data is separate from the visible image itself: it describes details about how the image was created.","Not every image contains the same fields. Available information depends on the device, camera app, settings, editing software and services that have processed the file."]],
["What information can EXIF contain?",["Depending on the camera and settings, EXIF fields may include:"],["Camera manufacturer and model","Date and time the photo was captured","Lens, focal length and exposure settings","Image orientation and dimensions","GPS coordinates, if location tagging was enabled","Software or application used to edit or export the image"]],
["Why can photo metadata matter for privacy?",["GPS coordinates can reveal where a photo was taken. A picture shared publicly might disclose a home, workplace or another frequently visited place if location information remains embedded in the original file.","Capture dates, device details and software fields can also reveal context about a photo. Metadata is not automatically dangerous, but it is worth checking before sharing images when privacy matters."]],
["How can you check EXIF data?",["You can inspect metadata with a desktop photo application, a dedicated metadata viewer or a browser-based tool. CleanExif lets you select a supported JPEG, PNG or WebP image and view readable metadata in your browser. Image processing happens locally rather than uploading selected photos to CleanExif image-processing servers.","A metadata viewer can only show fields it understands. Different formats and applications store information differently, so no single viewer should be treated as a complete forensic inspection."]],
["How do you remove EXIF data?",["One common approach is to export or re-encode a fresh image copy. CleanExif uses browser image decoding and canvas export for supported formats. This creates a new image rather than editing the original file, and commonly embedded EXIF, GPS and related metadata are not carried into the exported copy.","The export process can change file size and may slightly affect JPEG or WebP image quality. Keep your original file and inspect the downloaded copy before sharing it, especially when handling sensitive images."]],
["Does every image have EXIF data?",["No. Screenshots, graphics, images downloaded from websites and files processed by social platforms may have little or no EXIF information. PNG and WebP can also contain metadata in ways that differ from JPEG. An image with no readable EXIF fields is not necessarily free of every possible type of embedded information."]],
["Check your image before sharing",["The practical habit is simple: inspect images when location or device privacy matters, remove metadata when appropriate, and verify the exported copy. Try the free CleanExif metadata inspector from the homepage. CleanExif currently supports JPEG, PNG and WebP files, with a 25 MB per-file limit."]]
]},
{slug:"how-to-remove-exif-data",title:"How to Remove EXIF Data from Photos",description:"A practical guide to checking and removing embedded photo metadata from JPEG, PNG and WebP images.",intro:"Learn how to inspect a photo and create a clean copy without common embedded metadata.",sections:[["Use a metadata removal tool",["Choose a tool that explains how files are processed, which formats it supports and what limitations apply. CleanExif processes supported images in your browser."]]]},
{slug:"remove-gps-location-from-photos",title:"How to Remove GPS Location from Photos",description:"Understand photo location metadata and steps to reduce accidental location sharing.",intro:"Some cameras and phones can save GPS coordinates in photo metadata when location tagging is enabled.",sections:[["Check location fields before sharing",["Look for GPS latitude, longitude and altitude fields. If location privacy matters, create a clean copy and inspect it before sharing."]]]},
{slug:"does-instagram-remove-exif-data",title:"Does Instagram Remove EXIF Data from Photos?",description:"Understand the difference between an original photo file and copies processed by a social platform.",intro:"Social platforms may resize, recompress or otherwise process uploaded images. Do not assume that a platform's copy has the same metadata as your original.",sections:[["Keep control of your original",["The metadata in a downloaded platform copy may differ from the original file. Check the exact file you plan to share rather than relying on assumptions about platform processing."]]]},
{slug:"how-to-check-photo-metadata",title:"How to Check Photo Metadata Online",description:"Find out what information a photo contains, including camera details, timestamps and possible GPS fields.",intro:"A metadata inspector can help you understand what information is embedded in a photo before you share it.",sections:[["Inspect a supported image",["Use a trusted viewer, check the fields it reports and remember that different file formats can store different metadata types."]]]}
];
function BlogPage({slug}:{slug?:string}) {
 const article=blogArticles.find(item=>item.slug===slug);
 const title=article?.title??"The CleanExif Blog";
 const description=article?.description??"Practical guides to EXIF data, photo metadata, GPS privacy and safer image sharing.";
 useEffect(()=>{
  document.title=title+" | CleanExif";
  const canonical=window.location.origin+window.location.pathname;
  let meta=document.head.querySelector('meta[name="description"]') as HTMLMetaElement|null;
  if(!meta){meta=document.createElement("meta");meta.name="description";document.head.appendChild(meta);} meta.content=description;
  let link=document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement|null;
  if(!link){link=document.createElement("link");link.rel="canonical";document.head.appendChild(link);} link.href=canonical;
  if(article){let schema=document.getElementById("blog-article-schema");if(!schema){schema=document.createElement("script");schema.id="blog-article-schema";schema.setAttribute("type","application/ld+json");document.head.appendChild(schema);}schema.textContent=JSON.stringify({"@context":"https://schema.org","@type":"Article",headline:article.title,description:article.description,datePublished:"2026-11-26",dateModified:"2026-11-26",author:{"@type":"Organization",name:"CleanExif"},publisher:{"@type":"Organization",name:"CleanExif"},mainEntityOfPage:canonical});}
  return ()=>{document.getElementById("blog-article-schema")?.remove();};
 },[title,description,article]);
 return <div className="blog-page"><header className="site-header"><div className="container nav-inner"><Logo/><div className="blog-nav"><a className="nav-link" href="/blog">Blog</a><a className="button button-primary" href="/">Open CleanExif</a></div></div></header><main className="container blog-content"><a className="blog-back" href="/blog">← All articles</a>
 {article?<article className="blog-article"><span className="eyebrow">CLEANEXIF GUIDES · 7 MIN READ</span><h1>{article.title}</h1><p className="blog-lead">{article.intro}</p><div className="blog-body">{article.sections.map(([heading,paragraphs,bullets]:any)=><section key={heading}><h2>{heading}</h2>{paragraphs.map((p:string)=><p key={p}>{p}</p>)}{bullets&&<ul>{bullets.map((v:string)=><li key={v}>{v}</li>)}</ul>}</section>)}</div><div className="blog-cta"><h2>Inspect and clean your photos</h2><p>View and remove common embedded metadata from supported images in your browser.</p><a className="button button-primary" href="/">Open the free tool →</a></div></article>:<><span className="eyebrow">PRIVACY · PHOTOGRAPHY · METADATA</span><h1 className="blog-heading">The CleanExif Blog</h1><p className="blog-lead">Straightforward guides to photo metadata, location privacy and safer image sharing.</p><div className="blog-grid">{blogArticles.map((item,index)=><article className="blog-card" key={item.slug}><span className="blog-card-number">GUIDE 0{index+1}</span><h2><a href={"/blog/"+item.slug}>{item.title}</a></h2><p>{item.description}</p><a className="blog-read" href={"/blog/"+item.slug}>Read article →</a></article>)}</div></>}</main><Footer/></div>;
}

function App() {
  const legalPath = window.location.pathname.replace(/^\/|\/$/g, "");
  if (legalPath === "blog") return <BlogPage />;
  if (legalPath.startsWith("blog/")) return <BlogPage slug={legalPath.slice(5)} />;
  if (["privacy-policy", "terms", "disclaimer", "cookie-policy"].includes(legalPath)) return <LegalPage type={legalPath} />;
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<ImageRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cleaningStage, setCleaningStage] = useState("");
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });
  const [notice, setNotice] = useState("");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const active = items.find(item => item.id === activeId) ?? items[0] ?? null;
  const metadataCategories = useMemo(() => getMetaCategories(active?.metadata ?? null), [active]);
  const metadataRows = useMemo(() => metadataCategories.flatMap(group => group.rows), [metadataCategories]);
  const failedItems = useMemo(() => items.filter(item => !!item.cleanError && !item.cleaned), [items]);
  const noticeIsError = /unsupported format|larger than 25 MB|Maximum 20 images|total batch limit|could not read image|Could not clean|Batch download failed|No images could be cleaned/i.test(notice);
  useEffect(() => {
    if (!notice || busy) return;
    const timeout = window.setTimeout(() => setNotice(""), 6000);
    return () => window.clearTimeout(timeout);
  }, [notice, busy]);
  const addFiles = useCallback(async (list: FileList | File[]) => {
    const incoming = Array.from(list);
    const valid: File[] = [];
    const errors: string[] = [];
    let totalSize = items.reduce((sum, item) => sum + item.file.size, 0);
    for (const file of incoming) {
      if (!ACCEPTED.includes(file.type)) { errors.push(file.name + ": unsupported format"); continue; }
      if (file.size > MAX_FILE_SIZE) { errors.push(file.name + ": larger than 25 MB"); continue; }
      if (items.length + valid.length >= MAX_FILES) { errors.push("Maximum 20 images per batch"); break; }
      if (totalSize + file.size > MAX_TOTAL_SIZE) { errors.push(file.name + ": total batch limit is 100 MB"); continue; }
      valid.push(file);
      totalSize += file.size;
    }
    const records: ImageRecord[] = await Promise.all(valid.map(async file => {
      const id = (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : String(Date.now()) + Math.random();
      let preview = "";
      let width = 0;
      let height = 0;
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        width = bitmap.width; height = bitmap.height; bitmap.close();
        preview = URL.createObjectURL(file);
      } catch { errors.push(file.name + ": could not read image"); }
      const metadata = await readMetadata(file);
      return { id, file, preview, width, height, metadata, status: "ready" as const };
    }));
    const usable = records.filter(record => !!record.preview);
    setItems(previous => [...previous, ...usable]);
    if (!activeId && usable[0]) setActiveId(usable[0].id);
    setNotice(errors.length ? errors.join(" · ") : usable.length ? usable.length + " image" + (usable.length === 1 ? "" : "s") + " ready to inspect." : "");
  }, [items.length, activeId]);
  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) void addFiles(event.target.files);
    event.target.value = "";
  };
  const removeItem = (id: string) => {
    setItems(previous => {
      const target = previous.find(item => item.id === id);
      if (target?.preview) URL.revokeObjectURL(target.preview);
      if (target?.cleanedUrl) URL.revokeObjectURL(target.cleanedUrl);
      const next = previous.filter(item => item.id !== id);
      if (activeId === id) setActiveId(next[0]?.id ?? null);
      return next;
    });
  };
  const clearAll = () => {
    items.forEach(item => {
      URL.revokeObjectURL(item.preview);
      if (item.cleanedUrl) URL.revokeObjectURL(item.cleanedUrl);
    });
    setItems([]); setActiveId(null); setNotice("");
  };
  const cleanOne = async (item: ImageRecord) => {
    setBusy(true);
    setCleaningStage("Starting local processing");
    setItems(previous => previous.map(entry => entry.id === item.id ? { ...entry, status: "cleaning", cleanError: undefined } : entry));
    try {
      // Let React paint the processing state before CPU work begins.
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const blob = await cleanImage(item.file, setCleaningStage);
      setCleaningStage("Verifying exported image");
      const verification = await verifyMetadata(blob);
      const url = URL.createObjectURL(blob);
      setItems(previous => previous.map(entry => entry.id === item.id ? { ...entry, cleaned: blob, cleanedUrl: url, status: "clean", metadata: item.metadata, cleanError: undefined, cleanCheck: verification.metadata, cleanCheckError: verification.error } : entry));
      setCleaningStage("Complete");
      setNotice(item.file.name + " is ready to download.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not clean this image.";
      setItems(previous => previous.map(entry => entry.id === item.id ? { ...entry, status: "ready", cleanError: message } : entry));
      setNotice("Could not clean " + item.file.name + ": " + message);
    } finally {
      setBusy(false);
      setCleaningStage("");
    }
  };
  const downloadItem = (item: ImageRecord) => {
    if (!item.cleaned) return;
    const url = item.cleanedUrl ?? URL.createObjectURL(item.cleaned);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "clean-" + item.file.name.replace(/\.[^.]+$/, "") + (item.file.name.match(/\.[^.]+$/)?.[0] ?? "");
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    if (!item.cleanedUrl) URL.revokeObjectURL(url);
  };
  const cleanAll = async (targetItems: ImageRecord[] = items) => {
    if (!targetItems.length || busy) return;
    setBusy(true); setCleaningStage("Preparing batch"); setNotice("Cleaning images locally in your browser…");
    setBatchProgress({ done: 0, total: targetItems.length });
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const zip = new JSZip();
    const usedZipNames = new Set<string>();
    let success = 0;
    let failed = 0;
    let processed = 0;
    try {
      for (const item of targetItems) {
        if (item.cleaned) {
          zip.file(uniqueZipFilename(item.file.name, usedZipNames), item.cleaned);
          success++;
          processed++;
          setBatchProgress({ done: processed, total: targetItems.length });
          continue;
        }
        try {
          setItems(previous => previous.map(entry => entry.id === item.id ? { ...entry, status: "cleaning" } : entry));
          const blob = await cleanImage(item.file, setCleaningStage);
          setCleaningStage("Verifying " + item.file.name);
          const verification = await verifyMetadata(blob);
          const url = URL.createObjectURL(blob);
          zip.file(uniqueZipFilename(item.file.name, usedZipNames), blob);
          setItems(previous => previous.map(entry => entry.id === item.id ? { ...entry, cleaned: blob, cleanedUrl: url, status: "clean", cleanError: undefined, cleanCheck: verification.metadata, cleanCheckError: verification.error } : entry));
          success++;
        } catch (error) {
          failed++;
          const message = error instanceof Error ? error.message : "Could not clean image";
          setItems(previous => previous.map(entry => entry.id === item.id ? { ...entry, status: "ready", cleanError: message } : entry));
        } finally {
          processed++;
          setBatchProgress({ done: processed, total: targetItems.length });
        }
      }
      if (success) {
        setCleaningStage("Building ZIP archive");
        const archive = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(archive);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "cleanexif-images.zip";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1500);
        setNotice(success + " cleaned image" + (success === 1 ? "" : "s") + " added to the ZIP download" + (failed ? "; " + failed + " failed. Use Retry failed to try them again." : "."));
      } else {
        setNotice("No images could be cleaned. Please try another supported image.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create the ZIP archive.";
      setNotice("Batch download failed: " + message);
    } finally {
      setBusy(false);
      setCleaningStage("");
      setBatchProgress({ done: 0, total: 0 });
    }
  };
  const faqs = [
    ["What is EXIF data?", "EXIF is information stored inside many image files. It can include camera details, capture date, lens settings and, when enabled, GPS coordinates."],
    ["Does CleanExif upload my photos?", "No. Image processing happens locally in your browser. Your selected image files are not sent to CleanExif image-processing servers."],
    ["Can I remove GPS location from an image?", "Re-encoding a supported image removes embedded metadata commonly used for GPS and camera details. Always inspect the exported file if location privacy is critical."],
    ["Which image formats are supported?", "CleanExif supports JPEG, PNG and WebP images up to 25 MB each, with a maximum of 20 images and 100 MB total per batch. HEIC, animated GIF and SVG are not supported."],
    ["Does removing EXIF data affect image quality?", "PNG is re-encoded losslessly. JPEG and WebP are exported at a high quality setting, but re-encoding can cause a small quality or file-size difference."],
    ["Can I clean multiple images at once?", "Yes. Add up to 20 supported images and use Clean all to download the cleaned files together in a ZIP archive."]
  ];
  return <div className="app-shell">
    <header className="site-header"><div className="container nav-inner"><Logo />
      <button className="mobile-toggle" aria-label="Toggle navigation" onClick={() => setMobileMenu(!mobileMenu)}><Menu size={22} /></button>
      <nav className={mobileMenu ? "nav-links nav-open" : "nav-links"}><a href="#how-it-works" onClick={() => setMobileMenu(false)}>How it works</a><a href="#privacy" onClick={() => setMobileMenu(false)}>Privacy</a><a href="#faq" onClick={() => setMobileMenu(false)}>FAQ</a><a className="button button-primary nav-cta" href="#tool" onClick={() => setMobileMenu(false)}>Start cleaning <ArrowRight size={16} /></a></nav>
    </div></header>
    {notice && <div className={"toast-notice" + (noticeIsError ? " toast-error" : " toast-success")} role={noticeIsError ? "alert" : "status"} aria-live="assertive"><span className="toast-icon">{noticeIsError ? <AlertCircle size={19} /> : <CheckCircle2 size={19} />}</span><span className="toast-message">{notice}</span><button className="toast-close" type="button" aria-label="Dismiss notification" onClick={() => setNotice("")}><X size={17} /></button></div>}

    <main>
      <section className="hero-section"><div className="hero-glow hero-glow-one" /><div className="hero-glow hero-glow-two" />
        <div className="container hero-grid">
          <div className="hero-copy"><span className="eyebrow"><span className="eyebrow-icon"><ShieldCheck size={15} /></span> FREE ONLINE EXIF REMOVER</span>
            <h1>Your photos.<br />Your <span>privacy.</span></h1>
            <p className="hero-description">View and remove hidden metadata from your images directly in your browser. Remove GPS location, camera information and other EXIF data — no image uploads, no account.</p>
            <div className="trust-pills"><span><LockKeyhole size={15} /> No uploads</span><span><Zap size={16} /> Free to use</span><span><Monitor size={16} /> Browser-based</span></div>
            <div className="hero-footnote"><ShieldCheck size={15} /> Your images stay on your device.</div>
          </div>
          <div className="hero-visual" id="tool">
            <div className="upload-card">
              <div className={"drop-zone" + (dragging ? " drop-active" : "")}
                onDragOver={event => { event.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={event => { event.preventDefault(); setDragging(false); void addFiles(event.dataTransfer.files); }}>
                <div className="upload-icon"><UploadCloud size={47} strokeWidth={1.7} /></div>
                <h2>Drop your images here</h2><p>or click to choose files</p>
                <button className="button button-primary choose-button" onClick={() => inputRef.current?.click()}><FilePlus2 size={18} /> Choose images</button>
                <span className="format-note">JPG, JPEG, PNG or WebP · Up to 25 MB each</span>
                <input ref={inputRef} type="file" multiple hidden disabled={busy} onChange={handleInput} />
              </div>
              <div className="upload-card-bottom"><span><LockKeyhole size={14} /> Processed locally</span><span><CheckCircle2 size={14} /> No account needed</span></div>
            </div>
            <div className="floating-meta"><div className="floating-image"><ImageIcon size={30} /><span>Private image</span></div><div className="meta-chip"><MapPin size={16} /> GPS location</div><div className="meta-chip"><Camera size={16} /> Camera details</div><div className="meta-chip"><Fingerprint size={16} /> EXIF metadata</div><div className="floating-shield"><ShieldCheck size={24} /></div></div>
          </div>
        </div>
        <div className="container feature-strip">
          <div className="feature-item"><span className="feature-icon"><Eye /></span><div><b>View metadata</b><small>See what information your photos contain.</small></div></div>
          <div className="feature-item"><span className="feature-icon"><ImageIcon /></span><div><b>Remove EXIF</b><small>Strip supported hidden image metadata.</small></div></div>
          <div className="feature-item"><span className="feature-icon"><Download /></span><div><b>Download clean</b><small>Save a fresh copy without embedded metadata.</small></div></div>
          <div className="feature-item"><span className="feature-icon"><ShieldCheck /></span><div><b>Privacy first</b><small>Processing happens locally in your browser.</small></div></div>
        </div>
      </section>

      {items.length > 0 && <section className="tool-workspace" aria-live="polite"><div className="container">
        <div className="workspace-heading"><div><span className="eyebrow">YOUR WORKSPACE</span><h2>Image metadata <span>inspector</span></h2><p>{items.length} of {MAX_FILES} images selected · Files stay in this browser tab</p></div>
          <div className="workspace-actions"><button className="button button-outline" onClick={() => inputRef.current?.click()} disabled={busy}><FilePlus2 size={16} /> Add images</button>{failedItems.length > 0 && <button className="button button-outline" onClick={() => void cleanAll(failedItems)} disabled={busy}><RefreshCw size={15} /> Retry failed ({failedItems.length})</button>}<button className="button button-primary" onClick={() => void cleanAll()} disabled={busy || items.length === 0}><Download size={16} /> {busy ? "Cleaning…" : "Clean all & download ZIP"}</button><button className="icon-button" aria-label="Clear all images" onClick={clearAll} disabled={busy}><Trash2 size={17} /></button></div></div>
        {busy && <div className="processing-panel batch-progress" role="status" aria-live="polite"><div className="processing-top"><RefreshCw className="spin" size={15} /><b>{cleaningStage || "Processing batch"}</b><span>Working</span></div><div className="processing-track"><span style={{ width: batchProgress.total ? ((batchProgress.done / batchProgress.total) * 100) + "%" : "0%" }} /></div><p>{batchProgress.done} of {batchProgress.total} images processed. Images are cleaned and verified locally; the ZIP archive downloads when ready.</p></div>}
        <div className="workspace-grid"><div className="image-list"><div className="panel-label">SELECTED IMAGES <span>{items.length}</span></div>
          {items.map(item => <button key={item.id} className={"image-list-item" + (active?.id === item.id ? " selected" : "")} onClick={() => setActiveId(item.id)}>
            <img src={item.preview} alt="" /><span className="image-list-copy"><b>{item.file.name}</b><small>{formatBytes(item.file.size)} · {item.width} × {item.height}</small></span>
            <span className={"status-dot " + item.status} title={item.status} /> <span className={"remove-image" + (busy ? " remove-disabled" : "")} role="button" aria-disabled={busy} aria-label={"Remove " + item.file.name} onClick={event => { event.stopPropagation(); if (!busy) removeItem(item.id); }}><X size={15} /></span>
          </button>)}
        </div>
        {active && <div className="inspector-panel"><div className="inspector-preview"><img src={active.status === "clean" && active.cleanedUrl ? active.cleanedUrl : active.preview} alt={active.status === "clean" ? "Cleaned preview of " + active.file.name : active.file.name} /><div className="preview-caption"><b>{active.status === "clean" ? "Cleaned preview" : active.file.name}</b><span>{active.width} × {active.height} · {(active.cleaned?.type || active.file.type).split("/")[1]?.toUpperCase()} · {formatBytes(active.cleaned?.size ?? active.file.size)}</span></div></div>
          <div className="metadata-panel"><div className="panel-label">{active.status === "clean" ? "ORIGINAL METADATA (BEFORE CLEANING)" : "METADATA FOUND"} <span>{metadataRows.length} fields shown</span></div>
            {metadataRows.length ? <div className="metadata-categories">{metadataCategories.map(group => <section className="metadata-category" key={group.id}><h4>{group.label}<span>{group.rows.length}</span></h4><div className="metadata-table">{group.rows.map(row => <div className="metadata-row" key={row.key}><span>{row.label}</span><b>{row.value}</b></div>)}</div></section>)}</div> : <div className="empty-metadata"><Fingerprint size={25} /><b>No readable EXIF fields found</b><span>This image may already have little or no EXIF metadata.</span></div>}
            {active.cleanError && <p className="error-text">{active.cleanError}</p>}
            {active.status === "clean" ? <div className="clean-success"><CheckCircle2 size={17} /><span>Clean copy is ready</span><button className="button button-primary" onClick={() => downloadItem(active)}><Download size={15} /> Download</button></div> :
              <button className="button button-primary clean-button" onClick={() => void cleanOne(active)} disabled={active.status === "cleaning" || busy}>{active.status === "cleaning" ? <><RefreshCw className="spin" size={16} /> Processing image…</> : <><ShieldCheck size={17} /> Remove metadata</>}</button>}
            {active.status === "cleaning" && <div className="processing-panel" role="status" aria-live="polite"><div className="processing-top"><RefreshCw className="spin" size={15} /><b>{cleaningStage || "Processing locally"}</b><span>In progress</span></div><div className="processing-track"><span /></div><p>Decoding pixels, creating a fresh image and checking its metadata — all in your browser.</p></div>}
            {active.status === "clean" && <div className="comparison-panel"><div><span>Original privacy fields</span><b>{metadataRows.length}</b></div><div><span>Clean copy fields</span><b>{active.cleanCheckError ? "Not verified" : active.cleanCheck ? Object.keys(active.cleanCheck).length : 0}</b></div><div><span>File size</span><b>{formatBytes(active.file.size)} → {formatBytes(active.cleaned?.size ?? 0)}</b></div></div>}
            {active.status === "clean" && <p className={"verification-note" + (active.cleanCheckError || (active.cleanCheck && Object.keys(active.cleanCheck).length) ? " verification-warning" : "")}><ShieldCheck size={14} /> {active.cleanCheckError ? "The clean copy is ready, but automatic metadata verification was unavailable. Check the downloaded file with another metadata reader before sharing sensitive images." : active.cleanCheck && Object.keys(active.cleanCheck).length ? "Verification detected remaining readable fields: " + Object.keys(active.cleanCheck).slice(0, 6).join(", ") + ". Review the exported file before sharing." : "No readable metadata fields were detected in the exported copy. This check is not a forensic guarantee."}</p>}<p className="small-disclaimer">A fresh image copy is created. JPEG and WebP are re-encoded at high quality; a small quality or file-size difference may occur.</p>
          </div></div>}
        </div>
      </div></section>}

      <section className="how-section section-pad" id="how-it-works"><div className="container how-grid"><div className="how-left"><span className="eyebrow">SIMPLE BY DESIGN</span><h2>How <span>CleanExif</span> works</h2><p>Clean your photos in three simple steps. No technical knowledge required.</p>
        <div className="steps-grid"><div className="step-card"><span className="step-number">01</span><UploadCloud /><b>Select images</b><small>Choose photos from your device.</small></div><ArrowRight className="step-arrow" /><div className="step-card"><span className="step-number">02</span><Eye /><b>Inspect & clean</b><small>View metadata and remove it locally.</small></div><ArrowRight className="step-arrow" /><div className="step-card"><span className="step-number">03</span><Download /><b>Download</b><small>Save your cleaned images.</small></div></div>
      </div><div className="privacy-card" id="privacy"><div className="privacy-heading"><span className="privacy-large-icon"><ShieldCheck size={30} /></span><div><h2>Your privacy comes first</h2><p>CleanExif is designed to keep image processing on your device.</p></div></div>
        <div className="privacy-points"><span><Check /> No image uploads</span><span><Check /> No account required</span><span><Check /> No image storage</span><span><Check /> No ad or analytics trackers</span><span><Check /> Works on desktop & mobile</span><span><Check /> No processing API</span></div>
        <div className="privacy-foot"><LockKeyhole size={15} /> Your selected image files never leave your browser for processing.</div>
      </div></div></section>

      <section className="metadata-section section-pad"><div className="container metadata-grid"><div className="metadata-intro"><span className="eyebrow">KNOW WHAT YOU SHARE</span><h2>What is image <span>metadata?</span></h2><p>Digital photos can contain hidden information about how and where they were created. Before sharing an image, it helps to know what may be inside it.</p>
        <div className="metadata-types"><div><MapPin /><b>GPS location</b><small>Where it was taken</small></div><div><Camera /><b>Camera info</b><small>Make and model</small></div><div><Globe2 /><b>Date & time</b><small>When it was captured</small></div><div><Fingerprint /><b>Other details</b><small>Exposure, lens and more</small></div></div>
      </div><div className="faq-column" id="faq"><span className="eyebrow">GOOD TO KNOW</span><h2>Frequently asked questions</h2><p>Clear answers about metadata and how CleanExif works.</p>
        <div className="faq-list">{faqs.map(([question, answer], index) => <div className={"faq-item" + (openFaq === index ? " faq-open" : "")} key={question}><button onClick={() => setOpenFaq(openFaq === index ? null : index)} aria-expanded={openFaq === index}><span>{question}</span><ChevronDown size={17} /></button>{openFaq === index && <p>{answer}</p>}</div>)}</div>
      </div></div></section>

      <section className="final-cta"><div className="container final-cta-inner"><div><span className="eyebrow">YOUR PHOTOS, YOUR CHOICE</span><h2>Share the photo.<br /><span>Not the hidden details.</span></h2><p>Clean supported image metadata in a few clicks, right in your browser.</p></div><a className="button button-primary" href="#tool">Start with your images <ArrowRight size={17} /></a></div></section>
    </main>
    <Footer />
  </div>;
}
export default App;