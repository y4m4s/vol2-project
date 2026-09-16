function solve(text) {
  const counts = {};
  for (const ch of text) counts[ch] = 1;
  return counts;
}
