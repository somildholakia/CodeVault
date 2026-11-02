import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
const js = await readFile(new URL("../public/main.js", import.meta.url), "utf8");

test("product site has accessible document metadata and a descriptive hero", () => {
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /<title>CodeVault — Git, in good company\.<\/title>/);
  assert.match(html, /<h1>Good code\.<br><em>Clear history\.<\/em><br>Better together/);
  assert.match(html, /class="skip-link"/);
});

test("site explains the real product workflows without inventing product claims", () => {
  for (const phrase of ["COMMIT DAG", "GLOBAL ISSUES", "BRANCH PROTECTION", "OSV", "line-level blame", "real Git"]) {
    assert.ok(html.toLowerCase().includes(phrase.toLowerCase()), "missing product detail: " + phrase);
  }
  assert.match(html, /Exact versions\. Clear findings\./);
  assert.match(html, /Unsupported ranges are never presented as a clean scan/);
});

test("download links point to the existing public feature branch and releases page", () => {
  assert.match(html, /archive\/refs\/heads\/feat\/global-issue-tracker\.zip/);
  assert.match(html, /archive\/refs\/heads\/feat\/global-issue-tracker\.tar\.gz/);
  assert.match(html, /github\.com\/somildholakia\/CodeVault\/releases/);
  assert.match(html, /not a Windows, macOS or Linux desktop installer/);
  assert.match(html, /Packaged desktop builds have not been published/);
});

test("local setup instructions match the repository's documented requirements", () => {
  assert.match(html, /Node\.js 20\.11\+/);
  assert.match(html, /Git 2\.30\+/);
  assert.match(html, /MongoDB/);
  assert.match(html, /npm install/);
  assert.match(html, /npm run dev/);
  assert.match(html, /cp \.env\.example \.env/);
});

test("small-screen layout and reduced-motion preferences are included", () => {
  assert.match(css, /@media\(max-width:540px\)/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css, /:focus-visible/);
  assert.match(js, /aria-expanded/);
  assert.match(js, /Escape/);
});

test("site uses local scripts and styles rather than an embedded third-party runtime", () => {
  assert.match(html, /src="\.\/main\.js" defer/);
  assert.match(html, /href="\.\/styles\.css"/);
  assert.doesNotMatch(html, /<script[^>]+src="https?:\/\//);
  assert.match(js, /navigator\.clipboard/);
});

test("external new-tab links include safe rel attributes", () => {
  const links = html.match(/<a\b[^>]*target="_blank"[^>]*>/g) || [];
  assert.ok(links.length > 0);
  for (const link of links) assert.match(link, /rel="noreferrer"/);
});
