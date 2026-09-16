function solve(a, left, right) {
  const prefix = [0];
  for (const value of a) prefix.push(prefix[prefix.length - 1] + value);
  return prefix[right] - prefix[left];
}
