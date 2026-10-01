/**
 * A connector failure whose English message may be shown to the MCP client
 * after secret scrubbing. Other errors stay on the generic tool-failure text.
 */
export class ToolFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolFailure';
  }
}
