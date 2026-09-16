function solve(a, target) {
  let left = 0, right = a.length - 1;
  while (left < right) {
    const value = a[left] + a[right];
    if (value === target) return true;
    if (value < target) right--;
    else left++;
  }
  return false;
}
