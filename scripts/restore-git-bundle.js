#!/usr/bin/env node
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 120000;
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;

function usage() {
  return [
    "CodeVault Git bundle restore",
    "",
    "Usage:",
    "  npm run restore:bundle -- --bundle <file.bundle> --target <new-bare-repo> [--default-branch main]",
    "",
    "Options:",
    "  --bundle          Downloaded CodeVault .bundle file (required)",
    "  --target          New directory for the restored bare repository (must not exist)",
    "  --default-branch  Branch to set as the restored repository HEAD (default: main)",
    "  --help            Show this help",
    "",
    "This restores Git objects, branches and tags only. CodeVault account and collaboration metadata are stored separately."
  ].join("\n");
}

function parseArguments(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") return {help: true};
    if (!["--bundle", "--target", "--default-branch"].includes(argument)) {
      throw new Error("Unknown argument: " + argument + "\n\n" + usage());
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error("Missing value for " + argument + "\n\n" + usage());
    }
    if (values[argument]) throw new Error("Duplicate argument: " + argument);
    values[argument] = value;
    index += 1;
  }

  if (!values["--bundle"] || !values["--target"]) {
    throw new Error("Both --bundle and --target are required.\n\n" + usage());
  }

  return {
    bundlePath: values["--bundle"],
    targetPath: values["--target"],
    defaultBranch: values["--default-branch"] || "main"
  };
}

function safeError(error) {
  return String(error?.stderr || error?.message || error || "Git operation failed.")
    .trim()
    .slice(0, 1200);
}

async function git(args, cwd) {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER_BYTES,
      windowsHide: true,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_CONFIG_NOSYSTEM: "1"
      }
    });
    return {
      stdout: String(result.stdout || ""),
      stderr: String(result.stderr || "")
    };
  } catch (error) {
    throw new Error("git " + args[0] + " failed: " + safeError(error), {cause: error});
  }
}

function parseBundleRefs(output) {
  const refs = [];
  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    const match = line.match(/^([a-f0-9]{40})\s+(.+)$/i);
    if (!match) throw new Error("The bundle contains an invalid ref listing.");
    const [, sha, ref] = match;
    if (ref === "HEAD") continue;
    if (!ref.startsWith("refs/heads/") && !ref.startsWith("refs/tags/")) {
      throw new Error("The bundle contains an unsupported ref namespace: " + ref);
    }
    refs.push({sha, ref});
  }
  if (!refs.some(item => item.ref.startsWith("refs/heads/"))) {
    throw new Error("The bundle does not contain any branches.");
  }
  const names = refs.map(item => item.ref);
  if (new Set(names).size !== names.length) throw new Error("The bundle contains duplicate refs.");
  return refs;
}

export async function restoreGitBundle(options = {}) {
  const bundlePath = path.resolve(String(options.bundlePath || ""));
  const targetPath = path.resolve(String(options.targetPath || ""));
  const defaultBranch = String(options.defaultBranch || "main");

  if (!options.bundlePath || !options.targetPath) {
    throw new TypeError("Bundle and target paths are required.");
  }
  if (!path.basename(targetPath) || targetPath === path.parse(targetPath).root) {
    throw new Error("Choose a new repository directory, not a filesystem root.");
  }

  const bundleStat = await fs.lstat(bundlePath);
  if (!bundleStat.isFile()) throw new Error("The bundle path must be a regular file, not a directory or symbolic link.");
  const maxMbValue = Number(process.env.MAX_REPOSITORY_RESTORE_SIZE_MB || 2048);
  const maxMb = Number.isInteger(maxMbValue) && maxMbValue >= 1 && maxMbValue <= 10240
    ? maxMbValue
    : 2048;
  const maxBytes = maxMb * 1024 * 1024;
  if (bundleStat.size < 1 || bundleStat.size > maxBytes) {
    throw new Error("The bundle must be between 1 byte and " + maxMb + " MiB.");
  }

  const parentPath = path.dirname(targetPath);
  const parentStat = await fs.stat(parentPath);
  if (!parentStat.isDirectory()) throw new Error("The target parent path must be an existing directory.");

  await git(["check-ref-format", "--branch", defaultBranch]);
  const listing = await git(["bundle", "list-heads", bundlePath]);
  const refs = parseBundleRefs(listing.stdout);
  const defaultRef = "refs/heads/" + defaultBranch;
  if (!refs.some(item => item.ref === defaultRef)) {
    throw new Error("The requested default branch is not included in this bundle: " + defaultBranch);
  }

  let targetCreated = false;
  try {
    // mkdir is exclusive. It prevents accidental overwrite of an existing repository.
    await fs.mkdir(targetPath, {recursive: false, mode: 0o750});
    targetCreated = true;

    await git(["init", "--bare", "--quiet", "--initial-branch=" + defaultBranch, targetPath]);
    await git(["bundle", "verify", bundlePath], targetPath);
    await git(["bundle", "unbundle", bundlePath], targetPath);

    for (const item of refs) {
      await git(["cat-file", "-e", item.sha + "^{object}"], targetPath);
      await git(["update-ref", item.ref, item.sha], targetPath);
    }

    await git(["symbolic-ref", "HEAD", defaultRef], targetPath);
    const restoredListing = await git(["for-each-ref", "--format=%(refname)"], targetPath);
    const restoredNames = restoredListing.stdout.split(/\r?\n/).filter(Boolean).sort();
    const expectedNames = refs.map(item => item.ref).sort();
    if (JSON.stringify(restoredNames) !== JSON.stringify(expectedNames)) {
      throw new Error("The restored branch/tag refs do not match the bundle manifest.");
    }

    await git(["fsck", "--connectivity-only", "--no-reflogs"], targetPath);
    return {
      targetPath,
      defaultBranch,
      branchCount: refs.filter(item => item.ref.startsWith("refs/heads/")).length,
      tagCount: refs.filter(item => item.ref.startsWith("refs/tags/")).length,
      refs
    };
  } catch (error) {
    if (targetCreated) await fs.rm(targetPath, {recursive: true, force: true}).catch(() => {});
    throw error;
  }
}

const isMain = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(usage() + "\n");
    } else {
      const result = await restoreGitBundle(options);
      process.stdout.write([
        "Repository restored successfully.",
        "Bare repository: " + result.targetPath,
        "Default branch: " + result.defaultBranch,
        "Branches: " + result.branchCount,
        "Tags: " + result.tagCount,
        "",
        "Create a working copy with:",
        "  git clone " + JSON.stringify(result.targetPath) + " working-copy",
        ""
      ].join("\n"));
    }
  } catch (error) {
    process.stderr.write("Restore failed: " + safeError(error) + "\n");
    process.exitCode = 1;
  }
}
