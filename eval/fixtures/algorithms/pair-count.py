def solve(a, target):
    count = 0
    for i in range(len(a)):
        for j in range(i + 1, len(a)):
            if a[i] + a[j] == target:
                count += 1
    return count
