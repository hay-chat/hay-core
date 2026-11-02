// Parser stand-in that never finishes; counts iterations in shared memory.
const { workerData } = require("node:worker_threads");
const counter = new Int32Array(workerData.counter);
for (;;) Atomics.add(counter, 0, 1);
