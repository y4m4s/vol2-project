def solve(graph, start, target):
    queue = [(start, 0)]
    seen = {start}
    head = 0
    while head < len(queue):
        vertex, distance = queue[head]
        head += 1
        if vertex == target:
            return distance
        for nxt in graph[vertex]:
            if nxt not in seen:
                seen.add(nxt)
                queue.append((nxt, distance + 1))
    return -1
