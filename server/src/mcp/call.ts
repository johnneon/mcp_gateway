import { Ajv, type ValidateFunction } from 'ajv';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { NativeToolResult, RegistryTool } from '../connectors/contract.js';
import {
  CONNECTION_FAILED_MESSAGE,
  createEgressClientForAccount,
  DESTINATION_NOT_ALLOWED_MESSAGE,
  isEgressError,
  REDIRECT_NOT_ALLOWED_MESSAGE,
  RESPONSE_TOO_LARGE_MESSAGE,
} from '../connectors/native/egress.js';
import type { ConnectorRegistry } from '../connectors/registry.js';
import type { EncryptedStore } from '../store/store.js';
import type { ActiveConfiguration } from './auth.js';
import {
  buildToolInputSchema,
  eligibleAccountsForConnector,
  type EligibleAccount,
} from './tools.js';

export const TOOL_EXECUTION_FAILED_MESSAGE = 'Tool execution failed';
export const INVALID_TOOL_ARGUMENTS_MESSAGE = 'Invalid tool arguments';
export const ACCOUNT_NOT_ALLOWED_MESSAGE = 'Account is not allowed for this tool';
export const UNKNOWN_TOOL_MESSAGE = 'Unknown tool';

const EGRESS_MCP_MESSAGES: ReadonlySet<string> = new Set([
  DESTINATION_NOT_ALLOWED_MESSAGE,
  REDIRECT_NOT_ALLOWED_MESSAGE,
  CONNECTION_FAILED_MESSAGE,
  RESPONSE_TOO_LARGE_MESSAGE,
]);

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  validateSchema: false,
});

function compileSchema(schema: object): ValidateFunction {
  return ajv.compile(schema);
}

function readAccountId(args: Record<string, unknown>): string | undefined {
  const value = args.account;
  return typeof value === 'string' ? value : undefined;
}

function stripAccount(args: Record<string, unknown>): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...args };
  delete rest.account;
  return rest;
}

function findEligibleAccount(
  eligible: readonly EligibleAccount[],
  accountId: string | undefined,
): EligibleAccount | undefined {
  if (accountId === undefined) {
    return undefined;
  }
  return eligible.find((account) => account.id === accountId);
}

function isEgressNetworkMessage(message: string): boolean {
  return EGRESS_MCP_MESSAGES.has(message);
}

/**
 * Validate, authorize, and invoke a native connector tool for the active configuration.
 */
export async function dispatchToolCall(options: {
  connectorRegistry: ConnectorRegistry;
  configuration: ActiveConfiguration;
  store: EncryptedStore;
  toolName: string;
  args: Record<string, unknown>;
}): Promise<NativeToolResult> {
  const { connectorRegistry, configuration, store, toolName, args } = options;

  const tool: RegistryTool | undefined = connectorRegistry.getTool(toolName);
  if (tool === undefined) {
    throw new McpError(ErrorCode.InvalidParams, UNKNOWN_TOOL_MESSAGE);
  }

  const connector = connectorRegistry.connectors.find((entry) => entry.id === tool.connectorId);
  if (connector === undefined) {
    throw new McpError(ErrorCode.InvalidParams, UNKNOWN_TOOL_MESSAGE);
  }

  const eligible = eligibleAccountsForConnector(configuration, store, tool.connectorId);
  if (eligible.length === 0) {
    throw new McpError(ErrorCode.InvalidParams, ACCOUNT_NOT_ALLOWED_MESSAGE);
  }

  const inputSchema = buildToolInputSchema(
    tool.inputSchema.properties,
    tool.inputSchema.required,
    eligible,
  );

  let validate: ValidateFunction;
  try {
    validate = compileSchema(inputSchema);
  } catch {
    throw new McpError(ErrorCode.InvalidParams, INVALID_TOOL_ARGUMENTS_MESSAGE);
  }
  if (!validate(args)) {
    throw new McpError(ErrorCode.InvalidParams, INVALID_TOOL_ARGUMENTS_MESSAGE);
  }

  const account = findEligibleAccount(eligible, readAccountId(args));
  if (account === undefined) {
    throw new McpError(ErrorCode.InvalidParams, ACCOUNT_NOT_ALLOWED_MESSAGE);
  }

  const egressClient = createEgressClientForAccount({
    destinations: connector.allowedDestinations,
    accountValues: account.values,
  });

  try {
    return await tool.handler(stripAccount(args), account.values, egressClient);
  } catch (error) {
    if (isEgressError(error) && isEgressNetworkMessage(error.message)) {
      throw new McpError(ErrorCode.InternalError, error.message);
    }
    if (error instanceof Error && isEgressNetworkMessage(error.message)) {
      throw new McpError(ErrorCode.InternalError, error.message);
    }
    throw new McpError(ErrorCode.InternalError, TOOL_EXECUTION_FAILED_MESSAGE);
  }
}
