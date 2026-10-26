import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import process from 'node:process';

const ports = [4173, 4174, 4175];
const limitMs = 45_000;
const cli = 'node_modules/@playwright/test/cli.js';

function listening(port) {
  return new Promise((resolve) => {
    const socket = connect({ host: 'localhost', port });
    socket.setTimeout(1_000);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(false));
  });
}

const child = spawn(process.execPath, [cli, 'test', 'e2e/shutdown.spec.ts', '--project=desktop'], {
  stdio: 'inherit',
  env: { ...process.env, CI: '1' },
});

const result = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve({ timedOut: true, code: null }), limitMs);
  child.once('exit', (code, signal) => {
    clearTimeout(timer);
    resolve({ timedOut: false, code, signal });
  });
});

if (result.timedOut) {
  const occupied = (await Promise.all(ports.map(async (port) => [port, await listening(port)]))).filter(([, active]) => active).map(([port]) => port);
  console.error(`Playwright non si e chiuso entro ${limitMs / 1_000}s; PID runner=${child.pid}; porte ancora attive=${occupied.join(',') || 'nessuna'}.`);
  child.kill('SIGTERM');
  process.exitCode = 1;
} else if (result.code !== 0) {
  console.error(`Playwright e terminato con codice ${result.code ?? 'n.d.'} e segnale ${result.signal ?? 'nessuno'}.`);
  process.exitCode = 1;
} else {
  const occupied = (await Promise.all(ports.map(async (port) => [port, await listening(port)]))).filter(([, active]) => active).map(([port]) => port);
  if (occupied.length) {
    console.error(`Il runner e uscito, ma restano listener sulle porte: ${occupied.join(', ')}.`);
    process.exitCode = 1;
  } else {
    console.log('Teardown regolare: runner chiuso e porte 4173-4175 libere.');
  }
}
