def solve(a, target):
    left, right = 0, len(a)
    while left < right:
        middle = (left + right) // 2
        if a[middle] < target:
            left = middle + 1
        else:
            right = middle
    return left
