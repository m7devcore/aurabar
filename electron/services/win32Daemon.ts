import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import path from 'node:path';

const COMMAND_TIMEOUT_MS = 3500;

// Things the user just did (a click on a taskbar icon, a volume key...) must not wait behind
// background refreshes such as window lists, thumbnails and icons that are already queued
const URGENT_COMMANDS = new Set([
  'TOGGLE',
  'CLOSE_WIN',
  'OPEN_APP',
  'QUIT_APP',
  'KILL_APP',
  'START',
  'QUICK',
  'DESKTOP',
  'VOL_SET',
  'VOL_UP',
  'VOL_DOWN',
  'VOL_MUTE',
  'MEDIA_PLAYPAUSE',
  'MEDIA_NEXT',
  'MEDIA_PREV',
  'KBD_SWITCH'
]);

interface QueuedCommand {
  command: string;
  urgent: boolean;
  resolve: (value: string) => void;
}

class Win32Daemon {
  private proc: ChildProcessByStdio<Writable, Readable, null> | null = null;
  private buffer = '';
  // Every command is tagged "#<id> CMD" and the daemon echoes "#<id> <reply>", so a reply that
  // arrives after its command timed out is dropped instead of being handed to the next caller.
  private pending = new Map<number, (value: string) => void>();
  private nextId = 1;
  private queue: QueuedCommand[] = [];
  private busy = false;

  start(): void {
    if (this.proc && !this.proc.killed) return;
    // In the installed app main.cjs lives inside app.asar, which PowerShell cannot read; the
    // native files are unpacked beside it (see asarUnpack in package.json)
    const nativeDir = path
      .join(__dirname, 'native')
      .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
    const scriptPath = path.join(nativeDir, 'win32-daemon.ps1');
    const proc = spawn(
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
    this.proc = proc;
    this.buffer = '';

    // Writing to a pipe whose reader died emits EPIPE asynchronously; unhandled it crashes main
    proc.stdin.on('error', () => undefined);

    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk: string) => {
      if (this.proc !== proc) return;
      this.buffer += chunk;
      let idx = this.buffer.indexOf('\n');
      while (idx !== -1) {
        const line = this.buffer.slice(0, idx).replace(/\r$/, '');
        this.buffer = this.buffer.slice(idx + 1);
        this.handleLine(line);
        idx = this.buffer.indexOf('\n');
      }
    });

    proc.on('exit', () => {
      // A stale process exiting must not tear down a newer one started after stop()
      if (this.proc !== proc) return;
      this.proc = null;
      this.buffer = '';
      this.rejectAllPending();
    });
  }

  private handleLine(line: string): void {
    const match = /^#(\d+) ?(.*)$/s.exec(line);
    if (!match) return;
    const resolve = this.pending.get(Number(match[1]));
    if (!resolve) return;
    this.pending.delete(Number(match[1]));
    resolve(match[2]);
  }

  private rejectAllPending(): void {
    const waiters = Array.from(this.pending.values());
    this.pending.clear();
    for (const resolve of waiters) resolve('');
  }

  stop(): void {
    if (this.proc && !this.proc.killed) {
      const p = this.proc;
      this.proc = null;
      this.rejectAllPending();
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
    return new Promise<string>((resolve) => {
      const urgent = URGENT_COMMANDS.has(command.split(' ', 1)[0]);
      const job: QueuedCommand = { command, urgent, resolve };
      if (urgent) {
        // After other urgent jobs (keeps their order), before everything background
        let at = 0;
        while (at < this.queue.length && this.queue[at].urgent) at += 1;
        this.queue.splice(at, 0, job);
      } else {
        this.queue.push(job);
      }
      this.pump();
    });
  }

  private pump(): void {
    if (this.busy) return;
    const job = this.queue.shift();
    if (!job) return;
    this.busy = true;
    this.execute(job.command)
      .then(job.resolve)
      .finally(() => {
        this.busy = false;
        this.pump();
      });
  }

  private execute(command: string): Promise<string> {
    return new Promise<string>((resolve) => {
      if (!this.proc || this.proc.killed) {
        this.start();
      }
      const proc = this.proc;
      if (!proc) {
        resolve('');
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve('');
      }, COMMAND_TIMEOUT_MS);

      this.pending.set(id, (val: string) => {
        clearTimeout(timer);
        resolve(val);
      });
      try {
        proc.stdin.write(`#${id} ${command}
`);
      } catch {
        this.pending.delete(id);
        clearTimeout(timer);
        resolve('');
      }
    });
  }
}

export const win32Daemon = new Win32Daemon();
