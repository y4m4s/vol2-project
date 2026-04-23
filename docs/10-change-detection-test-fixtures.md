# 10. 変更検知テスト用コード

常時モードの「変更前コード / 変更後コード」を見た自動フィードバックを試すためのコピペ用サンプル集。

## 使い方

1. 適当な TypeScript ファイルを 1 つ開く
2. まず `変更前コード` を貼る
3. 少し待ってから `変更後コード` に丸ごと置き換える
4. 常時モードの自動アドバイスで、差分に応じた指摘が出るかを見る

最初の確認は `Case 1` がおすすめ。
TypeScript の diagnostics も出やすく、差分も分かりやすい。

---

## Case 1: null 安全性を壊す変更

### 変更前コード

```ts
type User = {
  id: string;
  profile?: {
    displayName?: string;
  };
};

export function getDisplayName(user: User): string {
  return user.profile?.displayName?.trim() || "Anonymous";
}

export function formatGreeting(user: User): string {
  return `Hello, ${getDisplayName(user)}!`;
}
```

### 変更後コード

```ts
type User = {
  id: string;
  profile?: {
    displayName?: string;
  };
};

export function getDisplayName(user: User): string {
  return user.profile.displayName.trim();
}

export function formatGreeting(user: User): string {
  return `Hello, ${getDisplayName(user)}!`;
}
```

### 期待される反応

- `profile` や `displayName` が `undefined` の可能性
- optional chaining を外したことで壊れやすくなったこと
- TypeScript diagnostics にも反応すること

---

## Case 2: fetch のエラーハンドリングを削る変更

### 変更前コード

```ts
type Todo = {
  id: number;
  title: string;
  completed: boolean;
};

export async function loadTodos(apiBaseUrl: string): Promise<Todo[]> {
  const response = await fetch(`${apiBaseUrl}/todos`);

  if (!response.ok) {
    throw new Error(`Failed to load todos: ${response.status}`);
  }

  return (await response.json()) as Todo[];
}
```

### 変更後コード

```ts
type Todo = {
  id: number;
  title: string;
  completed: boolean;
};

export async function loadTodos(apiBaseUrl: string): Promise<Todo[]> {
  const response = await fetch(`${apiBaseUrl}/todos`);
  return response.json();
}
```

### 期待される反応

- `response.ok` の確認が消えていること
- 失敗時の扱いが雑になったこと
- `json()` の戻り値をそのまま返していて型安全性が弱くなったこと

---

## Case 3: イベントリスナーの cleanup を消す変更

### 変更前コード

```ts
export function registerResizeLogger(): () => void {
  const onResize = () => {
    console.log(`window size: ${window.innerWidth} x ${window.innerHeight}`);
  };

  window.addEventListener("resize", onResize);

  return () => {
    window.removeEventListener("resize", onResize);
  };
}
```

### 変更後コード

```ts
export function registerResizeLogger(): void {
  const onResize = () => {
    console.log(`window size: ${window.innerWidth} x ${window.innerHeight}`);
  };

  window.addEventListener("resize", onResize);
}
```

### 期待される反応

- cleanup がなくなりリスナーリークの可能性があること
- 何度も登録されたときの重複実行
- ライフサイクルに応じた解除が必要なこと

---

## Case 4: 配列を破壊的変更に変えてしまう変更

### 変更前コード

```ts
export function addTag(tags: string[], nextTag: string): string[] {
  const normalized = nextTag.trim();

  if (normalized.length === 0) {
    return tags;
  }

  return [...new Set([...tags, normalized])];
}
```

### 変更後コード

```ts
export function addTag(tags: string[], nextTag: string): string[] {
  tags.push(nextTag);
  return tags;
}
```

### 期待される反応

- 引数配列を破壊的に変更していること
- trim と空文字チェックが消えていること
- 重複排除がなくなっていること

---

## Case 5: 早期 return を消して例外を呼び込む変更

### 変更前コード

```ts
type Task = {
  id: string;
  title: string;
};

export function findTaskTitle(tasks: Task[], id: string): string {
  const task = tasks.find((item) => item.id === id);

  if (!task) {
    return "Not found";
  }

  return task.title;
}
```

### 変更後コード

```ts
type Task = {
  id: string;
  title: string;
};

export function findTaskTitle(tasks: Task[], id: string): string {
  const task = tasks.find((item) => item.id === id);
  return task.title;
}
```

### 期待される反応

- `task` が見つからない場合の考慮がなくなったこと
- 実行時例外の可能性
- TypeScript diagnostics にも反応すること

