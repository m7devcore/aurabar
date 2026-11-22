import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import path from 'node:path';

const COMMAND_TIMEOUT_MS = 3500;
const STARTUP_READY_TIMEOUT_MS = 15000;

// Things the user just did (a click on a taskbar icon, a volume key, live hover previews...)
// and critical startup layout commands must not wait behind background refreshes
const URGENT_COMMANDS = new Set([
  'SET_HWNDS',
  'SET_EXTRA_HWNDS',
  'KEEP_TOP',
  'TASKBAR_HIDE',
  'TASKBAR_SHOW',
  'PLACE_DOCK',
  'PLACE_WIN',
  'SEC_RESERVE',
  'SEC_RELEASE',
  'TOGGLE',
  'FOCUS',
  'PEEK_START',
  'PEEK_STOP',
  'LIVE_THUMBS',
  'LIVE_THUMBS_CLEAR',
  'WAKE_HIDDEN',
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
  'AUDIO_SET_DEVICE',
  'AUDIO_SESSION_VOL',
  'AUDIO_SESSION_MUTE',
  'BRIGHT_SET',
  'NIGHTLIGHT_TOGGLE',
  'MEDIA_PLAYPAUSE',
  'MEDIA_NEXT',
  'MEDIA_PREV',
  'KBD_SWITCH',
  'FULLSCREEN',
  'FULLSCREEN_OF'
]);

// Commands where only the newest queued value matters — coalescing prevents backlog lag
// while dragging sliders, sweeping across taskbar icons, or during background polling.
const COALESCED_PREFIXES = new Set([
  'VOL_SET',
  'BRIGHT_SET',
  'LIVE_THUMBS',
  'LIVE_THUMBS_CLEAR',
  'PEEK_START',
  'PEEK_STOP',
  'LIST',
  'FULLSCREEN',
  'FULLSCREEN_OF',
  'KBD_LANG',
  'VOL_GET'
]);

function coalesceKeyOf(command: string): string | null {
  const sp = command.indexOf(' ');
  const verb = sp === -1 ? command : command.slice(0, sp);
  if (verb === 'AUDIO_SESSION_VOL') {
    // Coalesce per app session id ("AUDIO_SESSION_VOL <pct> <id>")
    const sp2 = command.indexOf(' ', sp + 1);
    if (sp2 > 0) return `AUDIO_SESSION_VOL:${command.slice(sp2 + 1).trim().toLowerCase()}`;
  }
  if (verb === 'PEEK_START' || verb === 'PEEK_STOP') return 'PEEK';
  if (verb === 'LIVE_THUMBS' || verb === 'LIVE_THUMBS_CLEAR') return 'LIVE_THUMBS';
  return COALESCED_PREFIXES.has(verb) ? verb : null;
}

interface QueuedCommand {
  command: string;
  urgent: boolean;
  coalesceKey: string | null;
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
  private ready = false;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;
  private readyWaiters: Array<() => void> = [];

  private hasStarted = false;
  private restartListener: (() => void) | null = null;

  whenReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.readyWaiters.push(resolve);
    });
  }

  private markReady(): void {
    if (this.ready) return;
    this.ready = true;
    if (this.readyTimer) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
    const waiters = this.readyWaiters;
    this.readyWaiters = [];
    for (const w of waiters) w();
    this.pump();
  }

  /**
   * Called when the native process had to be started again after dying. Whatever it had set up
   * (the reserved work area, window placement) was lost with it, so the app re-applies it.
   */
  onRestart(listener: () => void): void {
    this.restartListener = listener;
  }

  start(): void {
    if (this.proc && !this.proc.killed) return;
    const isRestart = this.hasStarted;
    this.hasStarted = true;
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
    this.ready = false;
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyTimer = setTimeout(() => {
      if (this.proc === proc) this.markReady();
    }, STARTUP_READY_TIMEOUT_MS);

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
      this.ready = false;
      if (this.readyTimer) {
        clearTimeout(this.readyTimer);
        this.readyTimer = null;
      }
      this.rejectAllPending();
    });

    // Queued behind whatever triggered this start; setImmediate keeps it out of send()'s stack
    if (isRestart && this.restartListener) {
      const listener = this.restartListener;
      setImmediate(() => listener());
    }
  }

  private handleLine(line: string): void {
    if (line === 'READY') {
      this.markReady();
      return;
    }
    if (!this.ready) {
      this.markReady();
    }
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
      const verb = command.split(' ', 1)[0];
      const urgent = URGENT_COMMANDS.has(verb);
      const coalesceKey = coalesceKeyOf(command);

      // Drop any superseded queued command with the same coalesceKey so rapid drags/hovers
      // never accumulate latency behind stale work
      if (coalesceKey) {
        for (let i = this.queue.length - 1; i >= 0; i--) {
          if (this.queue[i].coalesceKey === coalesceKey) {
            const stale = this.queue.splice(i, 1)[0];
            stale.resolve('');
          }
        }
      }

      const job: QueuedCommand = { command, urgent, coalesceKey, resolve };
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
    if (!this.proc || this.proc.killed) {
      if (this.queue.length > 0) this.start();
      return;
    }
    if (!this.ready) return;
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
