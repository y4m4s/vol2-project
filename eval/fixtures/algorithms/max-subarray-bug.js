function solve(a) {
  let best = 0, current = 0;
  for (const value of a) {
    current = Math.max(0, current + value);
    best = Math.max(best, current);
  }
  return best;
}
