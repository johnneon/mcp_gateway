import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyResponse, jsonResponse, mockFetch, textResponse } from '@/test/mockFetch';
import { ConfigurationsPage } from './ConfigurationsPage';

afterEach(() => {
  vi.unstubAllGlobals();
});

function configurationsHandler(
  rows: unknown[],
  options?: {
    create?: { status: number; body: unknown };
    patch?: { status: number; body: unknown };
    rotate?: { status: number; body: unknown };
    deleteStatus?: number;
    listError?: { status: number; body: string };
  },
) {
  return mockFetch((url, _init, call) => {
    if (call.method === 'GET' && url === '/api/configurations') {
      if (options?.listError) {
        return textResponse(options.listError.body, options.listError.status);
      }
      return jsonResponse(rows);
    }
    if (call.method === 'POST' && url === '/api/configurations') {
      const body = options?.create?.body ?? {
        id: 'c-new',
        name: 'Primary',
        enabled: true,
        token: 'tok-create-once',
      };
      const status = options?.create?.status ?? 201;
      if (status >= 200 && status < 300) {
        const created = body as { id: string; name: string; enabled: boolean };
        rows = [
          ...(rows as Array<{ id: string }>),
          { id: created.id, name: created.name, enabled: created.enabled },
        ];
      }
      return jsonResponse(body, status);
    }
    if (call.method === 'POST' && /\/api\/configurations\/[^/]+\/rotate$/.test(url)) {
      return jsonResponse(
        options?.rotate?.body ?? {
          id: 'c1',
          name: 'Ops',
          enabled: true,
          token: 'tok-rotated',
        },
        options?.rotate?.status ?? 200,
      );
    }
    if (call.method === 'PATCH' && url.startsWith('/api/configurations/')) {
      return jsonResponse(
        options?.patch?.body ?? { id: 'c1', name: 'Ops', enabled: false },
        options?.patch?.status ?? 200,
      );
    }
    if (call.method === 'DELETE' && url.startsWith('/api/configurations/')) {
      const status = options?.deleteStatus ?? 204;
      if (status === 204) {
        const id = url.replace('/api/configurations/', '');
        rows = (rows as Array<{ id: string }>).filter((row) => row.id !== id);
        return emptyResponse(204);
      }
      return textResponse('Not Found', status);
    }
    throw new Error(`unexpected ${call.method} ${url}`);
  });
}

describe('admin-configurations-ui: List configurations without tokens', () => {
  it('Empty list', async () => {
    configurationsHandler([]);

    render(<ConfigurationsPage />);

    expect(
      await screen.findByText('No configurations yet. Create one to get a bearer token.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/tok-/)).not.toBeInTheDocument();
  });

  it('List shows name and enabled without secrets', async () => {
    configurationsHandler([
      {
        id: 'c1',
        name: 'Ops',
        enabled: true,
        token: 'secret-should-not-show',
        tokenHash: 'hash-should-not-show',
      },
    ]);

    render(<ConfigurationsPage />);

    expect(await screen.findByText('Ops')).toBeInTheDocument();
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.queryByText('secret-should-not-show')).not.toBeInTheDocument();
    expect(screen.queryByText('hash-should-not-show')).not.toBeInTheDocument();
  });
});

describe('admin-configurations-ui: Create configuration and reveal token once', () => {
  it('Create shows the token in the reveal dialog', async () => {
    const user = userEvent.setup();
    const { calls } = configurationsHandler([]);

    render(<ConfigurationsPage />);
    await screen.findByText('No configurations yet. Create one to get a bearer token.');

    await user.type(screen.getByLabelText('Name'), 'Primary');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByRole('dialog', { name: 'Bearer token' })).toBeInTheDocument();
    expect(screen.getByText('tok-create-once')).toBeInTheDocument();

    const createCall = calls.find(
      (call) => call.method === 'POST' && call.url === '/api/configurations',
    );
    expect(createCall).toBeDefined();
    expect(createCall?.headers.get('Content-Type')).toBe('application/json');
    expect(createCall?.body).toBe(JSON.stringify({ name: 'Primary' }));
  });

  it('Token is gone after the reveal dialog closes', async () => {
    const user = userEvent.setup();
    configurationsHandler([]);

    render(<ConfigurationsPage />);
    await screen.findByText('No configurations yet. Create one to get a bearer token.');

    await user.type(screen.getByLabelText('Name'), 'Primary');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('tok-create-once')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.queryByText('tok-create-once')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Bearer token' })).not.toBeInTheDocument();
  });
});

describe('admin-configurations-ui: Confirm before rotate and delete', () => {
  it('Rotate requires confirmation then shows the new token', async () => {
    const user = userEvent.setup();
    const { calls } = configurationsHandler([{ id: 'c1', name: 'Ops', enabled: true }]);

    render(<ConfigurationsPage />);
    expect(await screen.findByText('Ops')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Rotate token' }));
    expect(await screen.findByRole('dialog', { name: 'Rotate token?' })).toBeInTheDocument();
    expect(calls.some((call) => call.url.includes('/rotate'))).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Confirm rotate' }));

    expect(await screen.findByText('tok-rotated')).toBeInTheDocument();
    const rotateCall = calls.find((call) => call.url === '/api/configurations/c1/rotate');
    expect(rotateCall?.method).toBe('POST');
    expect(rotateCall?.headers.get('Content-Type')).toBe('application/json');

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('tok-rotated')).not.toBeInTheDocument();
  });

  it('Rotate without confirmation does not call the API', async () => {
    const user = userEvent.setup();
    const { calls } = configurationsHandler([{ id: 'c1', name: 'Ops', enabled: true }]);

    render(<ConfigurationsPage />);
    expect(await screen.findByText('Ops')).toBeInTheDocument();
    const before = calls.length;

    await user.click(screen.getByRole('button', { name: 'Rotate token' }));
    await screen.findByRole('dialog', { name: 'Rotate token?' });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog', { name: 'Rotate token?' })).not.toBeInTheDocument();
    expect(calls.slice(before).some((call) => call.url.includes('/rotate'))).toBe(false);
  });

  it('Delete requires confirmation then removes the row', async () => {
    const user = userEvent.setup();
    const { calls } = configurationsHandler([{ id: 'c1', name: 'Ops', enabled: true }]);

    render(<ConfigurationsPage />);
    expect(await screen.findByText('Ops')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(
      await screen.findByRole('dialog', { name: 'Delete configuration?' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm delete' }));

    expect(
      await screen.findByText('No configurations yet. Create one to get a bearer token.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Ops')).not.toBeInTheDocument();
    const deleteCall = calls.find((call) => call.method === 'DELETE');
    expect(deleteCall?.url).toBe('/api/configurations/c1');
    expect(deleteCall?.headers.get('Content-Type')).toBe('application/json');
  });

  it('Delete without confirmation does not call the API', async () => {
    const user = userEvent.setup();
    const { calls } = configurationsHandler([{ id: 'c1', name: 'Ops', enabled: true }]);

    render(<ConfigurationsPage />);
    expect(await screen.findByText('Ops')).toBeInTheDocument();
    const before = calls.length;

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByRole('dialog', { name: 'Delete configuration?' });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(calls.slice(before).some((call) => call.method === 'DELETE')).toBe(false);
    expect(screen.getByText('Ops')).toBeInTheDocument();
  });
});

describe('admin-configurations-ui: Enable or disable from the Configurations screen', () => {
  it('Disable a configuration', async () => {
    const user = userEvent.setup();
    const { calls } = configurationsHandler([{ id: 'c1', name: 'Ops', enabled: true }]);

    render(<ConfigurationsPage />);
    expect(await screen.findByText('Ops')).toBeInTheDocument();

    const checkbox = screen.getByRole('checkbox', { name: 'Enable Ops' });
    expect(checkbox).toBeChecked();
    await user.click(checkbox);

    expect(await screen.findByText('Disabled')).toBeInTheDocument();
    const patchCall = calls.find((call) => call.method === 'PATCH');
    expect(patchCall?.url).toBe('/api/configurations/c1');
    expect(patchCall?.headers.get('Content-Type')).toBe('application/json');
    expect(patchCall?.body).toBe(JSON.stringify({ enabled: false }));
    expect(screen.queryByText(/tok-/)).not.toBeInTheDocument();
  });
});

describe('admin-configurations-ui: Show English errors from failed API calls', () => {
  it('List error is shown in English', async () => {
    configurationsHandler([], {
      listError: { status: 500, body: 'Internal Server Error' },
    });

    render(<ConfigurationsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Internal Server Error');
    expect(screen.queryByText(/tok-/)).not.toBeInTheDocument();
  });
});
