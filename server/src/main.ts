import { MissingEnvError, parseEnv } from './env.js';
import { createAdminApp } from './http/createAdminApp.js';
import { createMcpApp } from './http/createMcpApp.js';

function start(): void {
  let config;
  try {
    config = parseEnv(process.env);
  } catch (error) {
    if (error instanceof MissingEnvError) {
      process.stderr.write(`${error.variable}\n`);
      process.exit(1);
    }
    throw error;
  }

  const mcpApp = createMcpApp();
  const adminApp = createAdminApp();

  mcpApp.listen(config.mcpPort, config.mcpHost);
  adminApp.listen(config.adminPort, config.adminHost);
}

start();
