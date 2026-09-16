function solve(a, target) {
  let left = 0, right = a.length;
  while (left < right) {
    const middle = Math.floor((left + right) / 2);
    if (a[middle] < target) left = middle + 1;
    else right = middle;
  }
  return left;
}
