export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }

  if (tokens >= 10_000) {
    return `${Math.round(tokens / 1000)}K`;
  }

  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  }

  return `${tokens}`;
}

export function formatCostUsd(cost: number): string {
  if (cost > 0 && cost < 0.001) {
    return "$0.001未満";
  }

  return `$${cost.toFixed(3)}`;
}
