import { lazy, Suspense, useCallback, useMemo, useRef, useState, useEffect, type ChangeEvent } from "react";
import SponsorAd from "./SponsorAd";
import { SiteHeader, SiteFooter } from "./SiteChrome";
import { usePlanAccess } from "./planAccess";
const PrivacyTools = lazy(() => import("./PrivacyTools"));

// Keep account, plan and admin screens out of the initial homepage bundle.
const AdminPage = lazy(() => import("./AdminPage"));
const PlansPage = lazy(() => import("./PlansPage"));
const AccountPage = lazy(() => import("./AccountPage"));
import {
  AlertCircle, ArrowRight, Camera, Check, CheckCircle2, ChevronDown,
  Download, Eye, FilePlus2, Fingerprint, Globe2, Image as ImageIcon, ScanSearch,
  LockKeyhole, MapPin, Monitor, RefreshCw, ShieldCheck,
  Trash2, UploadCloud, X, Zap
} from "lucide-react";

type Meta = Record<string, unknown>;
type ImageRecord = {
  id: string; file: File; preview: string; width: number; height: number;
  metadata: Meta | null; cleaned?: Blob; cleanedUrl?: string; cleanError?: string; cleanCheck?: Meta | null; cleanCheckError?: boolean; downloaded?: boolean;
  status: "ready" | "cleaning" | "clean";
};

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_PIXELS = 40_000_000;
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
    const { default: exifr } = await import("exifr");
    const result = await exifr.parse(blob as File, { exif: true, gps: true, iptc: true, xmp: true, icc: false });
    return result && typeof result === "object" ? result as Meta : null;
  } catch { return null; }
}
async function verifyMetadata(blob: Blob): Promise<{ metadata: Meta | null; error: boolean }> {
  try {
    // Verify privacy-sensitive metadata only. ICC profile fields describe color
    // rendering and are not camera, location, date, or user-identifying metadata.
    const { default: exifr } = await import("exifr");
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
    if (bitmap.width * bitmap.height > MAX_IMAGE_PIXELS) {
      throw new Error("This image is too large to process safely in your browser. Choose an image with 40 megapixels or fewer.");
    }
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
      "When you visit this website, your hosting provider or network infrastructure may process standard connection information such as IP address, request time and browser details in routine server logs. Google AdSense may load on the homepage and blog pages to display advertising. Google and its advertising partners may process IP addresses, cookies, web beacons, browser or device identifiers and ad interactions for ad delivery, measurement and personalization.",
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
      "CleanExif loads Google AdSense on the homepage and blog pages only. Google and other advertising partners may place or read cookies, web beacons, IP addresses and other identifiers to deliver, measure and personalize advertisements. These technologies may use information about visits to this website or other websites.",
      "You can manage Google's personalized advertising settings at adssettings.google.com and review additional industry opt-out information at aboutads.info/choices. Browser settings can also be used to restrict or clear cookies, although some website features may not work as expected.",
      "For visitors in the European Economic Area, the United Kingdom and Switzerland, check Google's current publisher consent requirements and configure an appropriate certified consent management platform before personalized advertising is served in those regions.",
      "The application uses browser memory and temporary object URLs to preview and process images. These are not cookies and are not sent as image uploads to CleanExif.",
      "Third-party font resources may be requested from Google Fonts. Browser or hosting infrastructure may also use technically necessary mechanisms to deliver the website."
    ]
  };
  return <div className="legal-page"><SiteHeader />
    <main className="container legal-content"><span className="eyebrow"><ShieldCheck size={15} /> CLEANEXIF POLICIES</span><h1>{title}</h1>
      <p className="legal-date">Last updated: November 25, 2026</p>
      {(content[type] ?? []).map((p, i) => <p key={i}>{p}</p>)}
    </main><Footer /></div>;
}
function Footer() { return <SiteFooter />; }

const blogArticles = [
  {
    slug: "inspect-photo-metadata-online",
    title: "How to Inspect Photo Metadata Online",
    category: "How To",
    image: "/blog/metadata-inspector.svg",
    readTime: "4 min read",
    description: "Use CleanExif's Metadata Inspector to review readable EXIF, GPS, camera, date and other image details before sharing.",
    intro: "A photo can contain information beyond its visible pixels. CleanExif's Metadata Inspector helps you review readable metadata in supported JPEG, PNG and WebP images directly in your browser.",
    sections: [
      ["What can the inspector show?", ["Depending on what is embedded in the selected file, the inspector can display GPS and location fields, camera and device details, date and time, exposure and capture information, and other readable metadata. A file may contain only some of these fields—or none."]],
      ["How to inspect an image with CleanExif", ["Open CleanExif and select a JPEG, PNG or WebP image. The tool reads the selected image in your browser and groups available information into categories so you can review the fields more easily.", "Choose the exact file you plan to share. An original camera photo, an edited export and a screenshot can all contain different metadata."]],
      ["Understand an empty result", ["If no fields are displayed, CleanExif did not find readable metadata in the categories it checks. This is not proof that every possible proprietary or non-standard data structure is absent. For important files, compare the result with another reputable metadata reader."]],
      ["Keep your original file", ["Inspection does not require you to overwrite your photo. Keep the original if you need its camera settings or capture information, and create a separate clean copy only when you decide to remove metadata."]]
    ]
  },
  {
    slug: "remove-exif-data-from-jpg-png-webp",
    title: "How to Remove EXIF Metadata from JPG, PNG and WebP",
    category: "How To",
    image: "/blog/metadata-removal.svg",
    readTime: "5 min read",
    description: "A practical walkthrough for creating a fresh image copy with common embedded metadata removed using CleanExif.",
    intro: "CleanExif creates a fresh export of supported images in your browser. This guide explains the workflow, supported formats and why you should verify the downloaded copy.",
    sections: [
      ["Supported image formats", ["CleanExif accepts JPEG/JPG, PNG and WebP images. The current per-file size limit is 25 MB. Formats such as HEIC, animated GIF and SVG are not supported by this image-cleaning workflow."]],
      ["Clean a photo with CleanExif", ["Open the CleanExif homepage and choose the image you want to process. Review its metadata, then select the remove-metadata action. CleanExif decodes and re-encodes the image in your browser to create a separate file for download.", "Your selected image is processed locally by the application; it is not uploaded to CleanExif image-processing servers."]],
      ["What happens during re-encoding?", ["The exported image is designed to omit common embedded EXIF, GPS, IPTC and XMP information. Re-encoding can change file size and may slightly affect JPEG or WebP image quality. PNG export preserves the rendered pixel data, but not every property of the original file."]],
      ["Verify before sharing", ["Inspect the downloaded copy—not just the original—in a separate metadata reader if the image is sensitive. CleanExif checks readable metadata after export, but this is not a forensic guarantee for every possible file structure. Keep your original as a backup."]]
    ]
  },
  {
    slug: "remove-gps-location-from-photos",
    title: "How to Check and Remove GPS Location from Photos",
    category: "Privacy",
    image: "/blog/gps-photo-privacy.svg",
    readTime: "4 min read",
    description: "Learn where GPS tags appear in photo metadata and how to create a cleaner copy before sharing.",
    intro: "Some cameras and phones can save coordinates in a photo when location tagging is enabled. CleanExif can help you inspect readable GPS fields and create a fresh copy of a supported image.",
    sections: [
      ["Where can GPS information appear?", ["Depending on the device and file, location information may appear as GPS latitude, longitude, altitude or a combined position field. Not every image contains these values."]],
      ["Check for location fields", ["Select a JPEG, PNG or WebP image in CleanExif. Review the GPS and location category in the Metadata Inspector. If no GPS fields appear, the tool did not find readable location metadata in the selected file."]],
      ["Create a copy without common GPS tags", ["If you want to remove common embedded metadata, use CleanExif's remove-metadata action to export a fresh image. The re-encoded copy is designed to omit common EXIF GPS fields along with other supported metadata."]],
      ["Verify the exported image", ["Keep the original, download the new copy and inspect that exact downloaded file. CleanExif's readable metadata check is useful as a basic verification step, but it is not a complete forensic scan of every possible image structure."]]
    ]
  },
  {
    slug: "add-watermark-to-photos-online",
    title: "How to Add a Watermark to Photos Online",
    category: "CleanExif Tools",
    image: "/blog/image-metadata-viewer.svg",
    readTime: "4 min read",
    description: "Use CleanExif's Watermark Maker to place a repeating text watermark on supported images and export your result.",
    intro: "A visible watermark can help identify image ownership or discourage casual reuse. CleanExif includes a browser-based Watermark Maker for adding repeating text to supported image files.",
    sections: [
      ["Prepare a supported image", ["The Watermark Maker accepts JPEG, PNG and WebP images. Choose the image you want to mark and review the preview before exporting."]],
      ["Customize the repeating text", ["Enter the text you want to display, then adjust the available watermark controls such as opacity, size, spacing, rotation and colour. The live preview helps you judge how the pattern appears across the image."]],
      ["Export and review", ["Generate the watermarked copy and inspect the exported image before using it. Keep an untouched original so you can make a different version later if needed."]],
      ["A watermark is not metadata protection", ["A visible watermark changes the appearance of the image; it does not replace metadata inspection or metadata removal. If privacy is your goal, use the Metadata Inspector and remove-metadata workflow separately."]]
    ]
  },
  {
    slug: "cleanexif-image-privacy-workflow",
    title: "A Simple Photo Privacy Workflow with CleanExif",
    category: "How To",
    image: "/blog/cleanexif-workflow.svg",
    readTime: "3 min read",
    description: "Follow a simple inspect, clean, verify and download workflow using CleanExif's image tools.",
    intro: "Before sharing a photo, it helps to know what information the file contains. CleanExif brings metadata inspection and image cleaning into one browser-based workflow.",
    sections: [
      ["1. Select the exact image", ["Choose the JPEG, PNG or WebP file you intend to share. The tool currently supports files up to 25 MB each."]],
      ["2. Inspect readable metadata", ["Review the available GPS, camera, date, capture and other metadata categories. The fields shown depend on what is embedded in the file."]],
      ["3. Create a clean copy if needed", ["Use the remove-metadata action to re-encode the image and create a separate export. Your original file remains available to you."]],
      ["4. Verify and download", ["Review the built-in readable metadata check and download the new copy. For sensitive images, inspect the downloaded file with another reputable metadata reader too."]],
      ["Choose the right tool for the task", ["Use Metadata Inspector to understand what a photo contains, Remove Metadata to create a cleaner copy, and Watermark Maker when you want to add visible repeating text. These tools solve different problems and can be used independently."]]
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
    <SiteHeader />
    <main className="container blog-content">
      <a className="blog-back" href="/blog">← All articles</a>
      {article ? <article className="blog-article">
        <span className="eyebrow">CLEANEXIF GUIDES · UPDATED NOVEMBER 26, 2026</span>
        <div className="blog-article-cover"><img src={article.image} alt={article.title} /></div>
        <h1>{article.title}</h1>
        <div className="blog-article-meta"><span>{article.category}</span><span>{article.readTime}</span><span>CleanExif Guide</span></div>
        <p className="blog-lead">{article.intro}</p>
        <div className="blog-body">{article.sections.map(([heading, paragraphs, bullets]: any) => <section key={heading}>
          <h2>{heading}</h2>
          {paragraphs.map((paragraph: string) => <p key={paragraph}>{paragraph}</p>)}
          {bullets && <ul>{bullets.map((item: string) => <li key={item}>{item}</li>)}</ul>}
        </section>)}</div>
        <SponsorAd placement="blog_inline" />
        <div className="blog-cta"><h2>Inspect and clean your photos</h2><p>Check readable metadata and create a fresh copy of supported images in your browser.</p><a className="button button-primary" href="/">Open the free tool →</a></div>
        <section className="blog-related"><h2>Related guides</h2><div className="blog-related-grid">{related.map(item => <a className="blog-related-card" href={"/blog/" + item.slug} key={item.slug}><b>{item.title}</b><span>Read guide →</span></a>)}</div></section>
        <SponsorAd placement="blog_end" />
      </article> : slug ? <section className="blog-not-found"><h1>Article not found</h1><p>This page may have moved or the address may be incorrect.</p><a className="button button-primary" href="/blog">Browse all guides</a></section> : <>
        <section className="blog-hero">
          <div className="blog-hero-copy"><span className="eyebrow">CLEANEXIF KNOWLEDGE HUB</span><h1 className="blog-heading">Photo Privacy, Made Clear.</h1><p className="blog-lead">Practical guides for inspecting image metadata, creating clean copies and using CleanExif tools with confidence.</p><div className="blog-categories"><span>How To</span><span>Privacy</span><span>CleanExif Tools</span></div></div>
          <img src="/blog/cleanexif-workflow.svg" alt="CleanExif image workflow illustration" />
        </section>
        <section className="blog-featured"><div className="blog-section-heading"><div><span className="eyebrow">START HERE</span><h2>Featured Guides</h2></div><span>Built around the tools on CleanExif</span></div>
          <div className="blog-featured-grid">{blogArticles.slice(0,3).map((item)=><article className="blog-card blog-featured-card" key={item.slug}><a className="blog-card-image" href={"/blog/"+item.slug}><img src={item.image} alt={item.title}/></a><div className="blog-card-copy"><span className="blog-card-category">{item.category} · {item.readTime}</span><h3><a href={"/blog/"+item.slug}>{item.title}</a></h3><p>{item.description}</p><a className="blog-read" href={"/blog/"+item.slug}>Read guide <ArrowRight size={14}/></a></div></article>)}</div>
        </section>
        <section className="blog-all-guides"><div className="blog-section-heading"><div><span className="eyebrow">THE LIBRARY</span><h2>All CleanExif Guides</h2></div><span>{blogArticles.length} practical articles</span></div>
          <div className="blog-grid">{blogArticles.map((item,index)=><article className="blog-card" key={item.slug}><a className="blog-card-image" href={"/blog/"+item.slug}><img src={item.image} alt={item.title}/></a><div className="blog-card-copy"><span className="blog-card-number">GUIDE 0{index+1} · {item.category}</span><h3><a href={"/blog/"+item.slug}>{item.title}</a></h3><p>{item.description}</p><a className="blog-read" href={"/blog/"+item.slug}>Read article <ArrowRight size={14}/></a></div></article>)}</div>
        </section>
      </>}
    </main>
    <Footer />
  </div>;
}


function DemoPage() {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [finished, setFinished] = useState(false);
  const steps = [
    { title: "A photo can carry hidden details", description: "This synthetic sample contains example camera, capture-time and GPS metadata. Nothing here comes from a real person or device.", action: "Inspecting sample photo", detail: "Sample loaded · 1200 × 800 · JPEG" },
    { title: "Inspect the metadata", description: "CleanExif reads supported metadata locally in your browser, so you can see what may be shared with an image.", action: "Reading image metadata", detail: "Camera: CleanExif Demo Camera · Model: CE-X1 Synthetic · Date: 26 Nov 2026 · GPS: 31.5204° N, 74.3587° E" },
    { title: "Spot the location disclosure", description: "Location tags can reveal where a photo was captured. This sample uses fictional coordinates around Lahore only for demonstration.", action: "GPS location detected", detail: "31.5204° N, 74.3587° E · Synthetic demo coordinates" },
    { title: "Remove supported metadata", description: "The image is re-encoded in your browser to create a clean copy. The original sample remains unchanged.", action: "Re-encoding image locally", detail: "EXIF · GPS · IPTC · XMP — supported metadata removed" },
    { title: "Verify the clean copy", description: "CleanExif re-reads the exported copy to check for readable privacy-related metadata fields.", action: "Verification complete", detail: "0 readable privacy metadata fields detected in this demo copy" }
  ];
  useEffect(() => {
    if (!playing || finished) return;
    const timer = window.setTimeout(() => {
      setStep(current => {
        if (current >= steps.length - 1) { setPlaying(false); setFinished(true); return current; }
        return current + 1;
      });
    }, 3400);
    return () => window.clearTimeout(timer);
  }, [playing, finished, step]);
  const restart = () => { setStep(0); setFinished(false); setPlaying(true); };
  const goNext = () => { if (step >= steps.length - 1) { setFinished(true); setPlaying(false); } else setStep(value => value + 1); };
  const current = steps[step];
  return <div className="demo-page">
    <SiteHeader />
    <main className="demo-main">
      <div className="demo-intro"><span className="demo-label"><span className="demo-live-dot" /> INTERACTIVE WALKTHROUGH</span><br/><span className="eyebrow">SEE HOW IT WORKS</span><h1>CleanExif, <span>in action.</span></h1><p>A guided, animated walkthrough using a synthetic sample photo. No upload, account or real personal data required.</p></div>
      <section className="demo-stage" aria-label="Animated CleanExif walkthrough">
        <div className="demo-stage-top"><span><span className="demo-live-dot" /> LIVE PRODUCT WALKTHROUGH</span><span>STEP 0{step + 1} / 0{steps.length}</span></div>
        <div className="demo-stage-body">
          <div className="demo-photo-wrap"><div className="demo-photo"><div className="demo-photo-sun" /><div className="demo-photo-hill hill-one" /><div className="demo-photo-hill hill-two" /><div className="demo-photo-caption">CLEANEXIF SAMPLE</div></div><div className={"demo-scan-line scan-step-" + step} /></div>
          <div className="demo-console"><div className="demo-console-head"><span className="demo-console-icon"><ShieldCheck size={19}/></span><div><b>Privacy inspection</b><small>All processing stays in this demo experience</small></div><span className="demo-status">{finished ? "Verified" : "Running"}</span></div>
            <h2 key={current.title}>{current.title}</h2><p>{current.description}</p>
            <div className="demo-progress"><span style={{width: ((step + 1) / steps.length * 100) + "%"}} /></div>
            <div className="demo-log"><span className="demo-log-dot"/><div><b>{current.action}</b><small>{current.detail}</small></div></div>
            <div className="demo-metadata-grid">
              <div className={step >= 1 ? "revealed" : ""}><Camera size={16}/><span>Camera</span><b>{step >= 1 ? "CE-X1" : "Waiting"}</b></div>
              <div className={step >= 1 ? "revealed" : ""}><Fingerprint size={16}/><span>Date & time</span><b>{step >= 1 ? "26 Nov 2026" : "Waiting"}</b></div>
              <div className={step >= 2 ? "revealed warning" : ""}><MapPin size={16}/><span>GPS location</span><b>{step >= 2 ? (step >= 3 ? "Removed" : "Detected") : "Waiting"}</b></div>
              <div className={step >= 4 ? "revealed success" : ""}><CheckCircle2 size={16}/><span>Verification</span><b>{step >= 4 ? "0 fields left" : "Pending"}</b></div>
            </div>
          </div>
        </div>
        <div className="demo-controls"><div className="demo-timeline">{steps.map((item,index)=><button key={item.title} className={index===step?"active":index<step?"done":""} onClick={()=>{setStep(index);setFinished(false);setPlaying(false);}} aria-label={"Go to step "+(index+1)}><span/>{index+1}</button>)}</div>
          <div className="demo-control-buttons"><button className="button button-secondary" onClick={restart}><RefreshCw size={16}/> Restart</button><button className="button button-primary" onClick={()=>{if(finished)restart();else if(playing)setPlaying(false);else setPlaying(true);}}>{playing ? "Pause walkthrough" : finished ? "Play again" : "Resume"} <ArrowRight size={16}/></button><button className="button button-secondary" onClick={goNext} disabled={finished}>Next step</button></div>
        </div>
      </section>
      <div className="demo-disclaimer"><ShieldCheck size={17}/><span><b>Demonstration only.</b> Metadata and coordinates are synthetic examples. The walkthrough illustrates the workflow; it does not process or upload a real photo.</span></div>
      <div className="demo-bottom-link"><a href="/#tool">Ready to inspect your own image? Start cleaning <ArrowRight size={16}/></a></div>
    </main>
    <SiteFooter />
  </div>;
}


type RepeatWatermarkSettings = { text: string; opacity: number; size: number; spacing: number; rotation: number; color: "white" | "charcoal" };
type WatermarkFile = { id: string; file: File; url: string; width: number; height: number; output?: Blob; outputUrl?: string; downloaded?: boolean };
function WatermarkPage() {
  const { limits, email, isPaid, dailyUsage, consumeImage, isLocked, resetCountdown, loading: planLoading } = usePlanAccess("watermark");
  const [files, setFiles] = useState<WatermarkFile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [settings, setSettings] = useState<RepeatWatermarkSettings>({ text: "@Mudassar", opacity: 28, size: 34, spacing: 190, rotation: -28, color: "white" });
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [addingFiles, setAddingFiles] = useState(false);
  const [addProgress, setAddProgress] = useState({ done: 0, total: 0 });
  const [exportProgress, setExportProgress] = useState({ done: 0, total: 0, stage: "" });
  const [notice, setNotice] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const active = files.find(file => file.id === activeId) ?? files[0] ?? null;
  const filesRef = useRef<WatermarkFile[]>([]);
  filesRef.current = files;
  const clearAllFiles = () => {
    if (busy || addingFiles) return;
    files.forEach(file => {
      URL.revokeObjectURL(file.url);
      if (file.outputUrl) URL.revokeObjectURL(file.outputUrl);
    });
    setFiles([]);
    setActiveId(null);
    setPreviewUrl(null);
    setNotice("All selected images have been removed.");
    if (inputRef.current) inputRef.current.value = "";
  };
  useEffect(() => () => filesRef.current.forEach(file => { URL.revokeObjectURL(file.url); if (file.outputUrl) URL.revokeObjectURL(file.outputUrl); }), []);
  const addFiles = async (list: FileList | File[]) => {
    const incoming = Array.from(list);
    if (!incoming.length || addingFiles || busy) return;
    setAddingFiles(true);
    const accepted = incoming.filter(file => ["image/jpeg","image/png","image/webp"].includes(file.type) && file.size <= limits.maxFileMB * 1024 * 1024);
    const records: WatermarkFile[] = [];
    const errors: string[] = incoming.length - accepted.length ? ["Unsupported files or files over your "+limits.maxFileMB+" MB per-file limit were skipped."] : [];
    const existingBytes = files.reduce((sum,file)=>sum+file.file.size,0);
    setAddProgress({ done: 0, total: accepted.length });
    try {
      for (const file of accepted) {
        if (files.length + records.length >= limits.maxImages) { errors.push("Your "+limits.name+" plan allows "+limits.maxImages+" images per batch. Upgrade to add more."); break; }
        const selectedBytes = records.reduce((sum,item)=>sum+item.file.size,0);
        if (existingBytes + selectedBytes + file.size > limits.totalMB * 1024 * 1024) { errors.push("Your "+limits.name+" plan allows "+limits.totalMB+" MB total per batch. Upgrade for more capacity."); break; }
        try {
          const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
          try {
            if (bitmap.width * bitmap.height > MAX_IMAGE_PIXELS) {
              throw new Error("This image exceeds the 40-megapixel browser processing limit.");
            }
            const record = { id: crypto.randomUUID(), file, url: URL.createObjectURL(file), width: bitmap.width, height: bitmap.height };
            records.push(record);
          } finally {
            bitmap.close();
          }
        } catch { errors.push(file.name + ": could not read image."); }
        setAddProgress(previous => ({ ...previous, done: previous.done + 1 }));
      }
      setFiles(previous => [...previous, ...records]);
      if (!activeId && records[0]) setActiveId(records[0].id);
      setNotice(errors.length ? (records.length ? records.length + " image(s) added. " : "") + errors.join(" ") : records.length + " image(s) ready.");
    } finally {
      setAddingFiles(false);
      setAddProgress({ done: 0, total: 0 });
    }
  };
  const renderWatermark = async (item: WatermarkFile, config: RepeatWatermarkSettings = settings): Promise<Blob> => {
    const bitmap = await createImageBitmap(item.file, { imageOrientation: "from-image" });
    try {
      if (bitmap.width * bitmap.height > MAX_IMAGE_PIXELS) {
        throw new Error("This image exceeds the 40-megapixel browser processing limit.");
      }
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d", { alpha: item.file.type !== "image/jpeg" });
      if (!ctx) throw new Error("Your browser could not prepare this image.");
      if (item.file.type === "image/jpeg") { ctx.fillStyle = "#fff"; ctx.fillRect(0,0,canvas.width,canvas.height); }
      ctx.drawImage(bitmap,0,0);
      const fontSize = Math.max(12, Math.round(Math.min(canvas.width,canvas.height) * config.size / 1000));
      const label = config.text.trim().slice(0,80);
      if (!label) throw new Error("Enter watermark text before exporting.");
      ctx.save();
      ctx.globalAlpha = config.opacity / 100;
      ctx.fillStyle = config.color === "white" ? "#ffffff" : "#20242b";
      ctx.font = "700 " + fontSize + "px Arial, Helvetica, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.shadowColor = config.color === "white" ? "rgba(0,0,0,.48)" : "rgba(255,255,255,.5)";
      ctx.shadowBlur = Math.max(1,fontSize * .12);
      const diagonal = Math.hypot(canvas.width,canvas.height);
      const labelWidth = ctx.measureText(label).width;
      // Space stamps by their measured text width, not merely by font size.
      // This prevents long names from colliding and producing the dense,
      // overlapping pattern seen in exported full-page screenshots.
      const stepX = Math.max(labelWidth + fontSize, labelWidth * config.spacing / 100);
      const stepY = Math.max(fontSize * 2.4, fontSize * config.spacing / 100 * 1.1);
      ctx.translate(canvas.width/2,canvas.height/2);
      ctx.rotate(config.rotation * Math.PI / 180);
      for (let y = -diagonal; y <= diagonal; y += stepY) {
        const row = Math.round((y + diagonal) / stepY);
        for (let x = -diagonal; x <= diagonal; x += stepX) {
          ctx.fillText(label, x + (row % 2 ? stepX/2 : 0), y);
        }
      }
      ctx.restore();
      return await new Promise<Blob>((resolve,reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Image export failed.")),item.file.type,.94));
    } finally { bitmap.close(); }
  };
  useEffect(() => {
    let cancelled = false;
    let nextUrl: string | null = null;
    if (!active || !settings.text.trim()) {
      setPreviewUrl(null);
      return;
    }
    void renderWatermark(active, settings).then(blob => {
      if (cancelled) return;
      nextUrl = URL.createObjectURL(blob);
      setPreviewUrl(nextUrl);
    }).catch(() => setPreviewUrl(null));
    return () => {
      cancelled = true;
      if (nextUrl) URL.revokeObjectURL(nextUrl);
    };
  }, [active?.id, active?.file, settings.text, settings.opacity, settings.size, settings.spacing, settings.rotation, settings.color]);
  const exportOne = async (item: WatermarkFile) => {
    if (!email) { setNotice("Please sign in from Account before watermarking. Your selected images will remain in this tab."); return; }
    if (planLoading) { setNotice("Checking your account plan. Please try again in a moment."); return; }
    if (isLocked) { setNotice("Daily limit reached. Your allowance resets in " + resetCountdown + "."); return; }
    if (!settings.text.trim()) { setNotice("Enter watermark text first."); return; }
    setBusy(true);
    try {
      const blob = await renderWatermark(item);
      await consumeImage();
      const url = URL.createObjectURL(blob);
      setFiles(previous => previous.map(file => file.id === item.id ? { ...file, output: blob, outputUrl: url } : file));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "watermarked-" + item.file.name;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setFiles(previous => previous.map(file => file.id === item.id ? { ...file, downloaded: true } : file));
      setNotice("Watermark applied and download started: " + item.file.name + ".");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not export this image."); }
    finally { setBusy(false); }
  };
  const downloadWatermark = (item: WatermarkFile) => {
    if (!item.output || !item.outputUrl || item.downloaded) return;
    const anchor = document.createElement("a");
    anchor.href = item.outputUrl;
    anchor.download = "watermarked-" + item.file.name;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setFiles(previous => previous.map(file => file.id === item.id ? { ...file, downloaded: true } : file));
    setNotice("Download started: " + item.file.name + ".");
  };
  const exportAll = async () => {
    if (!files.length || busy) return;
    if (!email) { setNotice("Please sign in from Account before watermarking. Your selected images will remain in this tab."); return; }
    if (planLoading) { setNotice("Checking your account plan. Please try again in a moment."); return; }
    if (isLocked) { setNotice("Daily limit reached. Your allowance resets in " + resetCountdown + "."); return; }
    if (!settings.text.trim()) { setNotice("Enter watermark text first."); return; }
    setBusy(true);
    setExportProgress({ done: 0, total: files.length, stage: "Applying watermark" });
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      let success = 0;
      let quotaReached = false;
      for (const item of files) {
        try {
          const output = await renderWatermark(item);
          await consumeImage();
          zip.file("watermarked-" + item.file.name, output);
          success++;
        } catch (error) {
          if (/daily limit reached/i.test(error instanceof Error ? error.message : "")) {
            quotaReached = true;
            setNotice("Daily limit reached. " + success + " image(s) are ready; remaining images are locked until " + resetCountdown + ".");
            break;
          }
          throw error;
        } finally {
          setExportProgress(previous => ({ ...previous, done: Math.min(files.length, previous.done + 1) }));
        }
      }
      if (!success) {
        if (quotaReached) return;
        throw new Error("No images could be exported.");
      }
      setExportProgress(previous => ({ ...previous, stage: "Building ZIP archive" }));
      const blob = await zip.generateAsync({ type: "blob" }, metadata => setExportProgress({ done: success, total: files.length, stage: "Building ZIP archive · " + Math.round(metadata.percent) + "%" }));
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = "cleanexif-watermarked-images.zip";
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url),30000);
      setNotice("ZIP download started. " + success + " watermarked image(s) included." + (quotaReached ? " Daily limit reached; remaining images are locked until reset." : ""));
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not export images."); }
    finally { setBusy(false); setExportProgress({ done: 0, total: 0, stage: "" }); }
  };
  return <div className="wm-page">
    <SiteHeader />
    <main className="container wm-main">
      <div className="wm-heading"><span className="eyebrow">FREE ONLINE WATERMARK MAKER</span><h1>Protect your photos.<br/><span>Your name, across every image.</span></h1><p>Add a repeating, diagonal copyright watermark across the full image. Preview the pattern and export privately in your browser.</p></div>
      <div className="wm-toolbar" aria-label="Watermark image controls">
        <button className="button button-outline wm-toolbar-add" onClick={()=>inputRef.current?.click()} disabled={busy || addingFiles}>
          <FilePlus2 size={17}/> {addingFiles ? "Adding images…" : "Add images"}
        </button>
        <div className={"wm-toolbar-quota" + (isLocked ? " is-locked" : "")} role="status" aria-live="polite">
          <b>{planLoading ? "Checking daily allowance…" : !email ? "Sign in required" : isLocked ? "Daily limit reached" : dailyUsage ? dailyUsage.remaining + " / " + dailyUsage.limit + " daily images left" : "Daily allowance unavailable"}</b>
          <span>{dailyUsage ? "Resets in " + resetCountdown : "Separate daily credits for this tool"}</span>
        </div>
        <button className="button button-outline wm-toolbar-clear" onClick={clearAllFiles} disabled={!files.length || busy || addingFiles} aria-label="Remove all selected images" title="Remove all selected images">
          <Trash2 size={18}/>
        </button>
      </div>
      <div className="wm-plan-banner"><div><b>{limits.name} plan · {dailyUsage ? dailyUsage.remaining + " / " + dailyUsage.limit + " daily images left" : email ? "Checking daily allowance…" : "Sign in to use daily credits"}</b><span>{files.length}/{limits.maxImages} images selected for this batch · {limits.totalMB} MB batch · {limits.maxFileMB} MB per file{email?" · "+email:""}</span><small>{dailyUsage ? (isLocked ? "Daily limit reached · Unlocks in " + resetCountdown : dailyUsage.used + " used today · Resets in " + resetCountdown) : "Watermark Maker has its own separate daily allowance."}</small></div><a className="button button-secondary" href="/plans">{isLocked ? "Daily limit reached · Upgrade" : files.length>=limits.maxImages || files.reduce((sum,file)=>sum+file.file.size,0)>=limits.totalMB*1024*1024 ? "Batch size reached" : isPaid?"View plan details":"View upgrade plans"} <ArrowRight size={14}/></a></div>
      <div className={"wm-editor" + (dragging ? " wm-drag-active" : "")}
        onDragEnter={event => { event.preventDefault(); setDragging(true); }}
        onDragOver={event => { event.preventDefault(); setDragging(true); }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={event => { event.preventDefault(); setDragging(false); void addFiles(event.dataTransfer.files); }}>
        {dragging && <div className="wm-drop-overlay" aria-live="polite"><UploadCloud size={34}/><b>Drop images to add them</b><span>JPEG, PNG or WebP · Up to 25 MB each</span></div>}
        <section className="wm-controls">
          <div className="wm-panel-title"><b>Watermark settings</b><span>LIVE EDITOR</span></div>
          <label className="watermark-field"><span>Watermark text</span><input value={settings.text} maxLength={80} placeholder="@YourName or © Your Brand" onChange={event => setSettings(value => ({...value,text:event.target.value}))}/></label>
          <label className="watermark-field"><span>Opacity <b>{settings.opacity}%</b></span><input type="range" min="8" max="70" value={settings.opacity} onChange={event => setSettings(value => ({...value,opacity:Number(event.target.value)}))}/></label>
          <label className="watermark-field"><span>Text size <b>{settings.size}</b></span><input type="range" min="16" max="60" value={settings.size} onChange={event => setSettings(value => ({...value,size:Number(event.target.value)}))}/></label>
          <label className="watermark-field"><span>Pattern spacing <b>{settings.spacing}</b></span><input type="range" min="90" max="300" value={settings.spacing} onChange={event => setSettings(value => ({...value,spacing:Number(event.target.value)}))}/></label>
          <label className="watermark-field"><span>Rotation <b>{settings.rotation}°</b></span><input type="range" min="-60" max="60" value={settings.rotation} onChange={event => setSettings(value => ({...value,rotation:Number(event.target.value)}))}/></label>
          <div className="watermark-field"><span>Watermark color</span><div className="watermark-colors"><button type="button" className={settings.color==="white"?"selected":""} onClick={()=>setSettings(value=>({...value,color:"white"}))}><i className="watermark-swatch swatch-white"/> White</button><button type="button" className={settings.color==="charcoal"?"selected":""} onClick={()=>setSettings(value=>({...value,color:"charcoal"}))}><i className="watermark-swatch swatch-charcoal"/> Dark Charcoal</button></div></div>
          <button className="button button-primary wm-upload" onClick={()=>inputRef.current?.click()} disabled={busy || addingFiles}><FilePlus2 size={17}/> {addingFiles ? "Adding images…" : "Choose images"}</button>
          {addingFiles && <div className="wm-progress" role="status" aria-live="polite"><span>Preparing images · {addProgress.done}/{addProgress.total}</span><div><i style={{width:(addProgress.total ? addProgress.done/addProgress.total*100 : 0)+"%"}}/></div></div>}
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={event=>{if(event.target.files)void addFiles(event.target.files);event.target.value="";}}/>
          <p className="watermark-hint">JPEG, PNG and WebP · Up to 25 MB per image · Processing stays on your device.</p>
        </section>
        <section className="wm-preview-panel">
          <div className="wm-panel-title"><b>Full-image preview</b><span>{active ? active.width+" × "+active.height : "UPLOAD AN IMAGE"}</span></div>
          <div className="wm-canvas-preview">{active ? <img src={previewUrl || active.url} alt="Live watermark preview"/> : <div className="wm-empty"><ImageIcon size={42}/><b>Your image preview will appear here</b><span>Choose one or more photos to start</span><button className="button button-primary" onClick={()=>inputRef.current?.click()}>Choose images</button></div>}</div>
          {files.length>0 && <div className="wm-file-list">{files.map(file=><button key={file.id} className={active?.id===file.id?"selected":""} onClick={()=>setActiveId(file.id)}><img src={file.url} alt=""/><span>{file.file.name}</span><small>{file.width} × {file.height}</small></button>)}</div>}
          {busy && <div className="wm-progress wm-export-progress" role="status" aria-live="polite"><span>{exportProgress.stage || "Preparing export"} · {exportProgress.done}/{exportProgress.total}</span><div><i style={{width:(exportProgress.total ? exportProgress.done/exportProgress.total*100 : 0)+"%"}}/></div></div>}
          {active && <div className="wm-export-actions"><span>{files.length} image{files.length===1?"":"s"} selected</span><button className="button button-outline" onClick={()=>void exportOne(active)} disabled={busy || planLoading || isLocked || !email}><ShieldCheck size={16}/> {active.output ? "Reapply watermark" : "Apply watermark"}</button>{active.output && <button className="button button-outline" onClick={()=>downloadWatermark(active)} disabled={busy || !!active.downloaded}><Download size={16}/> {active.downloaded ? "Downloaded" : "Download current"}</button>}<button className="button button-primary" onClick={()=>void exportAll()} disabled={busy || planLoading || isLocked || !email}>{busy?"Applying watermark…": "Watermark all & download ZIP"} <ArrowRight size={15}/></button></div>}
        </section>
      </div>
      {notice && <p className="wm-notice" role="status">{notice}</p>}
      <p className="wm-privacy"><ShieldCheck size={17}/> Images are processed locally in your browser. Watermarks are permanently drawn into exported pixels; keep your original photos unchanged.</p>
    </main><Footer/>
  </div>;
}

function App() {
  const { limits, email, loading: planLoading, dailyUsage, consumeImage, isLocked, resetCountdown } = usePlanAccess("metadata");
  const legalPath = window.location.pathname.replace(/^\/|\/$/g, "");
  if (legalPath === "admin") return <Suspense fallback={<div className="container" role="status">Loading admin…</div>}><AdminPage /></Suspense>;
  if (legalPath === "plans") return <Suspense fallback={<div className="container" role="status">Loading plans…</div>}><PlansPage /></Suspense>;
  if (["account","login","signup"].includes(legalPath)) return <Suspense fallback={<div className="container" role="status">Loading account…</div>}><AccountPage initialMode={legalPath === "login" ? "signin" : legalPath === "signup" ? "signup" : undefined} /></Suspense>;
  if (legalPath === "demo") return <DemoPage />;
  if (legalPath === "watermark") return <WatermarkPage />;
  if (legalPath === "gps-remover") return <Suspense fallback={<div className="container" role="status">Loading GPS remover…</div>}><PrivacyTools mode="gps" /></Suspense>;
  if (legalPath === "privacy-scanner") return <Suspense fallback={<div className="container" role="status">Loading privacy scanner…</div>}><PrivacyTools mode="scanner" /></Suspense>;
  if (legalPath === "metadata-editor") return <Suspense fallback={<div className="container" role="status">Loading EXIF editor…</div>}><PrivacyTools mode="editor" /></Suspense>;
  if (legalPath === "blog") return <BlogPage />;
  if (legalPath.startsWith("blog/")) return <BlogPage slug={legalPath.slice(5)} />;
  if (["privacy-policy", "terms", "disclaimer", "cookie-policy"].includes(legalPath)) return <LegalPage type={legalPath} />;
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<ImageRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [addingFiles, setAddingFiles] = useState(false);
  const [addProgress, setAddProgress] = useState({ done: 0, total: 0 });
  const [busy, setBusy] = useState(false);
  const [cleaningStage, setCleaningStage] = useState("");
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });
  const [notice, setNotice] = useState("");
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const active = items.find(item => item.id === activeId) ?? items[0] ?? null;
  const metadataCategories = useMemo(() => getMetaCategories(active?.metadata ?? null), [active]);
  const metadataRows = useMemo(() => metadataCategories.flatMap(group => group.rows), [metadataCategories]);
  const failedItems = useMemo(() => items.filter(item => !!item.cleanError && !item.cleaned), [items]);
  const noticeIsError = /unsupported format|larger than|plan allows|batch limit|could not read image|Could not clean|Batch download failed|No images could be cleaned|daily limit/i.test(notice);
  useEffect(() => {
    if (!notice || busy) return;
    const timeout = window.setTimeout(() => setNotice(""), 6000);
    return () => window.clearTimeout(timeout);
  }, [notice, busy]);
  const addFiles = useCallback(async (list: FileList | File[]) => {
    const incoming = Array.from(list);
    if (!incoming.length) return;
    setAddingFiles(true);
    setAddProgress({ done: 0, total: incoming.length });
    const valid: File[] = [];
    const errors: string[] = [];
    let totalSize = items.reduce((sum, item) => sum + item.file.size, 0);
    for (const file of incoming) {
      if (!ACCEPTED.includes(file.type)) { errors.push(file.name + ": unsupported format"); continue; }
      if (file.size > limits.maxFileMB * 1024 * 1024) { errors.push(file.name + ": larger than your " + limits.maxFileMB + " MB per-file limit"); continue; }
      const metadataSelectionLimit = Math.min(limits.dailyImages, limits.maxImages);
      if (items.length + valid.length >= metadataSelectionLimit) { errors.push("The Metadata Inspector allows up to " + metadataSelectionLimit + " images per batch on your current plan."); break; }
      if (totalSize + file.size > limits.totalMB * 1024 * 1024) { errors.push(file.name + ": your " + limits.name + " plan allows " + limits.totalMB + " MB total per batch"); continue; }
      valid.push(file);
      totalSize += file.size;
    }
    setAddProgress({ done: 0, total: valid.length });
    const records: ImageRecord[] = [];
    for (const file of valid) {
      const id = (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : String(Date.now()) + Math.random();
      let preview = "";
      let width = 0;
      let height = 0;
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        try {
          width = bitmap.width;
          height = bitmap.height;
          if (width * height > MAX_IMAGE_PIXELS) {
            errors.push(file.name + ": image exceeds the 40-megapixel browser processing limit");
          } else {
            preview = URL.createObjectURL(file);
          }
        } finally {
          bitmap.close();
        }
      } catch {
        errors.push(file.name + ": could not read image");
      }
      if (preview) {
        const metadata = await readMetadata(file);
        records.push({ id, file, preview, width, height, metadata, status: "ready" as const });
      }
      setAddProgress(previous => ({ ...previous, done: previous.done + 1 }));
    }
    const usable = records.filter(record => !!record.preview);
    setItems(previous => [...previous, ...usable]);
    if (!activeId && usable[0]) setActiveId(usable[0].id);
    setNotice(errors.length ? (usable.length ? usable.length + " image(s) added. " : "") + errors.slice(0, 3).join(" · ") + (errors.length > 3 ? " · +" + (errors.length - 3) + " more issue(s)" : "") : usable.length ? usable.length + " image" + (usable.length === 1 ? "" : "s") + " ready to inspect." : "No supported images were added.");
    setAddingFiles(false);
    setAddProgress({ done: 0, total: 0 });
  }, [items, activeId, limits, planLoading]);
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
    if (isLocked) { setNotice("Daily limit reached. Your allowance resets in " + resetCountdown + "."); return; }
    setBusy(true);
    setCleaningStage("Starting local processing");
    setItems(previous => previous.map(entry => entry.id === item.id ? { ...entry, status: "cleaning", cleanError: undefined } : entry));
    try {
      // Let React paint the processing state before CPU work begins.
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const blob = await cleanImage(item.file, setCleaningStage);
      setCleaningStage("Verifying exported image");
      const verification = await verifyMetadata(blob);
      await consumeImage();
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
    if (!item.cleanedUrl) window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    setItems(previous => previous.map(entry => entry.id === item.id ? { ...entry, downloaded: true } : entry));
    setNotice("Download started: " + item.file.name.replace(/\.[^.]+$/, "") + ". Check your browser downloads.");
  };
  const cleanAll = async (targetItems: ImageRecord[] = items) => {
    if (!targetItems.length || busy) return;
    if (!email) { setNotice("Please sign in from Account before cleaning images. Your selected images are still available in this tab."); return; }
    if (isLocked) { setNotice("Daily limit reached. Your allowance resets in " + resetCountdown + "."); return; }
    setBusy(true); setCleaningStage("Preparing batch"); setNotice("Cleaning images locally in your browser…");
    setBatchProgress({ done: 0, total: targetItems.length });
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    const usedZipNames = new Set<string>();
    let success = 0;
    let failed = 0;
    let quotaReached = false;
    let processed = 0;
    try {
      for (const item of targetItems) {
        try {
          setItems(previous => previous.map(entry => entry.id === item.id ? { ...entry, status: "cleaning" } : entry));
          if (item.cleaned) {
            zip.file(uniqueZipFilename(item.file.name, usedZipNames), item.cleaned);
            success++;
            continue;
          }
          const blob = await cleanImage(item.file, setCleaningStage);
          setCleaningStage("Verifying " + item.file.name);
          const verification = await verifyMetadata(blob);
          await consumeImage();
          const url = URL.createObjectURL(blob);
          zip.file(uniqueZipFilename(item.file.name, usedZipNames), blob);
          setItems(previous => previous.map(entry => entry.id === item.id ? { ...entry, cleaned: blob, cleanedUrl: url, status: "clean", cleanError: undefined, cleanCheck: verification.metadata, cleanCheckError: verification.error } : entry));
          success++;
        } catch (error) {
          failed++;
          const message = error instanceof Error ? error.message : "Could not clean image";
          setItems(previous => previous.map(entry => entry.id === item.id ? { ...entry, status: "ready", cleanError: message } : entry));
          if (/daily limit reached/i.test(message)) { quotaReached = true; setNotice(message); break; }
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
        window.setTimeout(() => URL.revokeObjectURL(url), 30000);
        setNotice("ZIP download started. " + success + " cleaned image" + (success === 1 ? "" : "s") + " added to the ZIP download" + (failed ? "; " + failed + " failed." : ".") + (quotaReached ? " Daily allowance reached; cleaning is locked until reset." : ""));
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
    ["Which image formats are supported?", "CleanExif supports JPEG, PNG and WebP. Your " + limits.name + " plan allows " + limits.maxFileMB + " MB per image, " + limits.maxImages + " images and " + limits.totalMB + " MB total per batch. HEIC, animated GIF and SVG are not supported."],
    ["Does removing EXIF data affect image quality?", "PNG is re-encoded losslessly. JPEG and WebP are exported at a high quality setting, but re-encoding can cause a small quality or file-size difference."],
    ["Can I clean multiple images at once?", "Yes. Add up to " + limits.maxImages + " supported images under your " + limits.name + " plan and use Clean all to download the cleaned files together in a ZIP archive."],
    ["What types of information can image metadata contain?", "Depending on the file and the device or app that created it, metadata may include capture date, camera make and model, lens and exposure settings, orientation, software details, author fields and GPS coordinates."],
    ["Will metadata removal change the visible photo?", "CleanExif creates a newly exported image from its pixels. PNG export is lossless; JPEG and WebP are re-encoded at a high quality setting, so a small change in file size or visual quality is possible."],
    ["Are screenshots free of metadata?", "Not necessarily. Screenshots often contain fewer camera-related fields than camera photos, but they can still include file properties or other embedded information. Inspect the exact file you plan to share."],
    ["Does CleanExif remove metadata from PDFs or videos?", "No. The current CleanExif image workflow supports JPEG, PNG and WebP only. PDF documents, videos, HEIC files, animated GIFs and SVG files are not supported."],
    ["Can metadata be added again after cleaning?", "Yes. Editing or exporting an image in another application may add new metadata. If privacy matters, inspect the final copy immediately before sharing it."],
  ];
  return <div className="app-shell">
    <SiteHeader />
    {notice && <div className={"toast-notice" + (noticeIsError ? " toast-error" : " toast-success")} role={noticeIsError ? "alert" : "status"} aria-live="assertive"><span className="toast-icon">{noticeIsError ? <AlertCircle size={19} /> : <CheckCircle2 size={19} />}</span><span className="toast-message">{notice}</span><button className="toast-close" type="button" aria-label="Dismiss notification" onClick={() => setNotice("")}><X size={17} /></button></div>}

    <main>
      <section className="hero-section"><div className="hero-glow hero-glow-one" /><div className="hero-glow hero-glow-two" />
        <div className="container hero-grid">
          <div className="hero-copy"><span className="eyebrow"><span className="eyebrow-icon"><ShieldCheck size={15} /></span> PHOTO PRIVACY, MADE SIMPLE</span>
            <h1>Share the photo.<br />Not the <span>metadata.</span></h1>
            <p className="hero-description">Photos can reveal more than you intend. Check for GPS location, camera details and hidden EXIF data, then download a cleaner copy. Everything is processed in your browser. No image uploads. Sign in only to use your daily cleaning credits.</p>
            <div className="trust-pills"><span><LockKeyhole size={15} /> No image uploads</span><span><ScanSearch size={16} /> Review before export</span><span><Monitor size={16} /> Processed locally</span></div>
            <div className="hero-footnote"><ShieldCheck size={15} /> Your original photo is never overwritten.</div>
          </div>
          <div className="hero-visual" id="tool">
            <div className="upload-card">
              <div className={"drop-zone" + (dragging ? " drop-active" : "")}
                onDragEnter={event => { event.preventDefault(); setDragging(true); }}
                onDragOver={event => { event.preventDefault(); setDragging(true); }}
                onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
                onDrop={event => { event.preventDefault(); setDragging(false); if (!busy && !addingFiles) void addFiles(event.dataTransfer.files); }}>
                <div className="upload-icon"><UploadCloud size={47} strokeWidth={1.7} /></div>
                <h2>{dragging ? "Drop to add your images" : "Drop your images here"}</h2><p>{dragging ? "Release to add supported photos" : "or click to choose files"}</p>
                <div className="upload-actions"><button className="button button-primary choose-button" onClick={() => inputRef.current?.click()}><FilePlus2 size={18} /> Choose images</button><a className="button button-demo" href="/demo"><Zap size={16} /> Try interactive demo</a></div>
                {addingFiles ? <div className="upload-progress" role="status" aria-live="polite"><span>Reading images… {addProgress.done} / {addProgress.total}</span><div><i style={{width: (addProgress.total ? addProgress.done / addProgress.total * 100 : 0) + "%"}}/></div></div> : <span className="format-note">JPG, JPEG, PNG or WebP · Up to {limits.maxFileMB} MB each · {Math.min(limits.maxImages, limits.dailyImages)} images / {limits.totalMB} MB per batch · {limits.name} plan</span>}
                <input ref={inputRef} type="file" multiple hidden disabled={busy || addingFiles} onChange={handleInput} />
              </div>
              <div className="upload-card-bottom"><span><LockKeyhole size={14} /> Processed locally</span><span><CheckCircle2 size={14} /> Account required for daily credits</span></div>\n              <div className={"daily-quota-card" + (isLocked ? " is-locked" : "")}><div><b>{dailyUsage ? limits.name + " daily allowance" : "Daily image allowance"}</b><strong>{dailyUsage ? dailyUsage.remaining + " / " + dailyUsage.limit + " images left" : email ? "Loading your allowance…" : "Sign in to view your allowance"}</strong></div><div className="daily-quota-track"><span style={{width:(dailyUsage ? Math.min(100,dailyUsage.used/Math.max(1,dailyUsage.limit)*100) : 0)+"%"}}/></div><small>{dailyUsage ? (isLocked ? "Limit reached · Unlocks in " + resetCountdown : dailyUsage.used + " used today · Resets in " + resetCountdown) : "Free 10 · Pro 50 · Business 200 images per day"}</small><a href="/plans">{isLocked ? "Upgrade your plan" : "View plans"}</a></div>
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
        <section className="container ce-trust-strip" aria-label="CleanExif privacy and processing commitments">
          <div className="ce-trust-intro">
            <span className="eyebrow">BUILT FOR PHOTO PRIVACY</span>
            <h2>Your files stay in your workflow.</h2>
            <p>Clear, practical privacy information before you clean or share an image.</p>
          </div>
          <div className="ce-trust-grid">
            <article className="ce-trust-item"><span><ShieldCheck size={18}/></span><div><b>Browser-based processing</b><small>Image work runs locally in your browser.</small></div></article>
            <article className="ce-trust-item"><span><UploadCloud size={18}/></span><div><b>No image upload required</b><small>Your selected image is processed on your device.</small></div></article>
            <article className="ce-trust-item"><span><ScanSearch size={18}/></span><div><b>Review before export</b><small>Inspect readable metadata before downloading.</small></div></article>
            <article className="ce-trust-item"><span><Download size={18}/></span><div><b>Separate clean copy</b><small>Your original file is not overwritten.</small></div></article>
          </div>
        </section>
      </section>

      {items.length > 0 && <section className="tool-workspace" aria-live="polite"><div className="container">
        <div className="workspace-heading"><div><span className="eyebrow">YOUR WORKSPACE</span><h2>Image metadata <span>inspector</span></h2><p>{items.length} of {Math.min(limits.maxImages, limits.dailyImages)} images selected · {limits.name} plan · {dailyUsage ? `${dailyUsage.used}/${dailyUsage.limit} daily images used · ${dailyUsage.remaining} remaining` : "Sign in to view daily credits"} · Files stay in this browser tab</p></div>
          <div className="workspace-actions"><button className="button button-outline" onClick={() => inputRef.current?.click()} disabled={busy || addingFiles}><FilePlus2 size={16} /> Add images</button>{failedItems.length > 0 && <button className="button button-outline" onClick={() => void cleanAll(failedItems)} disabled={busy}><RefreshCw size={15} /> Retry failed ({failedItems.length})</button>}<button className="button button-primary" onClick={() => void cleanAll()} disabled={busy || addingFiles || items.length === 0 || isLocked}><Download size={16} /> {busy ? "Cleaning…" : isLocked ? "Daily limit reached" : "Clean all & download ZIP"}</button><button className="icon-button" aria-label="Clear all images" onClick={clearAll} disabled={busy}><Trash2 size={17} /></button></div></div>
        {addingFiles && <div className="processing-panel batch-progress" role="status" aria-live="polite"><div className="processing-top"><UploadCloud size={15}/><b>Preparing selected images</b><span>{addProgress.done}/{addProgress.total}</span></div><div className="processing-track"><span style={{width:(addProgress.total ? addProgress.done/addProgress.total*100 : 0)+"%"}}/></div><p>Reading image dimensions and metadata locally in your browser.</p></div>}
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
            {active.status === "clean" ? <div className="clean-success"><CheckCircle2 size={17} /><span>{active.cleanCheckError ? "Copy ready · verification incomplete" : active.cleanCheck && Object.keys(active.cleanCheck).length ? "Copy ready · review remaining fields" : "Clean copy verified by readable metadata check"}</span><button className="button button-primary" onClick={() => downloadItem(active)} disabled={!!active.downloaded}><Download size={15} /> {active.downloaded ? "Downloaded" : "Download"}</button></div> :
              <button className="button button-primary clean-button" onClick={() => void cleanOne(active)} disabled={active.status === "cleaning" || busy || isLocked}>{active.status === "cleaning" ? <><RefreshCw className="spin" size={16} /> Processing image…</> : isLocked ? <><LockKeyhole size={17} /> Daily limit reached · {resetCountdown}</> : <><ShieldCheck size={17} /> Remove metadata</>}</button>}
            {active.status === "cleaning" && <div className="processing-panel" role="status" aria-live="polite"><div className="processing-top"><RefreshCw className="spin" size={15} /><b>{cleaningStage || "Processing locally"}</b><span>In progress</span></div><div className="processing-track"><span /></div><p>Decoding pixels, creating a fresh image and checking its metadata — all in your browser.</p></div>}
            {active.status === "clean" && <div className="comparison-panel"><div><span>Original privacy fields</span><b>{metadataRows.length}</b></div><div><span>Clean copy fields</span><b>{active.cleanCheckError ? "Not verified" : active.cleanCheck ? Object.keys(active.cleanCheck).length : 0}</b></div><div><span>File size</span><b>{formatBytes(active.file.size)} → {formatBytes(active.cleaned?.size ?? 0)}</b></div></div>}
            {active.status === "clean" && <p className={"verification-note" + (active.cleanCheckError || (active.cleanCheck && Object.keys(active.cleanCheck).length) ? " verification-warning" : "")}><ShieldCheck size={14} /> {active.cleanCheckError ? "The clean copy is ready, but automatic metadata verification was unavailable. Check the downloaded file with another metadata reader before sharing sensitive images." : active.cleanCheck && Object.keys(active.cleanCheck).length ? "Verification detected remaining readable fields: " + Object.keys(active.cleanCheck).slice(0, 6).join(", ") + ". Review the exported file before sharing." : "No readable metadata fields were detected in the exported copy. This check is not a forensic guarantee."}</p>}<p className="small-disclaimer">A fresh image copy is created. JPEG and WebP are re-encoded at high quality; a small quality or file-size difference may occur.</p>
          </div></div>}
        </div>
      </div></section>}

      <section className="metadata-education section-pad" aria-labelledby="metadata-guide-title">
        <div className="container">
          <div className="education-heading">
            <span className="eyebrow">UNDERSTAND YOUR IMAGE FILES</span>
            <h2 id="metadata-guide-title">A closer look at the information <span>inside your photos</span></h2>
            <p>An image can carry details beyond its visible pixels. Knowing what those details mean helps you make a more informed choice before sharing.</p>
          </div>
          <div className="education-feature-grid">
            <article className="education-card education-card-main">
              <span className="education-icon"><Fingerprint size={22} /></span>
              <h3>What is image metadata?</h3>
              <p>Metadata is information saved alongside an image. Some details are created by a camera or phone when a photo is captured; others can be added by editing software, an export process or a content workflow.</p>
              <p>It does not usually change what you see in the picture, but it can provide context about the device, time, settings or software involved in creating the file.</p>
            </article>
            <article className="education-card">
              <span className="education-icon"><MapPin size={22} /></span>
              <h3>Location information</h3>
              <p>When location tagging is enabled, GPS fields may record coordinates associated with a photo. Those coordinates can reveal more than the scene itself, so review them before publishing a personal image.</p>
            </article>
            <article className="education-card">
              <span className="education-icon"><Camera size={22} /></span>
              <h3>Camera and capture details</h3>
              <p>Files may include a camera or phone model, lens information, exposure values, orientation and capture date. These fields can be useful for photographers and cataloguing.</p>
            </article>
            <article className="education-card">
              <span className="education-icon"><Globe2 size={22} /></span>
              <h3>Editing and author details</h3>
              <p>Some workflows add software names, author information, captions, copyright notes or other descriptive fields. The exact fields depend on the application and export settings.</p>
            </article>
          </div>
          <div className="education-split">
            <div className="education-copy">
              <span className="eyebrow">WHY REVIEW METADATA?</span>
              <h3>Choose what your image shares</h3>
              <p>Metadata can make photo libraries easier to organize and help preserve creative or technical details. But when a file is shared publicly, some of that context may be unnecessary.</p>
              <p>Reviewing a photo before sharing lets you decide whether to keep its capture information or create a cleaner copy. CleanExif gives you a way to inspect readable fields and re-export supported images locally in your browser.</p>
            </div>
            <div className="education-callout">
              <ShieldCheck size={25} />
              <h3>Privacy-conscious by design</h3>
              <p>Your selected image is decoded and re-encoded in your browser. CleanExif does not upload image files to its image-processing servers.</p>
            </div>
          </div>
          <div className="format-guide">
            <div className="format-guide-heading">
              <span className="eyebrow">CURRENT FORMAT SUPPORT</span>
              <h3>Which image files can you clean?</h3>
              <p>CleanExif currently accepts these three image formats in its metadata workflow.</p>
            </div>
            <div className="format-guide-grid">
              <article><b>JPEG / JPG</b><p>Common camera and phone photos. Re-exported at a high quality setting; file size or visual quality may change slightly.</p><span>Supported</span></article>
              <article><b>PNG</b><p>Often used for screenshots, graphics and transparent images. Exported using lossless PNG encoding.</p><span>Supported</span></article>
              <article><b>WebP</b><p>A modern web image format. Re-exported at a high quality setting, which may affect file size or image quality slightly.</p><span>Supported</span></article>
            </div>
            <p className="format-limit-note">HEIC, animated GIF, SVG, PDF and video files are not supported by this image-cleaning workflow.</p>
          </div>
          <div className="education-split education-process">
            <div className="education-copy">
              <span className="eyebrow">A SIMPLE WORKFLOW</span>
              <h3>How to prepare an image before sharing</h3>
              <ol className="education-steps">
                <li><b>Select the exact image</b><span>Choose the original file you intend to share.</span></li>
                <li><b>Inspect its details</b><span>Review readable GPS, camera, date and other metadata fields.</span></li>
                <li><b>Create a clean copy</b><span>Use the metadata removal action to export a new image in your browser.</span></li>
                <li><b>Check before publishing</b><span>Review the downloaded copy and share that version if it meets your needs.</span></li>
              </ol>
            </div>
            <div className="education-callout education-caution">
              <AlertCircle size={24} />
              <h3>Know the limits</h3>
              <p>Re-encoding is designed to omit common embedded image metadata, but it is not a forensic sanitization guarantee. Keep your original file and independently inspect outputs when handling highly sensitive images.</p>
            </div>
          </div>
          <div className="usecase-strip">
            <div><b>Personal photo sharing</b><span>Review location and capture details before posting family or everyday photos.</span></div>
            <div><b>Creator workflows</b><span>Prepare exported images for portfolios, blogs and social content.</span></div>
            <div><b>Business publishing</b><span>Check product and campaign images before adding them to public pages.</span></div>
          </div>
        </div>
      </section>

      <section className="tool-directory-section section-pad" id="all-tools"><div className="container"><div className="tool-directory-heading"><span className="eyebrow">ONE PRIVACY WORKSPACE</span><h2>All CleanExif <span>tools</span></h2><p>Choose the exact tool you need. Each tool has its own page, clear processing status and separate download action.</p></div><div className="tool-directory-grid">
<a className="tool-directory-card" href="/#tool"><span className="tool-directory-icon"><Eye/></span><b>Image Metadata Cleaner</b><small>Inspect and remove common embedded metadata from supported images.</small><span className="tool-directory-link">Open cleaner <ArrowRight size={15}/></span></a>
<a className="tool-directory-card" href="/watermark"><span className="tool-directory-icon"><ImageIcon/></span><b>Watermark Maker</b><small>Add a repeating visible text watermark and export your image.</small><span className="tool-directory-link">Open watermark <ArrowRight size={15}/></span></a>
<a className="tool-directory-card" href="/gps-remover"><span className="tool-directory-icon"><MapPin/></span><b>GPS Location Remover</b><small>Review location tags and export a re-encoded copy without common metadata.</small><span className="tool-directory-link">Open GPS remover <ArrowRight size={15}/></span></a>
<a className="tool-directory-card" href="/privacy-scanner"><span className="tool-directory-icon"><ScanSearch/></span><b>Image Privacy Scanner</b><small>Review readable location, device, identity and capture metadata.</small><span className="tool-directory-link">Scan an image <ArrowRight size={15}/></span></a>
<a className="tool-directory-card" href="/metadata-editor"><span className="tool-directory-icon"><Fingerprint/></span><b>EXIF Metadata Editor</b><small>Edit common description, author, copyright and date fields in JPEG files.</small><span className="tool-directory-link">Open EXIF editor <ArrowRight size={15}/></span></a>
</div></div></section>

      <section className="how-section section-pad" id="how-it-works"><div className="container how-grid"><div className="how-left"><span className="eyebrow">SIMPLE BY DESIGN</span><h2>How <span>CleanExif</span> works</h2><p>Clean your photos and remove supported metadata locally in your browser.</p>
        <div className="steps-grid"><div className="step-card"><span className="step-number">01</span><UploadCloud /><b>Select images</b><small>Choose photos from your device.</small></div><ArrowRight className="step-arrow" /><div className="step-card"><span className="step-number">02</span><Eye /><b>Inspect & clean</b><small>View metadata and remove it locally.</small></div><ArrowRight className="step-arrow" /><div className="step-card"><span className="step-number">03</span><Download /><b>Download</b><small>Save your cleaned images.</small></div></div>
      </div><div className="privacy-card" id="privacy"><div className="privacy-heading"><span className="privacy-large-icon"><ShieldCheck size={30} /></span><div><h2>Your privacy comes first</h2><p>CleanExif is designed to keep image processing on your device.</p></div></div>
        <div className="privacy-points"><span><Check /> No image uploads</span><span><Check /> Account-based daily limits</span><span><Check /> No image storage</span><span><Check /> No ad or analytics trackers</span><span><Check /> Works on desktop & mobile</span><span><Check /> No processing API</span></div>
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