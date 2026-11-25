import { useCallback, useMemo, useRef, useState, type ChangeEvent } from "react";
import exifr from "exifr";
import JSZip from "jszip";
import {
  ArrowRight, Camera, Check, CheckCircle2, ChevronDown,
  Download, Eye, FilePlus2, Fingerprint, Globe2, Image as ImageIcon,
  LockKeyhole, MapPin, Menu, Monitor, RefreshCw, Shield, ShieldCheck,
  Trash2, UploadCloud, X, Zap
} from "lucide-react";

type Meta = Record<string, unknown>;
type ImageRecord = {
  id: string; file: File; preview: string; width: number; height: number;
  metadata: Meta | null; cleaned?: Blob; cleanedUrl?: string; cleanError?: string; cleanCheck?: Meta | null;
  status: "ready" | "cleaning" | "clean";
};

const MAX_FILE_SIZE = 25 * 1024 * 1024;
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
const getMetaRows = (meta: Meta | null) => {
  if (!meta) return [];
  const fields: [string, string][] = [
    ["Make", "Camera maker"], ["Model", "Camera model"], ["LensModel", "Lens"],
    ["DateTimeOriginal", "Date captured"], ["CreateDate", "Created"],
    ["GPSLatitude", "GPS latitude"], ["GPSLongitude", "GPS longitude"],
    ["GPSAltitude", "GPS altitude"], ["Orientation", "Orientation"],
    ["ISO", "ISO"], ["FNumber", "Aperture"], ["ExposureTime", "Exposure time"],
    ["FocalLength", "Focal length"], ["Software", "Software"]
  ];
  return fields.filter(([key]) => meta[key] !== undefined && meta[key] !== null)
    .map(([key, label]) => ({ key, label, value: displayValue(meta[key]) }));
};
async function readMetadata(blob: Blob): Promise<Meta | null> {
  try {
    const result = await exifr.parse(blob as File, { exif: true, gps: true, iptc: true, xmp: true, icc: true });
    return result && typeof result === "object" ? result as Meta : null;
  } catch { return null; }
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
      <p className="legal-note">This draft should be reviewed and updated to reflect the final hosting setup and actual product behavior before launch.</p>
    </main><Footer /></div>;
}
function Footer() {
  return <footer className="footer"><div className="container footer-inner"><div className="footer-brand"><Logo small /><span>A simple, privacy-first image metadata tool.</span></div>
    <div className="footer-links"><span>© 2026 CleanExif</span><a href="/privacy-policy">Privacy Policy</a><a href="/terms">Terms of Service</a><a href="/disclaimer">Disclaimer</a><a href="/cookie-policy">Cookie Policy</a></div></div></footer>;
}
function App() {
  const legalPath = window.location.pathname.replace(/^\/|\/$/g, "");
  if (["privacy-policy", "terms", "disclaimer", "cookie-policy"].includes(legalPath)) return <LegalPage type={legalPath} />;
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<ImageRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cleaningStage, setCleaningStage] = useState("");
  const [notice, setNotice] = useState("");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const active = items.find(item => item.id === activeId) ?? items[0] ?? null;
  const readyCount = items.filter(item => item.status === "ready").length;
  const metadataRows = useMemo(() => getMetaRows(active?.metadata ?? null), [active]);
  const addFiles = useCallback(async (list: FileList | File[]) => {
    const incoming = Array.from(list);
    const valid: File[] = [];
    const errors: string[] = [];
    for (const file of incoming) {
      if (!ACCEPTED.includes(file.type)) { errors.push(file.name + ": unsupported format"); continue; }
      if (file.size > MAX_FILE_SIZE) { errors.push(file.name + ": larger than 25 MB"); continue; }
      if (items.length + valid.length >= MAX_FILES) { errors.push("Maximum 20 images per batch"); break; }
      valid.push(file);
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
    setCleaningStage("Starting local processing");
    setItems(previous => previous.map(entry => entry.id === item.id ? { ...entry, status: "cleaning", cleanError: undefined } : entry));
    try {
      // Let React paint the processing state before CPU work begins.
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const blob = await cleanImage(item.file, setCleaningStage);
      setCleaningStage("Verifying exported image");
      const after = await readMetadata(blob);
      const url = URL.createObjectURL(blob);
      setItems(previous => previous.map(entry => entry.id === item.id ? { ...entry, cleaned: blob, cleanedUrl: url, status: "clean", metadata: item.metadata, cleanError: undefined, cleanCheck: after } : entry));
      setCleaningStage("Complete");
      setNotice(item.file.name + " is ready to download.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not clean this image.";
      setItems(previous => previous.map(entry => entry.id === item.id ? { ...entry, status: "ready", cleanError: message } : entry));
      setCleaningStage("");
    }
  };
  const downloadItem = (item: ImageRecord) => {
    if (!item.cleaned) return;
    const url = URL.createObjectURL(item.cleaned);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "clean-" + item.file.name.replace(/\.[^.]+$/, "") + (item.file.name.match(/\.[^.]+$/)?.[0] ?? "");
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    URL.revokeObjectURL(url);
  };
  const cleanAll = async () => {
    setBusy(true); setCleaningStage("Preparing batch"); setNotice("Cleaning images locally in your browser…");
    const zip = new JSZip();
    let success = 0;
    for (const item of items) {
      if (item.cleaned) { zip.file("clean-" + item.file.name, item.cleaned); success++; continue; }
      try {
        setItems(previous => previous.map(entry => entry.id === item.id ? { ...entry, status: "cleaning" } : entry));
        const blob = await cleanImage(item.file, setCleaningStage);
        setCleaningStage("Verifying " + item.file.name);
        const after = await readMetadata(blob);
        const url = URL.createObjectURL(blob);
        zip.file("clean-" + item.file.name, blob);
        setItems(previous => previous.map(entry => entry.id === item.id ? { ...entry, cleaned: blob, cleanedUrl: url, status: "clean", cleanCheck: after } : entry));
        success++;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not clean image";
        setItems(previous => previous.map(entry => entry.id === item.id ? { ...entry, status: "ready", cleanError: message } : entry));
      }
    }
    if (success) {
      setCleaningStage("Building ZIP archive");
      const archive = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(archive);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "cleanexif-images.zip";
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
      setNotice(success + " cleaned image" + (success === 1 ? "" : "s") + " downloaded as a ZIP file.");
    } else setNotice("No images could be cleaned. Please try another supported image.");
    setBusy(false); setCleaningStage("");
  };
  const faqs = [
    ["What is EXIF data?", "EXIF is information stored inside many image files. It can include camera details, capture date, lens settings and, when enabled, GPS coordinates."],
    ["Does CleanExif upload my photos?", "No. Image processing happens locally in your browser. Your selected image files are not sent to CleanExif image-processing servers."],
    ["Can I remove GPS location from an image?", "Re-encoding a supported image removes embedded metadata commonly used for GPS and camera details. Always inspect the exported file if location privacy is critical."],
    ["Which image formats are supported?", "CleanExif currently supports JPEG, PNG and WebP images. HEIC, animated GIF and SVG are not supported in this version."],
    ["Does removing EXIF data affect image quality?", "PNG is re-encoded losslessly. JPEG and WebP are exported at a high quality setting, but re-encoding can cause a small quality or file-size difference."],
    ["Can I clean multiple images at once?", "Yes. Add up to 20 supported images and use Clean all to download the cleaned files together in a ZIP archive."]
  ];
  return <div className="app-shell">
    <header className="site-header"><div className="container nav-inner"><Logo />
      <button className="mobile-toggle" aria-label="Toggle navigation" onClick={() => setMobileMenu(!mobileMenu)}><Menu size={22} /></button>
      <nav className={mobileMenu ? "nav-links nav-open" : "nav-links"}><a href="#how-it-works" onClick={() => setMobileMenu(false)}>How it works</a><a href="#privacy" onClick={() => setMobileMenu(false)}>Privacy</a><a href="#faq" onClick={() => setMobileMenu(false)}>FAQ</a><a className="button button-primary nav-cta" href="#tool" onClick={() => setMobileMenu(false)}>Start cleaning <ArrowRight size={16} /></a></nav>
    </div></header>

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
                <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={handleInput} />
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
          <div className="workspace-actions"><button className="button button-outline" onClick={() => inputRef.current?.click()}><FilePlus2 size={16} /> Add images</button><button className="button button-primary" onClick={() => void cleanAll()} disabled={busy || readyCount === 0}><Download size={16} /> {busy ? "Cleaning…" : "Clean all & download ZIP"}</button><button className="icon-button" aria-label="Clear all images" onClick={clearAll}><Trash2 size={17} /></button></div></div>
        {notice && <div className="notice"><CheckCircle2 size={16} />{notice}</div>}
        <div className="workspace-grid"><div className="image-list"><div className="panel-label">SELECTED IMAGES <span>{items.length}</span></div>
          {items.map(item => <button key={item.id} className={"image-list-item" + (active?.id === item.id ? " selected" : "")} onClick={() => setActiveId(item.id)}>
            <img src={item.preview} alt="" /><span className="image-list-copy"><b>{item.file.name}</b><small>{formatBytes(item.file.size)} · {item.width} × {item.height}</small></span>
            <span className={"status-dot " + item.status} title={item.status} /> <span className="remove-image" role="button" aria-label={"Remove " + item.file.name} onClick={event => { event.stopPropagation(); removeItem(item.id); }}><X size={15} /></span>
          </button>)}
        </div>
        {active && <div className="inspector-panel"><div className="inspector-preview"><img src={active.preview} alt={active.file.name} /><div className="preview-caption"><b>{active.file.name}</b><span>{active.width} × {active.height} · {formatBytes(active.file.size)}</span></div></div>
          <div className="metadata-panel"><div className="panel-label">METADATA FOUND <span>{metadataRows.length} fields shown</span></div>
            {metadataRows.length ? <div className="metadata-table">{metadataRows.map(row => <div className="metadata-row" key={row.key}><span>{row.label}</span><b>{row.value}</b></div>)}</div> : <div className="empty-metadata"><Fingerprint size={25} /><b>No readable EXIF fields found</b><span>This image may already have little or no EXIF metadata.</span></div>}
            {active.cleanError && <p className="error-text">{active.cleanError}</p>}
            {active.status === "clean" ? <div className="clean-success"><CheckCircle2 size={17} /><span>Clean copy is ready</span><button className="button button-primary" onClick={() => downloadItem(active)}><Download size={15} /> Download</button></div> :
              <button className="button button-primary clean-button" onClick={() => void cleanOne(active)} disabled={active.status === "cleaning" || busy}>{active.status === "cleaning" ? <><RefreshCw className="spin" size={16} /> Processing image…</> : <><ShieldCheck size={17} /> Remove metadata</>}</button>
            {active.status === "cleaning" && <div className="processing-panel" role="status" aria-live="polite"><div className="processing-top"><RefreshCw className="spin" size={15} /><b>{cleaningStage || "Processing locally"}</b><span>In progress</span></div><div className="processing-track"><span /></div><p>Decoding pixels, creating a fresh image and checking its metadata — all in your browser.</p></div>}}
            {active.status === "clean" && <p className="verification-note"><ShieldCheck size={14} /> {active.cleanCheck && Object.keys(active.cleanCheck).length ? "Some readable metadata fields remain. Review this file before sharing." : "No readable EXIF fields were detected after export. This check is not a forensic guarantee."}</p>}<p className="small-disclaimer">A fresh image copy is created. JPEG and WebP are re-encoded at high quality; a small quality or file-size difference may occur.</p>
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