export type BuildChildEnvInput = {
  platform: string;
  parentEnv: Readonly<Record<string, string>>;
  variables: Readonly<Record<string, string>>;
};

function lookup(parentEnv: Readonly<Record<string, string>>, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(parentEnv)) {
    if (key.toLowerCase() === target) {
      return value;
    }
  }
  return undefined;
}

/**
 * Child environment starts empty. PATH is copied on every platform.
 * SYSTEMROOT is copied only when the supplied platform is Windows.
 * Mapped variables are applied last and may override those names.
 */
export function buildChildEnv(input: BuildChildEnvInput): Record<string, string> {
  const child: Record<string, string> = {};
  const pathValue = lookup(input.parentEnv, 'PATH');
  if (pathValue !== undefined) {
    child.PATH = pathValue;
  }
  if (input.platform === 'win32') {
    const systemRoot = lookup(input.parentEnv, 'SYSTEMROOT');
    if (systemRoot !== undefined) {
      child.SYSTEMROOT = systemRoot;
    }
  }
  for (const [name, value] of Object.entries(input.variables)) {
    child[name] = value;
  }
  return child;
}
