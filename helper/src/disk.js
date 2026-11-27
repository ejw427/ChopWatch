import fs from "node:fs";
import path from "node:path";
import { paths, exists, blockedFiles } from "./saladPaths.js";

function dirSizeBytes(root, depth = 0, maxDepth = 2) {
  if (!exists(root) || depth > maxDepth) return 0;
  let total = 0;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const ent of entries) {
    if (blockedFiles.has(ent.name)) continue;
    const full = path.join(root, ent.name);
    try {
      if (ent.isDirectory()) {
        total += dirSizeBytes(full, depth + 1, maxDepth);
      } else if (ent.isFile()) {
        total += fs.statSync(full).size;
      }
    } catch {
      // skip locked / permissioned entries
    }
  }
  return total;
}

function listChildSizes(root) {
  if (!exists(root)) return [];
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => !blockedFiles.has(e.name))
    .map((e) => {
      const full = path.join(root, e.name);
      let sizeBytes = 0;
      try {
        if (e.isDirectory()) sizeBytes = dirSizeBytes(full, 0, 3);
        else sizeBytes = fs.statSync(full).size;
      } catch {
        sizeBytes = 0;
      }
      return {
        name: e.name,
        kind: e.isDirectory() ? "dir" : "file",
        sizeBytes,
      };
    })
    .sort((a, b) => b.sizeBytes - a.sizeBytes);
}

export function readDiskSnapshot() {
  const workloadPackages = exists(paths.workloads)
    ? fs
        .readdirSync(paths.workloads, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .filter((n) => n !== "_downloads")
    : [];

  return {
    programDataRoot: paths.programDataRoot,
    present: exists(paths.programDataRoot),
    children: listChildSizes(paths.programDataRoot),
    workloadPackageNames: workloadPackages,
    note: "Package folder names only. No container image or job payload inspection.",
  };
}
