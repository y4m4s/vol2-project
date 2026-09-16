def solve(text):
    balance = 0
    for ch in text:
        balance += 1 if ch == '(' else -1
    return balance == 0
