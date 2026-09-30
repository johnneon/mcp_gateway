import { open, readFile, rm, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { createInterface } from 'node:readline';

// libuv on Windows copies these from the parent when the spawn env omits them.
// Drop that fill-in so report_env shows the environment the runtime passed.
// A runtime-set SYSTEMROOT differs from the injected WINDIR and is kept.
const LIBUV_WINDOWS_FILL = [
  'HOMEDRIVE',
  'HOMEPATH',
  'LOGONSERVER',
  'SYSTEMDRIVE',
  'TEMP',
  'USERDOMAIN',
  'USERNAME',
  'USERPROFILE',
  'WINDIR',
];

function envKey(name) {
  const target = name.toLowerCase();
  return Object.keys(process.env).find((key) => key.toLowerCase() === target);
}

function undoLibuvWindowsFill() {
  const windirKey = envKey('WINDIR');
  const systemRootKey = envKey('SYSTEMROOT');
  const windir = windirKey === undefined ? undefined : process.env[windirKey];
  const systemRoot = systemRootKey === undefined ? undefined : process.env[systemRootKey];
  if (
    systemRootKey !== undefined &&
    windir !== undefined &&
    systemRoot !== undefined &&
    systemRoot.toLowerCase() === windir.toLowerCase()
  ) {
    delete process.env[systemRootKey];
  }
  for (const name of LIBUV_WINDOWS_FILL) {
    const key = envKey(name);
    if (key !== undefined) {
      delete process.env[key];
    }
  }
}

function isNodeError(error) {
  return error instanceof Error && 'code' in error;
}

async function incrementLaunchCount(filePath) {
  const lockPath = `${filePath}.lock`;
  for (;;) {
    try {
      const handle = await open(lockPath, 'wx');
      await handle.close();
      break;
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'EEXIST') {
        throw error;
      }
      await new Promise((resolve) => {
        setImmediate(resolve);
      });
    }
  }

  try {
    let current = 0;
    try {
      const text = await readFile(filePath, 'utf8');
      const parsed = Number.parseInt(text.trim(), 10);
      if (Number.isInteger(parsed) && parsed >= 0) {
        current = parsed;
      }
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') {
        throw error;
      }
    }
    await writeFile(filePath, String(current + 1), 'utf8');
  } finally {
    await rm(lockPath, { force: true });
  }
}

undoLibuvWindowsFill();

const launchCountPath = process.argv[2];
if (launchCountPath !== undefined && launchCountPath.length > 0) {
  await incrementLaunchCount(launchCountPath);
}

const tools = [
  {
    name: 'report_env',
    description: 'Report the environment, executable, arguments, and pid of this process',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'crash',
    description: 'Exit this process without a tool result',
    inputSchema: { type: 'object', properties: {} },
  },
];

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function readProtocolVersion(params) {
  if (params === null || typeof params !== 'object') {
    return '2025-03-26';
  }
  if (!('protocolVersion' in params) || typeof params.protocolVersion !== 'string') {
    return '2025-03-26';
  }
  return params.protocolVersion;
}

function readToolName(params) {
  if (params === null || typeof params !== 'object') {
    return '';
  }
  if (!('name' in params) || typeof params.name !== 'string') {
    return '';
  }
  return params.name;
}

function handleMessage(message) {
  if (message === null || typeof message !== 'object') {
    return;
  }
  if (!('method' in message) || typeof message.method !== 'string') {
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(message, 'id')) {
    return;
  }
  const id = message.id;
  const method = message.method;
  const params = 'params' in message ? message.params : undefined;

  if (method === 'initialize') {
    writeMessage({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: readProtocolVersion(params),
        capabilities: { tools: {} },
        serverInfo: { name: 'fake-stdio-mcp', version: '1.0.0' },
      },
    });
    return;
  }

  if (method === 'ping') {
    writeMessage({ jsonrpc: '2.0', id, result: {} });
    return;
  }

  if (method === 'tools/list') {
    writeMessage({ jsonrpc: '2.0', id, result: { tools } });
    return;
  }

  if (method === 'tools/call') {
    const name = readToolName(params);
    if (name === 'crash') {
      process.exit(1);
    }
    if (name === 'report_env') {
      const text = JSON.stringify({
        env: process.env,
        execPath: process.execPath,
        argv: process.argv,
        pid: process.pid,
      });
      writeMessage({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text }] },
      });
      return;
    }
    writeMessage({
      jsonrpc: '2.0',
      id,
      error: { code: -32602, message: 'Unknown tool' },
    });
    return;
  }

  writeMessage({
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: 'Method not found' },
  });
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return;
  }
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }
  handleMessage(message);
});
