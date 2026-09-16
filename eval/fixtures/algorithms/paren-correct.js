function solve(text) {
  let balance = 0;
  for (const ch of text) {
    balance += ch === '(' ? 1 : -1;
    if (balance < 0) return false;
  }
  return balance === 0;
}
