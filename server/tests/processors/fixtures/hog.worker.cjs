// Parser stand-in that keeps allocating until the heap cap ends it.
const retained = [];
for (;;) retained.push(new Array(1e5).fill({ x: retained.length }));
