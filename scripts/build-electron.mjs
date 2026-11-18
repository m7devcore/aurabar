import * as esbuild from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

mkdirSync('dist-electron', { recursive: true });
cpSync('electron/native', 'dist-electron/native', { recursive: true });

await esbuild.build({
  entryPoints: ['electron/main.ts', 'electron/preload.ts'],
  outdir: 'dist-electron',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron'],
  outExtension: { '.js': '.cjs' },
  sourcemap: true
});

console.log('Built electron main, preload, and native helper.');
