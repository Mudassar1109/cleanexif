import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("public pages no longer load AdSense or render sponsor placements", () => {
  const html = read("../index.html");
  const app = read("../src/App.tsx");
  const admin = read("../src/AdminPage.tsx");
  assert.doesNotMatch(html, /adsbygoogle|google-adsense-account|pagead2\.googlesyndication/);
  assert.doesNotMatch(app, /SponsorAd|sponsor-ad|Google AdSense|adsbygoogle/);
  assert.doesNotMatch(admin, /SponsorAdsManager|cleanexif_sponsor_ads|Advertisements/);
  assert.equal(existsSync(new URL("../src/SponsorAd.tsx", import.meta.url)), false);
});

test("privacy and cookie policies no longer describe advertising that is not enabled", () => {
  const app = read("../src/App.tsx");
  assert.doesNotMatch(app, /AdSense|advertising partners|personalized advertising|adssettings\.google/);
  assert.match(app, /does not currently display advertisements or use analytics trackers/);
});

test("homepage omits duplicate trust and long education sections", () => {
  const app = read("../src/App.tsx");
  assert.doesNotMatch(app, /ce-trust-strip|metadata-education/);
  const faq = app.match(/const faqs = \[([\s\S]*?)\n  \];/);
  assert.ok(faq, "FAQ list should exist");
  assert.equal((faq[1].match(/^\s*\[/gm) ?? []).length, 6);
});

test("mobile rules cover tool directory, pricing, account and admin layouts", () => {
  const responsive = read("../src/responsive.css");
  const plans = read("../src/plans.css");
  const account = read("../src/account.css");
  const admin = read("../src/admin.css");
  assert.match(responsive, /@media \(max-width: 780px\)/);
  assert.match(responsive, /\.tool-directory-grid\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(responsive, /\.admin-table-scroll\s*\{[\s\S]*?overflow-x: auto/);
  assert.match(responsive, /\.wm-editor/);
  assert.match(responsive, /\.privacy-tool-switch/);
  assert.match(responsive, /\.blog-content/);
  assert.match(plans, /@media \(max-width: 650px\)/);
  assert.match(plans, /\.plans-grid\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(account, /@media\(max-width:700px\)/);
  assert.match(admin, /@media \(max-width: 760px\)/);
});
