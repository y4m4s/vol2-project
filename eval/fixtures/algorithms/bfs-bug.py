def solve(graph, start, target):
    queue = [(start, 0)]
    seen = {start}
    while queue:
        vertex, distance = queue.pop()
        if vertex == target:
            return distance
        for nxt in graph[vertex]:
            if nxt not in seen:
                seen.add(nxt)
                queue.append((nxt, distance + 1))
    return -1
