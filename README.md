# CleanExif

Privacy-first image metadata inspector and remover.

## Stack
- React + TypeScript + Vite
- Tailwind CSS v4 (Vite plugin) with custom responsive styles
- exifr for reading supported metadata
- Canvas API for local image re-encoding
- JSZip for batch downloads

## Run locally
\`\`\`bash
npm install
npm run dev
\`\`\`

## Production build
\`\`\`bash
npm run build
npm run preview
\`\`\`

## Privacy model
Selected image files are read and re-encoded in the user's browser. There is no image upload endpoint, backend, database, authentication, analytics SDK or advertising SDK in this repository. Standard hosting/network logs may still contain request metadata such as IP address.

## Supported input
JPEG, PNG and WebP; maximum 25 MB per image; maximum 20 images per batch. HEIC/HEIF, animated GIF and SVG are not supported in this release.

## Metadata handling and limitations
The cleaner draws the decoded image to a browser canvas and exports a fresh image blob. This removes metadata carried in the original file container in common browser export paths. It is not a forensic sanitization guarantee for every proprietary or non-standard metadata structure. JPEG and WebP are re-encoded at quality 0.94 and may have small quality/file-size changes. PNG is exported as PNG. Users should verify output before sharing sensitive material.

## Deployment
Import this repository into Vercel and use the Vite preset. Build command: \`npm run build\`; output directory: \`dist\`. No environment variables are required. Add \`cleanexif.online\` in Vercel Domains after deployment and configure the DNS records shown by Vercel.

## Before public launch
- Test representative JPEG, PNG (including transparency), and WebP files across current Chrome, Firefox, Safari and mobile browsers.
- Confirm EXIF/GPS removal with an independent metadata inspector.
- Review legal copy and hosting provider logging/privacy disclosures.
- Verify sitemap, canonical URL, robots.txt, metadata and HTTPS on the production domain.
