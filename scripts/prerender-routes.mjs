import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const SITE_URL = "https://cleanexif.vercel.app";
export const routeMetadata = [
  { path: "plans", title: "CleanExif Pricing | Free, Pro and Business Plans", description: "Compare CleanExif Free, Pro and Business plans, including daily image credits, batch sizes and file limits." },
  { path: "watermark", title: "Free Online Image Watermark Maker | CleanExif", description: "Add repeating text watermarks to supported images in your browser. Keep your original photo unchanged." },
  { path: "gps-remover", title: "Remove GPS Location from Photos Online | CleanExif", description: "Inspect and remove common GPS and EXIF metadata from JPEG, PNG and WebP images locally in your browser." },
  { path: "privacy-scanner", title: "Image Privacy Scanner | Inspect EXIF and GPS Metadata | CleanExif", description: "Scan supported images for readable GPS, camera, author and capture details before sharing." },
  { path: "metadata-editor", title: "EXIF Metadata Editor for JPEG Images | CleanExif", description: "Edit supported JPEG description, author, copyright and capture-time fields and export a separate copy." },
  { path: "blog", title: "Photo Privacy and EXIF Metadata Guides | CleanExif Blog", description: "Read practical guides about EXIF data, photo metadata, GPS location privacy and safer image sharing." },
  { path: "blog/inspect-photo-metadata-online", title: "How to Inspect Photo Metadata Online | CleanExif", description: "Learn how to inspect readable EXIF, GPS, camera, date and image details in your browser before sharing photos." },
  { path: "blog/remove-exif-data-from-jpg-png-webp", title: "How to Remove EXIF Data from JPG, PNG and WebP | CleanExif", description: "Understand how to create a fresh image copy with common embedded metadata removed from supported formats." },
  { path: "blog/remove-gps-location-from-photos", title: "How to Remove GPS Location from Photos | CleanExif", description: "Learn where GPS location tags appear in photos and how to create a cleaner copy before sharing." },
  { path: "blog/add-watermark-to-photos-online", title: "How to Add a Watermark to Photos Online | CleanExif", description: "Follow a practical guide to adding repeating text watermarks to images in your browser." },
  { path: "blog/cleanexif-image-privacy-workflow", title: "A Simple Photo Privacy Workflow | CleanExif", description: "Follow an inspect, clean, verify and download workflow for safer image sharing with CleanExif." },
  { path: "privacy-policy", title: "Privacy Policy | CleanExif", description: "Read how CleanExif processes images locally and how website requests, account information and advertising resources are handled." },
  { path: "terms", title: "Terms of Service | CleanExif", description: "Review the terms, responsibilities and service limitations that apply when using CleanExif." },
  { path: "disclaimer", title: "Disclaimer | CleanExif", description: "Understand CleanExif metadata-removal limitations and why sensitive files should be independently verified." },
  { path: "cookie-policy", title: "Cookie Policy and Advertising Choices | CleanExif", description: "Learn how browser storage, Google AdSense advertising technologies and third-party resources may be used on CleanExif." },
  { path: "demo", title: "Interactive Photo Privacy Demo | CleanExif", description: "Explore a synthetic demonstration of how photo metadata can be inspected and removed.", noindex: true },
  { path: "account", title: "Your CleanExif Account", description: "Sign in to manage your CleanExif account, plan access and profile settings.", noindex: true },
  { path: "login", title: "Sign In to CleanExif", description: "Sign in to your CleanExif account.", noindex: true },
  { path: "signup", title: "Create a CleanExif Account", description: "Create a CleanExif account to manage your plan and daily image credits.", noindex: true },
  { path: "admin", title: "CleanExif Admin", description: "Private CleanExif administration area.", noindex: true },
];

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function upsertMeta(html, attribute, key, value) {
  const expression = new RegExp("<meta\\s+" + attribute + "=\"" + key + "\"[^>]*>", "i");
  const element = '<meta ' + attribute + '="' + key + '" content="' + escapeHtml(value) + '" />';
  if (expression.test(html)) return html.replace(expression, element);
  return html.replace("</head>", "  " + element + "\n</head>");
}
export function renderRouteHtml(template, route, siteUrl = SITE_URL) {
  const canonical = siteUrl + "/" + route.path;
  const robots = route.noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large";
  let html = template;
  const titleTag = "<title>" + escapeHtml(route.title) + "</title>";
  const titleStart = html.indexOf("<title>");
  const titleEnd = html.indexOf("</title>", titleStart);
  if (titleStart >= 0 && titleEnd >= 0) {
    html = html.slice(0, titleStart) + titleTag + html.slice(titleEnd + 8);
  } else {
    html = html.replace("</head>", "  " + titleTag + "\n</head>");
  }
  else html = html.replace("</head>", "  " + titleTag + "\n</head>");
  html = upsertMeta(html, "name", "description", route.description);
  html = upsertMeta(html, "name", "robots", robots);
  html = upsertMeta(html, "property", "og:type", route.path.startsWith("blog/") ? "article" : "website");
  html = upsertMeta(html, "property", "og:site_name", "CleanExif");
  html = upsertMeta(html, "property", "og:title", route.title);
  html = upsertMeta(html, "property", "og:description", route.description);
  html = upsertMeta(html, "property", "og:url", canonical);
  html = upsertMeta(html, "name", "twitter:title", route.title);
  html = upsertMeta(html, "name", "twitter:description", route.description);
  const canonicalTag = '<link rel="canonical" href="' + escapeHtml(canonical) + '" />';
  const canonicalStart = html.indexOf('<link rel="canonical"');
  const canonicalEnd = canonicalStart >= 0 ? html.indexOf(">", canonicalStart) : -1;
  if (canonicalStart >= 0 && canonicalEnd >= 0) {
    html = html.slice(0, canonicalStart) + canonicalTag + html.slice(canonicalEnd + 1);
  } else {
    html = html.replace("</head>", "  " + canonicalTag + "\n</head>");
  }
  else html = html.replace("</head>", "  " + canonicalTag + "\n</head>");
  return html;
}
export async function prerenderRoutes(outDir = path.resolve("dist")) {
  const template = await readFile(path.join(outDir, "index.html"), "utf8");
  for (const route of routeMetadata) {
    const targetDir = path.join(outDir, route.path);
    await mkdir(targetDir, { recursive: true });
    await writeFile(path.join(targetDir, "index.html"), renderRouteHtml(template, route), "utf8");
  }
  return routeMetadata.length;
}
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  const count = await prerenderRoutes();
  console.log("Generated route-specific HTML metadata for " + count + " CleanExif routes.");
}
