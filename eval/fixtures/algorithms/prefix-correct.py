def solve(a, left, right):
    prefix = [0]
    for value in a:
        prefix.append(prefix[-1] + value)
    return prefix[right + 1] - prefix[left]
