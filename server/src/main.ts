import { writeSync } from 'node:fs';
import { MissingEnvError, parseEnv } from './env.js';
import { createAdminApp } from './http/createAdminApp.js';
import { createMcpApp } from './http/createMcpApp.js';
import { StoreCorruptError, StoreDecryptError } from './store/errors.js';
import { open } from './store/store.js';

function exitWithMessage(message: string): never {
  writeSync(process.stderr.fd, `${message}\n`);
  process.exit(1);
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

  try {
    await open(config.dataDir, config.encryptionKey);
  } catch (error) {
    if (error instanceof StoreCorruptError || error instanceof StoreDecryptError) {
      exitWithMessage(error.message);
    }
    throw error;
  }

  const mcpApp = createMcpApp();
  const adminApp = createAdminApp();

  mcpApp.listen(config.mcpPort, config.mcpHost);
  adminApp.listen(config.adminPort, config.adminHost);
}

void start();
