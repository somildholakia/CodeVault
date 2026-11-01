import {listFiles,readFile} from "./git.js";
import {AppError} from "../utils/errors.js";

const MAX_PACKAGES = 500;
const MAX_DETAILS = 80;

export function extractNpmPackages(lock) {
  if (!lock || typeof lock !== "object") return [];
  const found = new Map();
  const add = (name, info, source) => {
    if (!name || !info || typeof info.version !== "string" || !info.version) return;
    const key = name + "@" + info.version;
    const current = found.get(key);
    if (current) {
      current.manifests.push(source);
      current.development = current.development && Boolean(info.dev);
      return;
    }
    found.set(key, {
      name,
      version: info.version,
      development: Boolean(info.dev),
      optional: Boolean(info.optional),
      manifests: [source]
    });
  };
  if (lock.packages && typeof lock.packages === "object") {
    for (const [entry, info] of Object.entries(lock.packages)) {
      const marker = "node_modules/";
      const index = entry.lastIndexOf(marker);
      if (index < 0) continue;
      const name = info?.name || entry.slice(index + marker.length);
      add(name, info, entry);
    }
  } else if (lock.dependencies && typeof lock.dependencies === "object") {
    const visit = (dependencies, parent = "") => {
      for (const [name, info] of Object.entries(dependencies)) {
        add(name, info, parent ? parent + " > " + name : name);
        if (info?.dependencies) visit(info.dependencies, parent ? parent + " > " + name : name);
      }
    };
    visit(lock.dependencies);
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

async function inventoryManifests(id, ref, paths) {
  const manifests = paths.filter(file => file.path.endsWith("package.json")).slice(0, 50);
  const dependencies = [];
  let manifestCount = 0;
  for (const file of manifests) {
    try {
      const parsed = JSON.parse((await readFile(id, ref, file.path)).content);
      manifestCount++;
      for (const [scope, items] of Object.entries({
        runtime: parsed.dependencies || {},
        development: parsed.devDependencies || {},
        optional: parsed.optionalDependencies || {}
      })) {
        for (const [name, requested] of Object.entries(items)) {
          if (typeof requested !== "string") continue;
          dependencies.push({name, requested, scope, manifest: file.path});
        }
      }
    } catch (error) {
      if (error.code === "FILE_TOO_LARGE") continue;
      if (error instanceof SyntaxError) continue;
      throw error;
    }
  }
  return {manifestCount, dependencies: dependencies.slice(0, MAX_PACKAGES), truncated: dependencies.length > MAX_PACKAGES};
}

function severityOf(vulnerability) {
  const raw = String(vulnerability?.database_specific?.severity || vulnerability?.severityLabel || "").toLowerCase();
  if (raw.includes("critical")) return "critical";
  if (raw.includes("high")) return "high";
  if (raw.includes("moderate") || raw.includes("medium")) return "medium";
  if (raw.includes("low")) return "low";
  return "unrated";
}

function fixedVersionsOf(vulnerability, packageName) {
  const versions = new Set();
  for (const affected of vulnerability?.affected || []) {
    if (affected.package?.name && affected.package.name !== packageName) continue;
    for (const range of affected.ranges || []) {
      for (const event of range.events || []) if (event.fixed) versions.add(event.fixed);
    }
  }
  return [...versions].slice(0, 10);
}

async function queryOsv(packages) {
  const queries = packages.map(item => ({package: {name: item.name, ecosystem: "npm"}, version: item.version}));
  const response = await fetch("https://api.osv.dev/v1/querybatch", {
    method: "POST",
    headers: {"content-type": "application/json", "accept": "application/json"},
    body: JSON.stringify({queries}),
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new AppError(503, "VULNERABILITY_SERVICE_UNAVAILABLE", "The OSV vulnerability service could not complete the scan. Retry later.");
  const payload = await response.json();
  if (!Array.isArray(payload.results) || payload.results.length !== queries.length) {
    throw new AppError(503, "VULNERABILITY_SERVICE_INVALID_RESPONSE", "The vulnerability service returned an incomplete result.");
  }
  const matches = new Map();
  payload.results.forEach((result, index) => {
    for (const vulnerability of result.vulns || []) {
      const id = vulnerability.id;
      if (!id) continue;
      const entries = matches.get(id) || [];
      entries.push(packages[index]);
      matches.set(id, entries);
    }
  });
  const ids = [...matches.keys()].slice(0, MAX_DETAILS);
  const details = new Map();
  for (let offset = 0; offset < ids.length; offset += 8) {
    const batch = await Promise.all(ids.slice(offset, offset + 8).map(async id => {
      const detailResponse = await fetch("https://api.osv.dev/v1/vulns/" + encodeURIComponent(id), {
        headers: {"accept": "application/json"},
        signal: AbortSignal.timeout(12000)
      });
      if (!detailResponse.ok) return [id, {id}];
      return [id, await detailResponse.json()];
    }));
    for (const [id, detail] of batch) details.set(id, detail);
  }
  const findings = [];
  for (const id of ids) {
    const detail = details.get(id) || {id};
    const affectedPackages = matches.get(id) || [];
    for (const pkg of affectedPackages) {
      findings.push({
        id,
        package: pkg.name,
        version: pkg.version,
        severity: severityOf(detail),
        summary: String(detail.summary || detail.details || "No summary provided by OSV.").slice(0, 700),
        published: detail.published || null,
        modified: detail.modified || null,
        fixedVersions: fixedVersionsOf(detail, pkg.name),
        url: "https://osv.dev/vulnerability/" + encodeURIComponent(id)
      });
    }
  }
  return {findings, vulnerabilityCount: matches.size, detailsTruncated: matches.size > MAX_DETAILS};
}

export async function scanDependencies(id, ref = "main") {
  const paths = await listFiles(id, ref);
  const lockFiles = paths.filter(file =>
    file.path === "package-lock.json" || file.path === "npm-shrinkwrap.json" ||
    /\/package-lock\.json$/.test(file.path) || /\/npm-shrinkwrap\.json$/.test(file.path)
  ).sort((a, b) => a.path.split("/").length - b.path.split("/").length);
  if (!lockFiles.length) {
    const inventory = await inventoryManifests(id, ref, paths);
    return {
      status: inventory.manifestCount ? "lockfile_required" : "no_npm_manifest",
      ref,
      lockfiles: [],
      manifestCount: inventory.manifestCount,
      packageCount: inventory.dependencies.length,
      dependencies: inventory.dependencies,
      findings: [],
      summary: {critical: 0, high: 0, medium: 0, low: 0, unrated: 0},
      truncated: inventory.truncated,
      scannedAt: new Date().toISOString()
    };
  }
  const packages = new Map();
  const scannedLockfiles = [];
  for (const lockFile of lockFiles.slice(0, 10)) {
    let lock;
    try { lock = JSON.parse((await readFile(id, ref, lockFile.path)).content); }
    catch (error) {
      if (error instanceof SyntaxError) throw new AppError(400, "INVALID_NPM_LOCKFILE", "The committed npm lockfile is not valid JSON.", {path: lockFile.path});
      if (error.code === "FILE_TOO_LARGE") throw new AppError(413, "NPM_LOCKFILE_TOO_LARGE", "An npm lockfile exceeds the 1 MiB scan limit.", {path: lockFile.path});
      throw error;
    }
    const entries = extractNpmPackages(lock);
    if (!entries.length) throw new AppError(400, "UNSUPPORTED_NPM_LOCKFILE", "The npm lockfile contains no resolved package versions.", {path: lockFile.path});
    scannedLockfiles.push(lockFile.path);
    for (const item of entries) packages.set(item.name + "@" + item.version, item);
  }
  const allPackages = [...packages.values()];
  const scannedPackages = allPackages.slice(0, MAX_PACKAGES);
  const {findings, vulnerabilityCount, detailsTruncated} = await queryOsv(scannedPackages);
  const summary = {critical: 0, high: 0, medium: 0, low: 0, unrated: 0};
  for (const finding of findings) summary[finding.severity]++;
  return {
    status: "scanned",
    ref,
    lockfiles: scannedLockfiles,
    manifestCount: paths.filter(file => file.path.endsWith("package.json")).length,
    packageCount: allPackages.length,
    scannedPackageCount: scannedPackages.length,
    vulnerabilityCount,
    findings: findings.sort((a, b) => ["critical","high","medium","low","unrated"].indexOf(a.severity) - ["critical","high","medium","low","unrated"].indexOf(b.severity)),
    summary,
    truncated: allPackages.length > MAX_PACKAGES || detailsTruncated,
    scannedAt: new Date().toISOString()
  };
}
