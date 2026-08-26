import assert from "node:assert/strict";
import test from "node:test";
import type * as vscode from "vscode";
import { OrcaRouterCredentialStore } from "../src/services/OrcaRouterCredentialStore";

function createSecretStorage(initialValue?: string): { storage: vscode.SecretStorage; values: Map<string, string> } {
  const values = new Map<string, string>();
  if (initialValue) values.set("aiPairNavigator.orcaRouter.apiKey", initialValue);
  return {
    values,
    storage: {
      get: async (key: string) => values.get(key),
      store: async (key: string, value: string) => { values.set(key, value); },
      delete: async (key: string) => { values.delete(key); }
    } as unknown as vscode.SecretStorage
  };
}

test("SecretStorageの既存キーを設定済みとして初期化する", async () => {
  const { storage } = createSecretStorage("sk-orca-existing");
  const credentials = new OrcaRouterCredentialStore(storage);
  await credentials.initialize();
  assert.equal(credentials.isConfigured(), true);
  assert.equal(await credentials.getApiKey(), "sk-orca-existing");
});

test("APIキーを正規化して保存し削除できる", async () => {
  const { storage, values } = createSecretStorage();
  const credentials = new OrcaRouterCredentialStore(storage);
  await credentials.storeApiKey("  sk-orca-secret  ");
  assert.equal([...values.values()][0], "sk-orca-secret");
  assert.equal(credentials.isConfigured(), true);

  await credentials.storeApiKey("sk-orca-replacement");
  assert.equal(await credentials.getApiKey(), "sk-orca-replacement");
  assert.equal([...values.values()].includes("sk-orca-secret"), false);

  await credentials.deleteApiKey();
  assert.equal(values.size, 0);
  assert.equal(credentials.isConfigured(), false);
});

test("OrcaRouter形式でないキーをSecretStorageへ保存しない", async () => {
  const { storage, values } = createSecretStorage();
  const credentials = new OrcaRouterCredentialStore(storage);
  await assert.rejects(() => credentials.storeApiKey("invalid-key"));
  assert.equal(values.size, 0);
});
