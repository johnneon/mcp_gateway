export class ConfigurationNotFoundError extends Error {
  constructor() {
    super('Configuration not found');
    this.name = 'ConfigurationNotFoundError';
  }
}

export class ConfigurationValidationError extends Error {
  constructor(message = 'Invalid request') {
    super(message);
    this.name = 'ConfigurationValidationError';
  }
}
