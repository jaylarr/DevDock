import { verify } from './verify.mjs';
import { record } from './record.mjs';
import { processRecordings } from './process.mjs';
import { render } from './render.mjs';
import { qa } from './qa.mjs';
import { npm } from './common.mjs';
import { audio } from './audio.mjs';

await verify();
await npm(['run', 'build']);
await record();
await processRecordings();
await audio();
await render();
await qa();
