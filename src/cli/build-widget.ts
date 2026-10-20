// npm run build:widget → widget/dist/widget.js (el archivo que se sirve a las webs).

import { mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

import { construirWidget } from '../dev/widget-build.js';

const js = await construirWidget({ minify: true });
mkdirSync('widget/dist', { recursive: true });
writeFileSync('widget/dist/widget.js', js);
const kb = (n: number) => (n / 1024).toFixed(1).replace('.', ',');
console.log(`widget/dist/widget.js · ${kb(Buffer.byteLength(js))} KB (${kb(gzipSync(js).byteLength)} KB comprimido)`);
