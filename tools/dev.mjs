// `npm run dev`: runs the API (with auto-restart) and the Vite dev server together.
// Open http://localhost:5173. Ctrl+C stops both.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const procs = [
  { name: 'api', color: 33, args: ['--watch', '--env-file-if-exists=.env', 'apps/api/src/server.ts'] },
  { name: 'web', color: 36, args: ['node_modules/vite/bin/vite.js', '--config', 'apps/web/vite.config.ts'] },
].map(({ name, color, args }) => {
  const child = spawn(process.execPath, args, { cwd: root, env: process.env });
  const tag = `\x1b[${color}m${name.padEnd(3)}\x1b[0m │ `;
  const relay = (stream, out) =>
    stream.on('data', (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/)) if (line.trim()) out.write(tag + line + '\n');
    });
  relay(child.stdout, process.stdout);
  relay(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`${tag}exited (${code})`);
    for (const p of procs) p.kill();
    process.exit(code ?? 0);
  });
  return child;
});

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => procs.forEach((p) => p.kill()));
