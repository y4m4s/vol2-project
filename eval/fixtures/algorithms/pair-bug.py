def solve(a, target):
    left, right = 0, len(a) - 1
    while left < right:
        value = a[left] + a[right]
        if value == target:
            return True
        if value < target:
            right -= 1
        else:
            left += 1
    return False
