export function formatConnectionState(state: string): string {
  switch (state) {
    case "connected":
      return "接続済み";
    case "connecting":
      return "接続中...";
    case "consent_pending":
      return "同意待ち";
    case "restricted":
      return "制限中";
    case "unavailable":
      return "利用不可";
    default:
      return "未接続";
  }
}
