import { spawn } from 'node:child_process';
import electronPath from 'electron';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(String(electronPath), ['.'], {
  stdio: 'inherit',
  env
});

child.on('close', (code) => {
  process.exit(code ?? 0);
});
