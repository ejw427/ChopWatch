import { buildSnapshot } from "./snapshot.js";

const snap = await buildSnapshot();
process.stdout.write(JSON.stringify(snap, null, 2) + "\n");
