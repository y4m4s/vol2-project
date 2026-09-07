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
 *
 * 以前は既存ファイルを読み直して `.bak` へ書き写していたため、1 回の保存で
 * 「本体サイズの読み込み 1 回 + 書き込み 2 回」が発生していた。現在は既存ファイルを
 * rename で `.bak` へ退避するだけなので、書き込みは新しい内容の 1 回で済む。
 *
 * クラッシュ耐性は変わらない。一時ファイルは 2 つの rename より前に書き終えており、
 * rename の合間に落ちた場合は本体が欠けた状態になるが、openDatabaseWithBackup が
 * `.bak` から復旧する。
 */
export async function writeFileAtomically(uri: vscode.Uri, bytes: Uint8Array): Promise<void> {
  const temporaryUri = uri.with({ path: `${uri.path}.${process.pid}.${Date.now()}.tmp` });
  const backupUri = uri.with({ path: `${uri.path}.bak` });

  try {
    await vscode.workspace.fs.writeFile(temporaryUri, bytes);
    await renameIfExists(uri, backupUri);
    await vscode.workspace.fs.rename(temporaryUri, uri, { overwrite: true });
  } catch (error) {
    await deleteIfExists(temporaryUri);
    throw error;
  }
}

async function renameIfExists(source: vscode.Uri, destination: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.fs.rename(source, destination, { overwrite: true });
  } catch (error) {
    if (!isFileNotFound(error)) {
      throw error;
    }
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
