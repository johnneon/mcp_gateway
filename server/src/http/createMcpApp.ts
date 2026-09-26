import express, { type Express } from 'express';

/**
 * MCP listener app. Does not call listen — main.ts owns binding.
 * Route limits and Streamable HTTP are later changes.
 */
export function createMcpApp(): Express {
  return express();
}
