function solve(n) {
  const ways = Array(n + 2).fill(0);
  ways[0] = 1;
  ways[1] = 1;
  for (let i = 2; i <= n; i++) ways[i] = ways[i - 1] + ways[i - 2];
  return ways[n];
}
