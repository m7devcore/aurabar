import { spawn } from 'node:child_process';
import http from 'node:http';
import * as esbuild from 'esbuild';
import { mkdirSync } from 'node:fs';

mkdirSync('dist-electron', { recursive: true });

async function buildElectron() {
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
}

function waitForVite(url, timeoutMs = 20000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error('Timed out waiting for Vite dev server'));
        } else {
          setTimeout(check, 250);
        }
      });
    };
    check();
  });
}

await buildElectron();

const isWin = process.platform === 'win32';
const vite = spawn(isWin ? 'npx.cmd' : 'npx', ['vite', '--port', '5178'], {
  stdio: 'inherit',
  shell: isWin
});

await waitForVite('http://localhost:5178');

const devEnv = {
  ...process.env,
  AURABAR_DEV_URL: 'http://localhost:5178'
};
delete devEnv.ELECTRON_RUN_AS_NODE;

const electronProc = spawn(isWin ? 'npx.cmd' : 'npx', ['electron', '.'], {
  stdio: 'inherit',
  shell: isWin,
  env: devEnv
});

electronProc.on('close', (code) => {
  vite.kill();
  process.exit(code ?? 0);
});

process.on('SIGINT', () => {
  electronProc.kill();
  vite.kill();
  process.exit(0);
});
