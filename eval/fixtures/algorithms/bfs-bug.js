function solve(graph, start, target) {
  const queue = [[start, 0]], seen = new Set([start]);
  while (queue.length) {
    const [vertex, distance] = queue.pop();
    if (vertex === target) return distance;
    for (const next of graph[vertex]) if (!seen.has(next)) {
      seen.add(next);
      queue.push([next, distance + 1]);
    }
  }
  return -1;
}
