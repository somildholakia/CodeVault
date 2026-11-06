# CodeVault product website

Public website: https://codevault-site.vercel.app

A standalone, framework-free product and download website for CodeVault.

## Preview locally

Open \`public/index.html\` directly, or serve the \`public/\` folder with any static HTTP server.

For example:

\`\`\`bash
npx serve public
\`\`\`

## Deploy on Vercel

Create a separate Vercel project connected to \`somildholakia/CodeVault\` with:

- Root directory: \`website\`
- Framework preset: Other
- Build command: none
- Output directory: \`public\`
- Install command: none

The site is static HTML, CSS and JavaScript. It has no runtime dependencies, API, database or environment variables.

## Downloads

The page links to the current \`feat/global-issue-tracker\` GitHub ZIP and tar.gz source archives. It clearly distinguishes source code downloads from desktop installers; no desktop installer has been published.

## Checks

Run from the repository root:

\`\`\`bash
node --test website/test/site.test.js
\`\`\`
