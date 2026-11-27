# CleanExif

Privacy-conscious image metadata inspector, cleaner and watermark tool.

## Stack

- React 18 + TypeScript + Vite
- Tailwind CSS v4
- Supabase Auth and Postgres RPCs for accounts, plan access, usage quotas and admin-managed data
- `exifr` for reading supported image metadata
- Browser Canvas API for local image re-encoding
- `jszip` for batch downloads
- Google AdSense script is included in the site shell

## Run locally

```bash
npm install
npm run dev
```

## Environment variables

The application expects these Vite variables for Supabase-backed account and plan features:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Use the existing CleanExif Supabase project values from the approved deployment environment. Do not commit secrets or service-role keys. The publishable/anon key is intended for browser use and must be protected by correct database grants and Row Level Security.

## Production build

```bash
npm run build
npm run preview
```

## Privacy and processing model

Selected image files are decoded, inspected, re-encoded and verified in the user's browser. The image-processing workflow does not intentionally upload selected photo files to CleanExif application servers. This does not mean the website has no backend: Supabase is used for authentication and account/plan/usage functionality. The site also loads third-party resources, including Google Fonts and the Google AdSense script. Hosting, network and third-party providers may process connection or browser information under their own policies.

Avoid describing the entire website as tracker-free or backend-free. Any public privacy statement should accurately disclose the active third-party scripts and account services.

## Supported image workflow

The current metadata workflow accepts JPEG, PNG and WebP. The UI and plan-access code apply per-file, batch and daily usage limits; check the current application and active plan configuration rather than relying on hard-coded limits in this document. HEIC/HEIF, animated GIF and SVG are not supported by the metadata cleaning workflow.

## Metadata handling and limitations

The cleaner draws the decoded image to a browser canvas and exports a fresh image blob. This is designed to omit common embedded metadata in supported browser export paths. It is not a forensic sanitization guarantee for every proprietary or non-standard metadata structure. JPEG and WebP are re-encoded at a quality setting of 0.94 and may have small quality or file-size changes. PNG is exported as PNG. Users should verify output before sharing sensitive material.

## Deployment

The project is configured for Vercel with the Vite preset. Build command: `npm run build`; output directory: `dist`. Configure the two Supabase environment variables for the correct existing CleanExif project in the relevant Vercel environments. Never replace the project URL or credentials without verifying the target project and its existing user data.

## Audit notes

- Keep the sitemap blog URLs synchronized with the actual `blogArticles` slugs in `src/App.tsx`.
- Verify Supabase migrations, RLS policies, grants, RPCs and triggers against the live project before changing database schema.
- Test representative JPEG, PNG (including transparency) and WebP files across current desktop and mobile browsers.
- Confirm metadata removal with an independent metadata inspector.
- Review legal copy and third-party provider disclosures before public launch.
