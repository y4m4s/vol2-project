import * as vscode from "vscode";

export function isFileNotFound(error: unknown): boolean {
  return error instanceof vscode.FileSystemError && error.code === "FileNotFound";
}

export async function readFileIfExists(uri: vscode.Uri): Promise<Uint8Array | undefined> {
  try {
    return await vscode.workspace.fs.readFile(uri);
  } catch (error) {
    if (isFileNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

export async function openDatabaseWithBackup<T>(
  uri: vscode.Uri,
  Database: new (data?: Uint8Array) => T
): Promise<T> {
  const backupUri = uri.with({ path: `${uri.path}.bak` });
  const primary = await readFileIfExists(uri);
  if (!primary) {
    const backup = await readFileIfExists(backupUri);
    if (backup) {
      console.warn(`Restoring missing database from ${backupUri.toString()}.`);
      return new Database(backup);
    }
    return new Database();
  }

  try {
    return new Database(primary);
  } catch (primaryError) {
    const backup = await readFileIfExists(backupUri);
    if (!backup) throw primaryError;
    console.warn(`Restoring unreadable database from ${backupUri.toString()}.`, primaryError);
    return new Database(backup);
  }
}

/**
 * Writes beside the destination and atomically replaces it. The immediately
 * preceding valid file is retained as `<name>.bak` for crash recovery.
 */
export async function writeFileAtomically(uri: vscode.Uri, bytes: Uint8Array): Promise<void> {
  const temporaryUri = uri.with({ path: `${uri.path}.${process.pid}.${Date.now()}.tmp` });
  const backupUri = uri.with({ path: `${uri.path}.bak` });
  const backupTemporaryUri = uri.with({ path: `${uri.path}.bak.tmp` });

  try {
    await vscode.workspace.fs.writeFile(temporaryUri, bytes);

    const existing = await readFileIfExists(uri);
    if (existing) {
      await vscode.workspace.fs.writeFile(backupTemporaryUri, existing);
      await vscode.workspace.fs.rename(backupTemporaryUri, backupUri, { overwrite: true });
    }

    await vscode.workspace.fs.rename(temporaryUri, uri, { overwrite: true });
  } catch (error) {
    await deleteIfExists(temporaryUri);
    await deleteIfExists(backupTemporaryUri);
    throw error;
  }
}

async function deleteIfExists(uri: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.fs.delete(uri);
  } catch (error) {
    if (!isFileNotFound(error)) {
      console.warn(`Failed to remove temporary file ${uri.toString()}`, error);
    }
  }
}
