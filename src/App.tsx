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

async function createDemoPhoto(): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 1200; canvas.height = 800;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser could not create the demo image.");
  const gradient = ctx.createLinearGradient(0, 0, 1200, 800);
  gradient.addColorStop(0, "#dcecff"); gradient.addColorStop(1, "#f8fbff");
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1200, 800);
  ctx.fillStyle = "#0d4fae"; ctx.beginPath(); ctx.arc(900, 250, 150, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#ffffff"; ctx.font = "700 66px Arial"; ctx.fillText("CleanExif Demo", 90, 340);
  ctx.fillStyle = "#39516f"; ctx.font = "32px Arial"; ctx.fillText("A sample photo with synthetic camera metadata", 94, 405);
  ctx.fillStyle = "#1769d2"; ctx.fillRect(94, 465, 250, 8);
  const jpeg = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Demo image export failed.")), "image/jpeg", 0.94));
  const source = new Uint8Array(await jpeg.arrayBuffer());
  const make = new TextEncoder().encode("CleanExif Demo Camera\\0");
  const model = new TextEncoder().encode("CE-X1 Synthetic\\0");
  const date = new TextEncoder().encode("2026:11:26 10:30:00\\0");
  const ifdOffset = 8, entryCount = 3, dataOffset = ifdOffset + 2 + entryCount * 12 + 4;
  const tiff = new Uint8Array(dataOffset + make.length + model.length + date.length);
  const view = new DataView(tiff.buffer);
  tiff[0] = 0x49; tiff[1] = 0x49; view.setUint16(2, 42, true); view.setUint32(4, ifdOffset, true);
  view.setUint16(ifdOffset, entryCount, true);
  const entries = [[0x010f, make.length, dataOffset], [0x0110, model.length, dataOffset + make.length], [0x0132, date.length, dataOffset + make.length + model.length]];
  entries.forEach(([tag, length, offset], index) => {
    const pos = ifdOffset + 2 + index * 12;
    view.setUint16(pos, tag, true); view.setUint16(pos + 2, 2, true); view.setUint32(pos + 4, length, true); view.setUint32(pos + 8, offset, true);
  });
  tiff.set(make, dataOffset); tiff.set(model, dataOffset + make.length); tiff.set(date, dataOffset + make.length + model.length);
  const exifHeader = new Uint8Array([0x45,0x78,0x69,0x66,0,0]);
  const payload = new Uint8Array(exifHeader.length + tiff.length); payload.set(exifHeader); payload.set(tiff, exifHeader.length);
  const segment = new Uint8Array(4 + payload.length); segment[0] = 0xff; segment[1] = 0xe1;
  new DataView(segment.buffer).setUint16(2, payload.length + 2, false); segment.set(payload, 4);
  const output = new Uint8Array(source.length + segment.length); output.set(source.slice(0, 2)); output.set(segment, 2); output.set(source.slice(2), 2 + segment.length);
  return new File([output], "cleanexif-interactive-demo.jpg", { type: "image/jpeg", lastModified: Date.now() });
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
    <span className="brand-mark"><ImageIcon size={small ? 19 : 21} strokeWidth={2.4} /></span>
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
  {
    slug: "what-is-exif-data",
    title: "What Is EXIF Data? A Complete Beginner's Guide",
    description: "Learn what EXIF data is, which details a photo can store, how GPS tags work, and how to inspect or remove common image metadata.",
    intro: "A digital photo can contain more than the image you see. Many image files also carry information about the camera, capture settings, date and sometimes the location. This information is called metadata; EXIF is one of its best-known forms.",
    sections: [
      ["What does EXIF mean?", ["EXIF stands for Exchangeable Image File Format. It is a specification for storing information in image files, especially photographs made by digital cameras and smartphones. EXIF information describes aspects of how a photograph was captured; it is not part of the visible scene itself.", "The fields present in a file depend on the camera, phone, app, settings and later editing or export steps. Two photos from the same phone may therefore contain different metadata."]],
      ["What information can EXIF contain?", ["Depending on the device and settings, a photo may include:"], ["Camera make and model", "Capture date and time", "Lens model, focal length and exposure settings", "Orientation and image dimensions", "GPS coordinates when location tagging was enabled", "Software used to edit or export the image"]],
      ["Why does photo metadata matter for privacy?", ["GPS coordinates can disclose where a photo was taken. If a file contains precise location tags, sharing the original may reveal a home, school, workplace or another place connected to the photographer. Dates, device details and author fields can also provide context that a person did not intend to publish.", "Metadata is not automatically harmful. It can be useful for organizing photos, documenting camera settings or preserving a photographic workflow. The important point is to understand what a particular file contains before sharing it publicly."]],
      ["Does every image contain EXIF data?", ["No. Screenshots, graphics, images exported by editing apps and files processed by websites may contain little or no EXIF information. JPEG, PNG and WebP also have different metadata structures. A viewer that reports no EXIF fields has not necessarily checked every possible kind of embedded data.", "A missing GPS field does not prove that a photo has never contained location information. It only means the tool did not find a readable GPS field in the file it inspected."]],
      ["How can you check EXIF data?", ["Use a reputable metadata viewer or an image application that displays file properties. Check the exact copy you intend to share, not an older original or a different download. Look for location, date, camera, author and software fields, and remember that different viewers support different metadata formats.", "CleanExif can inspect readable metadata in supported JPEG, PNG and WebP images directly in your browser. The selected image is processed locally by the application rather than uploaded to CleanExif image-processing servers."]],
      ["How can you remove common photo metadata?", ["A common approach is to decode an image and export a fresh copy. CleanExif uses browser image decoding and canvas export for its supported formats. This re-encoding usually leaves common EXIF, GPS, IPTC and XMP fields out of the newly exported image, but the result should still be checked.", "Re-encoding is not a forensic guarantee. It may change file size and can slightly affect JPEG or WebP quality. Keep your original file and inspect the exported copy with another metadata reader if the image is especially sensitive."]],
      ["A practical privacy checklist", ["Before posting a photo, consider whether the original file contains GPS coordinates or personal details, whether the platform will transform the image, and whether you need to preserve capture information. If you remove metadata, inspect the exported file and share that copy—not the original.", "CleanExif currently supports JPEG, PNG and WebP images, with a 25 MB per-file limit. You can start from the CleanExif homepage and review the result before downloading."]]
    ]
  },
  {
    slug: "how-to-remove-exif-data",
    title: "How to Remove EXIF Data from Photos",
    description: "A step-by-step guide to checking photo metadata and creating a cleaner JPEG, PNG or WebP copy before sharing.",
    intro: "Removing EXIF data can help reduce the amount of camera, date and location information attached to a photo. The safest workflow is to inspect the exact file, create a separate cleaned copy and verify that copy before sharing it.",
    sections: [
      ["1. Understand what you are removing", ["EXIF can contain camera details, capture dates, exposure settings and—when location tagging is enabled—GPS coordinates. Other image metadata standards, such as IPTC and XMP, can store captions, author details, copyright information and editing notes.", "Decide whether you want to remove common embedded metadata or only check for a particular field. A simple EXIF viewer may not inspect every metadata container or proprietary format."]],
      ["2. Keep the original file", ["Make a copy or leave the original untouched. This gives you a way to recover the original image and its capture information if you need it later. Avoid overwriting the only copy of a photo.", "Choose the exact image you plan to publish. A screenshot, messaging-app download and original camera file may all have different metadata."]],
      ["3. Use a tool that explains its processing", ["A metadata-removal tool should clearly state which formats it accepts, whether files leave your device, and what its cleaning method can and cannot guarantee. CleanExif runs its image inspection and re-encoding workflow in your browser; selected image files are not uploaded to its image-processing servers.", "To use CleanExif, open the homepage, choose a JPEG, PNG or WebP image, inspect the metadata fields, and select the option to remove metadata. The tool creates a new exported image for download."]],
      ["4. Check the exported copy", ["Do not assume a successful download proves every possible metadata field is gone. Open the downloaded file in a separate metadata viewer and inspect the fields that matter to you, especially GPS coordinates, capture dates and author information.", "CleanExif performs a readable metadata check on its exported copy, but that check is not a complete forensic examination of every file structure. If the verification reports remaining fields or cannot complete, treat the result cautiously."]],
      ["What can change during re-encoding?", ["A fresh export can change file size, color handling or image quality. CleanExif exports JPEG and WebP at a high quality setting; re-encoding can still introduce a small visual difference. PNG export is lossless for the pixel data rendered by the browser, but it does not preserve every possible original file property.", "The tool currently accepts JPEG, PNG and WebP, up to 25 MB per file. It does not accept formats such as HEIC, animated GIF or SVG."]],
      ["Common mistakes to avoid", ["Do not clean one copy and accidentally upload the original. Do not rely only on a social platform's processing behavior. Do not treat an empty EXIF report as proof that every hidden data format has been removed. And do not discard the original if you may need its capture details later.", "For a related privacy check, read our guide on removing GPS location from photos and our beginner's guide to EXIF data."]]
    ]
  },
  {
    slug: "remove-gps-location-from-photos",
    title: "How to Remove GPS Location from Photos",
    description: "Find out how photos can store GPS coordinates, how to inspect location tags and how to share a cleaner image copy.",
    intro: "Some phones and cameras can add location coordinates to a photo when location tagging is enabled. Before sharing an image publicly, check whether the exact file contains GPS metadata.",
    sections: [
      ["How does a photo get GPS coordinates?", ["A camera or phone may use its location services to record latitude, longitude, altitude or related GPS fields when a photo is captured. The setting is often called Location Tags, Save Location or Geo-tagging, depending on the device and camera app.", "The setting and behavior vary by device. Turning off location tagging can reduce location data in future photos, but it does not remove coordinates already stored in older files."]],
      ["What can GPS metadata reveal?", ["Coordinates can point to the place where a photo was taken. Depending on the precision and context, that may identify a residence, workplace or another regularly visited location. A public photo caption may reveal additional context when combined with the coordinates.", "Not every image has GPS metadata, and a location field does not always mean the coordinates are perfectly accurate. Check the file rather than assuming based on the device or the appearance of the photo."]],
      ["How to check a photo for GPS data", ["Open the exact image file in a metadata viewer and look for GPS Latitude, GPS Longitude, GPS Position or related fields. Some tools show a map; others display coordinates as text. If no GPS fields appear, the viewer may not have found readable GPS metadata, but it may not inspect every possible metadata format.", "CleanExif displays readable metadata found in supported JPEG, PNG and WebP images. You can inspect the file in your browser before deciding whether to export a clean copy."]],
      ["How to make a copy without common GPS tags", ["One option is to export a new image by decoding and re-encoding the pixels. CleanExif uses this browser-based approach for supported formats. The new export is designed to omit common embedded metadata, including typical EXIF GPS fields.", "Keep the original and download the newly exported copy. Then inspect that downloaded copy with a separate metadata reader. CleanExif's built-in verification checks readable metadata, but it is not a forensic guarantee for every proprietary or non-standard data structure."]],
      ["Will turning off location tagging remove old GPS data?", ["No. Changing a camera setting affects future captures; it does not retroactively edit files already saved. Older photos need to be checked and, if appropriate, exported or edited separately.", "Also check copies shared through messaging apps, cloud services or social platforms individually. Each service may transform or preserve different file properties."]],
      ["A safer sharing habit", ["Before posting, inspect the exact file, create a clean copy if needed, verify the downloaded copy and make sure you select that copy for upload. For especially sensitive images, use a specialist workflow and do not rely on a single automated viewer.", "For broader background, see What Is EXIF Data? and How to Remove EXIF Data from Photos."]]
    ]
  },
  {
    slug: "does-instagram-remove-exif-data",
    title: "Does Instagram Remove EXIF Data from Photos?",
    description: "Learn why social platforms may transform uploaded photos, why you should not rely on that behavior for privacy and how to check your own files.",
    intro: "Uploading a photo to a social platform is not the same as sharing the original file directly. Platforms commonly process images for delivery, but the exact metadata behavior can change and should not be treated as a privacy guarantee.",
    sections: [
      ["What happens when you upload a photo?", ["A social platform may resize, recompress, convert or otherwise process an uploaded image to prepare versions for its apps and website. The file served to other users may therefore differ from the original file on your device.", "Image processing can affect metadata, but the details depend on the platform, upload path, file type and current implementation. A platform's public-facing image is not necessarily identical to the file you uploaded."]],
      ["Does Instagram remove EXIF data?", ["You should not assume that Instagram—or any other social platform—removes every metadata field in every situation. Platform processing can change what is present in the version it serves, and behavior may vary over time. Public documentation and independent tests may not cover every device, upload route or future change.", "If you need to know what a particular image contains, inspect the original file and, where relevant, a copy downloaded from the platform. Testing your own workflow is more reliable than relying on a blanket claim about all uploads."]],
      ["Does removing metadata before upload still matter?", ["Yes, if you want to control the file you send. Cleaning a copy before upload means you are not relying on a third party to remove fields for you. It also gives you a chance to inspect the exact output before it leaves your device.", "Keep in mind that a platform may still re-encode or otherwise alter the image after upload. Pre-cleaning is a privacy precaution, not a promise about how a platform will store, process or display the file."]],
      ["How to check your own image workflow", ["First, inspect the original image for GPS coordinates, capture date, camera model and author fields. Next, if you choose to upload it, download the platform-served copy where that option is available and inspect that copy separately. Compare the results using a metadata viewer that supports the relevant format.", "Do not compare different versions of a photo and assume they are the same file. A messaging-app copy, screenshot or downloaded social image may have been transformed at a different stage."]],
      ["How CleanExif fits into the process", ["CleanExif lets you inspect and create a fresh copy of supported JPEG, PNG and WebP images in your browser. Selected image files are not uploaded to CleanExif image-processing servers. You can inspect the exported copy before deciding whether to upload it elsewhere.", "CleanExif does not control Instagram or guarantee what another platform does after upload. For sensitive photos, verify the exact file you plan to share and review the platform's current privacy information."]],
      ["Bottom line", ["Treat platform metadata handling as something that can change, not as your only privacy control. Inspect the original, clean a separate copy when appropriate, and verify the result. Read our guide to removing GPS location from photos for more detail on location tags."]]
    ]
  },
  {
    slug: "how-to-check-photo-metadata",
    title: "How to Check Photo Metadata Online",
    description: "Learn how to inspect photo metadata such as GPS location, camera model, capture date and editing details before sharing.",
    intro: "Photo metadata can help explain how an image was captured and edited. Checking it before sharing gives you a clearer picture of what information may travel with the file.",
    sections: [
      ["What should you look for?", ["Start with the fields most relevant to your purpose. For privacy, check GPS coordinates, capture date and time, camera or device model, author names and software fields. For photography, exposure settings, focal length and lens information may be useful.", "Metadata standards include EXIF, IPTC and XMP. A viewer may support some fields but not others, so its report should be understood as the information it can read—not a complete inventory of every possible file structure."]],
      ["Choose the exact file you will share", ["A camera original, edited export, screenshot and social-media download can contain different metadata. Inspect the exact file you intend to upload or send. If you edit the image after checking it, inspect the final export again.", "Avoid uploading private photos to an unknown viewer just to inspect them. Check whether a tool processes files locally or sends them to a remote server, and read its privacy explanation before use."]],
      ["Check metadata in your browser", ["CleanExif supports JPEG, PNG and WebP. Open the tool, select an image and review the metadata categories shown in the inspector. The application processes selected images locally in your browser rather than uploading them to CleanExif image-processing servers.", "The current file limit is 25 MB per image. CleanExif can also handle a batch of up to 20 images within a 100 MB total batch limit. Unsupported formats such as HEIC, animated GIF and SVG are not accepted."]],
      ["How to interpret an empty report", ["An empty report means the viewer did not find readable fields within the metadata types it checks. It does not prove that the file has never contained metadata or that every possible embedded data structure is absent.", "Different image formats store information differently. If the image is important or sensitive, consider checking it with another reputable metadata reader and compare the exact downloaded file."]],
      ["What to do after checking", ["If you find location or personal details you do not want to share, keep the original and create a separate clean copy. Inspect the output again before sharing it. If the metadata is useful—for example, for photography records—you may prefer to retain the original and share a copy instead.", "For more detail, read What Is EXIF Data? or How to Remove EXIF Data from Photos."]]
    ]
  }
];

function BlogPage({ slug }: { slug?: string }) {
  const article = blogArticles.find(item => item.slug === slug);
  const isArticle = Boolean(slug && article);
  const title = article?.title ?? (slug ? "Article not found" : "The CleanExif Blog");
  const description = article?.description ?? (slug ? "This CleanExif article could not be found." : "Practical guides to EXIF data, photo metadata, GPS privacy and safer image sharing.");
  const publishedDate = "2026-11-26";
  useEffect(() => {
    const canonical = window.location.origin + window.location.pathname;
    document.title = title + " | CleanExif";
    const setMeta = (selector: string, attribute: string, value: string) => {
      let element = document.head.querySelector(selector) as HTMLMetaElement | null;
      if (!element) {
        element = document.createElement("meta");
        const match = selector.match(/\[(name|property)="([^"]+)"\]/);
        if (match) element.setAttribute(match[1], match[2]);
        document.head.appendChild(element);
      }
      element.setAttribute(attribute, value);
    };
    setMeta('meta[name="description"]', "content", description);
    setMeta('meta[property="og:type"]', "content", isArticle ? "article" : "website");
    setMeta('meta[property="og:title"]', "content", title + " | CleanExif");
    setMeta('meta[property="og:description"]', "content", description);
    setMeta('meta[property="og:url"]', "content", canonical);
    setMeta('meta[name="twitter:title"]', "content", title + " | CleanExif");
    setMeta('meta[name="twitter:description"]', "content", description);
    let canonicalLink = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!canonicalLink) {
      canonicalLink = document.createElement("link");
      canonicalLink.rel = "canonical";
      document.head.appendChild(canonicalLink);
    }
    canonicalLink.href = canonical;
    document.getElementById("blog-article-schema")?.remove();
    document.getElementById("blog-breadcrumb-schema")?.remove();
    if (article) {
      const schema = document.createElement("script");
      schema.id = "blog-article-schema";
      schema.type = "application/ld+json";
      schema.textContent = JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Article",
        headline: article.title,
        description: article.description,
        datePublished: publishedDate,
        dateModified: publishedDate,
        author: { "@type": "Organization", name: "CleanExif" },
        publisher: { "@type": "Organization", name: "CleanExif" },
        mainEntityOfPage: canonical
      });
      document.head.appendChild(schema);
    }
    const breadcrumb = document.createElement("script");
    breadcrumb.id = "blog-breadcrumb-schema";
    breadcrumb.type = "application/ld+json";
    breadcrumb.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: window.location.origin + "/" },
        { "@type": "ListItem", position: 2, name: "Blog", item: window.location.origin + "/blog" },
        ...(article ? [{ "@type": "ListItem", position: 3, name: article.title, item: canonical }] : [])
      ]
    });
    document.head.appendChild(breadcrumb);
    if (slug && !article) {
      let robots = document.head.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
      if (!robots) {
        robots = document.createElement("meta");
        robots.name = "robots";
        document.head.appendChild(robots);
      }
      robots.content = "noindex, follow";
    }
    return () => {
      document.getElementById("blog-article-schema")?.remove();
      document.getElementById("blog-breadcrumb-schema")?.remove();
    };
  }, [title, description, article, isArticle, slug]);
  const related = article ? blogArticles.filter(item => item.slug !== article.slug).slice(0, 3) : [];
  return <div className="blog-page">
    <header className="site-header"><div className="container nav-inner"><Logo /><div className="blog-nav"><a className="nav-link" href="/blog">Blog</a><a className="button button-primary" href="/">Open CleanExif</a></div></div></header>
    <main className="container blog-content">
      <a className="blog-back" href="/blog">← All articles</a>
      {article ? <article className="blog-article">
        <span className="eyebrow">CLEANEXIF GUIDES · UPDATED NOVEMBER 26, 2026</span>
        <h1>{article.title}</h1>
        <p className="blog-lead">{article.intro}</p>
        <div className="blog-body">{article.sections.map(([heading, paragraphs, bullets]: any) => <section key={heading}>
          <h2>{heading}</h2>
          {paragraphs.map((paragraph: string) => <p key={paragraph}>{paragraph}</p>)}
          {bullets && <ul>{bullets.map((item: string) => <li key={item}>{item}</li>)}</ul>}
        </section>)}</div>
        <div className="blog-cta"><h2>Inspect and clean your photos</h2><p>Check readable metadata and create a fresh copy of supported images in your browser.</p><a className="button button-primary" href="/">Open the free tool →</a></div>
        <section className="blog-related"><h2>Related guides</h2><div className="blog-related-grid">{related.map(item => <a className="blog-related-card" href={"/blog/" + item.slug} key={item.slug}><b>{item.title}</b><span>Read guide →</span></a>)}</div></section>
      </article> : slug ? <section className="blog-not-found"><h1>Article not found</h1><p>This page may have moved or the address may be incorrect.</p><a className="button button-primary" href="/blog">Browse all guides</a></section> : <>
        <span className="eyebrow">PRIVACY · PHOTOGRAPHY · METADATA</span>
        <h1 className="blog-heading">The CleanExif Blog</h1>
        <p className="blog-lead">Straightforward guides to photo metadata, location privacy and safer image sharing.</p>
        <div className="blog-grid">{blogArticles.map((item, index) => <article className="blog-card" key={item.slug}>
          <span className="blog-card-number">GUIDE 0{index + 1}</span>
          <h2><a href={"/blog/" + item.slug}>{item.title}</a></h2>
          <p>{item.description}</p>
          <a className="blog-read" href={"/blog/" + item.slug}>Read article →</a>
        </article>)}</div>
      </>}
    </main>
    <Footer />
  </div>;
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
  const loadInteractiveDemo = async () => {\n    try { const sample = await createDemoPhoto(); await addFiles([sample]); setNotice("Interactive demo loaded. Inspect the synthetic camera metadata, then clean and download the sample."); }\n    catch (error) { setNotice(error instanceof Error ? error.message : "Could not load the demo image."); }\n  };\n  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
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
                <div className="upload-actions"><button className="button button-primary choose-button" onClick={() => inputRef.current?.click()}><FilePlus2 size={18} /> Choose images</button><button className="button button-demo" onClick={() => void loadInteractiveDemo()} disabled={busy}><Zap size={16} /> Try interactive demo</button></div>
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