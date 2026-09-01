import * as path from "path";
import type { GuidanceContext, RequestPlanSnapshot } from "../shared/types";

export interface WorkspaceRootPath {
  name: string;
  fsPath: string;
}

export interface ExternalGuidanceRequest {
  context: GuidanceContext;
  requestPlan: RequestPlanSnapshot;
}

export function createExternalGuidanceRequest(
  context: GuidanceContext,
  requestPlan: RequestPlanSnapshot,
  roots: readonly WorkspaceRootPath[]
): ExternalGuidanceRequest {
  return {
    context: {
      ...context,
      activeFilePath: toWorkspaceDisplayPath(context.activeFilePath, roots),
      workspaceTree: context.workspaceTree
        ? {
            ...context.workspaceTree,
            rootPath: roots.length > 0
              ? roots.map((root) => root.name).join("; ")
              : path.basename(context.workspaceTree.rootPath)
          }
        : undefined,
      referencedFiles: context.referencedFiles.map((file) => ({
        ...file,
        path: toWorkspaceDisplayPath(file.path, roots) ?? path.basename(file.path)
      }))
    },
    requestPlan: {
      ...requestPlan,
      targetFiles: requestPlan.targetFiles.map((file) => ({
        ...file,
        path: toWorkspaceDisplayPath(file.path, roots) ?? path.basename(file.path)
      }))
    }
  };
}

export function toWorkspaceDisplayPath(
  filePath: string | undefined,
  roots: readonly WorkspaceRootPath[]
): string | undefined {
  if (!filePath) {
    return undefined;
  }

  const normalizedInput = filePath.replaceAll("\\", "/");
  if (!path.isAbsolute(filePath)) {
    return normalizedInput.replace(/^\.\//, "");
  }

  const matchingRoot = [...roots]
    .filter((root) => isInsideRoot(filePath, root.fsPath))
    .sort((left, right) => right.fsPath.length - left.fsPath.length)[0];
  if (!matchingRoot) {
    return path.basename(filePath);
  }

  const relativePath = path.relative(matchingRoot.fsPath, filePath).replaceAll("\\", "/");
  return roots.length > 1 ? `${matchingRoot.name}/${relativePath}` : relativePath;
}

export function resolveWorkspaceDisplayPath(
  displayPath: string,
  roots: readonly WorkspaceRootPath[]
): string | undefined {
  const normalized = displayPath.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized) {
    return undefined;
  }

  if (path.isAbsolute(displayPath)) {
    const absolutePath = path.resolve(displayPath);
    return roots.some((root) => isInsideRoot(absolutePath, root.fsPath)) ? absolutePath : undefined;
  }

  if (normalized.split("/").includes("..")) {
    return undefined;
  }

  const candidates = roots.length > 1
    ? roots.flatMap((root) => {
        const prefix = `${root.name}/`;
        return normalized.startsWith(prefix)
          ? [path.resolve(root.fsPath, normalized.slice(prefix.length))]
          : [];
      })
    : roots.map((root) => path.resolve(root.fsPath, normalized));

  return candidates.find((candidate) => roots.some((root) => isInsideRoot(candidate, root.fsPath)));
}

function isInsideRoot(candidatePath: string, rootPath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
