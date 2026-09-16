def solve(a):
    best = current = 0
    for value in a:
        current = max(0, current + value)
        best = max(best, current)
    return best
