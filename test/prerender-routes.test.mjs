import test from "node:test";
import assert from "node:assert/strict";
import { renderRouteHtml, routeMetadata, SITE_URL } from "../scripts/prerender-routes.mjs";
const template = '<!doctype html><html><head>' +
  '<title>CleanExif Home</title>' +
  '<meta name="description" content="Homepage description" />' +
  '<meta name="robots" content="index, follow" />' +
  '<meta property="og:title" content="CleanExif Home" />' +
  '<meta property="og:description" content="Homepage description" />' +
  '<meta property="og:url" content="' + SITE_URL + '/" />' +
  '<meta name="twitter:title" content="CleanExif Home" />' +
  '<meta name="twitter:description" content="Homepage description" />' +
  '<link rel="canonical" href="' + SITE_URL + '/" />' +
  '</head><body></body></html>';
test("public plans route gets its own title, description and canonical", () => {
  const route = routeMetadata.find((item) => item.path === "plans");
  const html = renderRouteHtml(template, route);
  assert.ok(html.includes("<title>CleanExif Pricing | Free, Pro and Business Plans</title>"));
  assert.ok(html.includes('rel="canonical" href="' + SITE_URL + '/plans"'));
  assert.ok(html.includes('content="index, follow, max-image-preview:large"'));
  assert.ok(html.includes("Compare CleanExif Free, Pro and Business plans"));
});
test("private admin route is explicitly noindex", () => {
  const route = routeMetadata.find((item) => item.path === "admin");
  const html = renderRouteHtml(template, route);
  assert.ok(html.includes("<title>CleanExif Admin</title>"));
  assert.ok(html.includes('name="robots" content="noindex, nofollow"'));
  assert.ok(html.includes('rel="canonical" href="' + SITE_URL + '/admin"'));
});
test("blog articles receive article Open Graph metadata", () => {
  const route = routeMetadata.find((item) => item.path === "blog/inspect-photo-metadata-online");
  const html = renderRouteHtml(template, route);
  assert.ok(html.includes('property="og:type" content="article"'));
  assert.ok(html.includes("How to Inspect Photo Metadata Online"));
});
