import { writeSync } from 'node:fs';
import { createProxyRuntime, PROXY_IDLE_TIMEOUT_MS } from './connectors/proxy/runtime.js';
import { productionConnectorRegistry } from './connectors/registry.js';
import { MissingEnvError, parseEnv } from './env.js';
import { createAdminApp } from './http/createAdminApp.js';
import { createMcpApp } from './http/createMcpApp.js';
import { StoreCorruptError, StoreDecryptError } from './store/errors.js';
import { open } from './store/store.js';

function exitWithMessage(message: string): never {
  writeSync(process.stderr.fd, `${message}\n`);
  process.exit(1);
}

function parentEnvFromProcess(env: NodeJS.ProcessEnv): Record<string, string> {
  const parent: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      parent[key] = value;
    }
  }
  return parent;
}

async function start(): Promise<void> {
  let config;
  try {
    config = parseEnv(process.env);
  } catch (error) {
    if (error instanceof MissingEnvError) {
      exitWithMessage(error.variable);
    }
    throw error;
  }

  let store;
  try {
    store = await open(config.dataDir, config.encryptionKey);
  } catch (error) {
    if (error instanceof StoreCorruptError || error instanceof StoreDecryptError) {
      exitWithMessage(error.message);
    }
    throw error;
  }

  const proxyRuntime = createProxyRuntime({
    platform: process.platform,
    parentEnv: parentEnvFromProcess(process.env),
    idleTimeoutMs: PROXY_IDLE_TIMEOUT_MS,
    now: () => Date.now(),
    schedule: (callback, delayMs) => {
      const timer = setTimeout(callback, delayMs);
      return {
        cancel() {
          clearTimeout(timer);
        },
      };
    },
  });

  const mcpApp = createMcpApp({
    store,
    connectorRegistry: productionConnectorRegistry,
    proxyRuntime,
  });
  const adminApp = createAdminApp({
    store,
    connectorRegistry: productionConnectorRegistry,
  });

  mcpApp.listen(config.mcpPort, config.mcpHost);
  adminApp.listen(config.adminPort, config.adminHost);
}

void start();
