def solve(a):
    best = current = a[0]
    for value in a[1:]:
        current = max(value, current + value)
        best = max(best, current)
    return best
