function solve(a, target) {
  let count = 0;
  for (let i = 0; i < a.length; i++)
    for (let j = i + 1; j < a.length; j++)
      if (a[i] + a[j] === target) count++;
  return count;
}
