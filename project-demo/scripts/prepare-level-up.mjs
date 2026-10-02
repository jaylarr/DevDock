import { record } from './record.mjs';
import { processRecordings } from './process.mjs';
import { audio } from './audio.mjs';
await record();
await processRecordings();
await audio();
