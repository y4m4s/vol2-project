function solve(a) {
  let best = a[0], current = a[0];
  for (const value of a.slice(1)) {
    current = Math.max(value, current + value);
    best = Math.max(best, current);
  }
  return best;
}
