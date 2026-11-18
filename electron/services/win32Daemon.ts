import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import path from 'node:path';

interface PendingItem {
  resolve: (value: string) => void;
}

class Win32Daemon {
  private proc: ChildProcessByStdio<Writable, Readable, null> | null = null;
  private buffer = '';
  private queue: PendingItem[] = [];
  private commandChain: Promise<void> = Promise.resolve();

  start(): void {
    if (this.proc && !this.proc.killed) return;
    const scriptPath = path.join(__dirname, 'native', 'win32-daemon.ps1');
    this.proc = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
        String(process.pid)
      ],
      {
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true
      }
    );

    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      let idx = this.buffer.indexOf('\n');
      while (idx !== -1) {
        const line = this.buffer.slice(0, idx).replace(/\r$/, '');
        this.buffer = this.buffer.slice(idx + 1);
        const pending = this.queue.shift();
        if (pending) pending.resolve(line);
        idx = this.buffer.indexOf('\n');
      }
    });

    this.proc.on('exit', () => {
      this.proc = null;
      while (this.queue.length > 0) {
        const p = this.queue.shift();
        p?.resolve('');
      }
    });
  }

  stop(): void {
    if (this.proc && !this.proc.killed) {
      const p = this.proc;
      this.proc = null;
      try {
        p.stdin.write('EXIT\n');
        p.stdin.end();
      } catch {
        try {
          p.kill();
        } catch {
          // Ignore shutdown errors
        }
      }
    }
  }

  send(command: string): Promise<string> {
    const run = () =>
      new Promise<string>((resolve) => {
        if (!this.proc || this.proc.killed) {
          this.start();
        }
        if (!this.proc) {
          resolve('');
          return;
        }
        const timer = setTimeout(() => {
          const idx = this.queue.findIndex((q) => q.resolve === wrappedResolve);
          if (idx !== -1) this.queue.splice(idx, 1);
          resolve('');
        }, 3500);

        const wrappedResolve = (val: string) => {
          clearTimeout(timer);
          resolve(val);
        };

        this.queue.push({ resolve: wrappedResolve });
        try {
          this.proc.stdin.write(`${command}\n`);
        } catch {
          const idx = this.queue.findIndex((q) => q.resolve === wrappedResolve);
          if (idx !== -1) this.queue.splice(idx, 1);
          clearTimeout(timer);
          resolve('');
        }
      });

    const next = this.commandChain.then(run, run);
    this.commandChain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }
}

export const win32Daemon = new Win32Daemon();
