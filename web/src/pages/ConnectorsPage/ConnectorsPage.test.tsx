import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/app';
import { emptyResponse, jsonResponse, mockFetch, textResponse } from '@/test/mockFetch';
import { ConnectorsPage } from './ConnectorsPage';

afterEach(() => {
  vi.unstubAllGlobals();
});

const fakeConnector = {
  id: 'fake',
  name: 'Fake',
  kind: 'native' as const,
  fields: [
    { name: 'token', label: 'Token', type: 'secret' as const, required: true },
    { name: 'user', label: 'User', type: 'text' as const, required: true },
  ],
};

const accountBox = {
  id: 'a1',
  connector: 'fake',
  label: 'Box',
  enabled: true,
  values: { user: 'alice' },
};

function connectorsPageFetch(options?: {
  connectors?: unknown[];
  accounts?: unknown[];
  postAccount?: { status: number; body: unknown };
  patchAccount?: { status: number; body: unknown };
  checkStatus?: number;
  deleteStatus?: number;
}) {
  let accounts = [...(options?.accounts ?? [])];
  return mockFetch((url, _init, call) => {
    if (call.method === 'GET' && url === '/api/connectors') {
      return jsonResponse(options?.connectors ?? [fakeConnector]);
    }
    if (call.method === 'GET' && url === '/api/accounts') {
      return jsonResponse(accounts);
    }
    if (call.method === 'POST' && url === '/api/accounts') {
      const status = options?.postAccount?.status ?? 201;
      const body =
        options?.postAccount?.body ??
        ({
          id: 'a-new',
          connector: 'fake',
          label: 'Box',
          enabled: true,
          values: { user: 'alice' },
        } as const);
      if (status >= 200 && status < 300) {
        accounts = [...accounts, body];
        return jsonResponse(body, status);
      }
      if (typeof body === 'string') {
        return textResponse(body, status);
      }
      return jsonResponse(body, status);
    }
    if (call.method === 'POST' && /\/api\/accounts\/[^/]+\/check$/.test(url)) {
      const status = options?.checkStatus ?? 200;
      if (status >= 200 && status < 300) {
        return emptyResponse(status);
      }
      return textResponse('Connection check failed', status);
    }
    if (call.method === 'PATCH' && url.startsWith('/api/accounts/')) {
      const status = options?.patchAccount?.status ?? 200;
      const body =
        options?.patchAccount?.body ??
        ({
          id: 'a1',
          connector: 'fake',
          label: 'Box',
          enabled: true,
          values: { user: 'alice' },
        } as const);
      if (status >= 200 && status < 300) {
        const updated = body as { id: string };
        accounts = accounts.map((row) => ((row as { id: string }).id === updated.id ? body : row));
        return jsonResponse(body, status);
      }
      if (typeof body === 'string') {
        return textResponse(body, status);
      }
      return jsonResponse(body, status);
    }
    if (call.method === 'DELETE' && url.startsWith('/api/accounts/')) {
      const status = options?.deleteStatus ?? 204;
      if (status === 204) {
        const id = url.replace('/api/accounts/', '');
        accounts = accounts.filter((row) => (row as { id: string }).id !== id);
        return emptyResponse(204);
      }
      return textResponse('Not Found', status);
    }
    throw new Error(`unexpected ${call.method} ${url}`);
  });
}

describe('admin-configurations-ui: Connectors list from API', () => {
  it('Empty API list keeps the empty-state copy', async () => {
    const user = userEvent.setup();
    const { calls } = mockFetch((url, _init, call) => {
      if (call.method === 'GET' && url === '/api/configurations') {
        return jsonResponse([]);
      }
      if (call.method === 'GET' && url === '/api/connectors') {
        return jsonResponse([]);
      }
      if (call.method === 'GET' && url === '/api/accounts') {
        return jsonResponse([]);
      }
      throw new Error(`unexpected fetch: ${call.method} ${url}`);
    });

    render(<App />);
    await screen.findByRole('heading', { name: 'Configurations' });

    await user.click(screen.getByRole('button', { name: 'Connectors' }));

    expect(screen.getByRole('heading', { name: 'Connectors' })).toBeInTheDocument();
    expect(await screen.findByText('No connectors yet.')).toBeInTheDocument();
    expect(
      screen.queryByText('Connector accounts will appear here in a later change.'),
    ).not.toBeInTheDocument();
    expect(calls.some((call) => call.method === 'GET' && call.url === '/api/connectors')).toBe(
      true,
    );
    expect(calls.some((call) => call.method === 'GET' && call.url === '/api/accounts')).toBe(true);
  });

  it('Non-empty list shows name and fields without account actions', async () => {
    connectorsPageFetch({
      connectors: [fakeConnector],
      accounts: [accountBox],
    });

    render(<ConnectorsPage />);

    expect(await screen.findByText('Fake')).toBeInTheDocument();
    expect(screen.getByText('Box')).toBeInTheDocument();
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.getByText(/alice/)).toBeInTheDocument();
    expect(screen.queryByText(/^token:/i)).not.toBeInTheDocument();
    expect(screen.queryByText('token')).not.toBeInTheDocument();
    expect(screen.queryByText('super-secret-token-value')).not.toBeInTheDocument();
  });
});

describe('admin-configurations-ui: Account form from connector field descriptions', () => {
  it('Create sends full values and clears secret input after success', async () => {
    const user = userEvent.setup();
    const fixtureSecret = 'fixture-secret-value';
    const { calls } = connectorsPageFetch({
      connectors: [fakeConnector],
      accounts: [],
    });

    render(<ConnectorsPage />);
    expect(await screen.findByText('Fake')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add account' }));
    await user.type(screen.getByLabelText('Label'), 'Box');
    await user.type(screen.getByLabelText('User'), 'alice');
    await user.type(screen.getByLabelText('Token'), fixtureSecret);
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(calls.some((call) => call.method === 'POST' && call.url === '/api/accounts')).toBe(
        true,
      );
    });

    const post = calls.find((call) => call.method === 'POST' && call.url === '/api/accounts');
    expect(post?.headers.get('Content-Type')).toBe('application/json');
    expect(post?.body).toBe(
      JSON.stringify({
        connector: 'fake',
        label: 'Box',
        values: { token: fixtureSecret, user: 'alice' },
      }),
    );

    await waitFor(() => {
      expect(screen.queryByLabelText('Token')).not.toBeInTheDocument();
    });
    expect(screen.queryByText(fixtureSecret)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(fixtureSecret)).not.toBeInTheDocument();
    expect(await screen.findByText('Box')).toBeInTheDocument();
  });

  it('Edit omits blank secret keys', async () => {
    const user = userEvent.setup();
    const { calls } = connectorsPageFetch({
      connectors: [fakeConnector],
      accounts: [accountBox],
      patchAccount: {
        status: 200,
        body: {
          id: 'a1',
          connector: 'fake',
          label: 'Box',
          enabled: true,
          values: { user: 'alice' },
        },
      },
    });

    render(<ConnectorsPage />);
    expect(await screen.findByText('Box')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Token')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(calls.some((call) => call.method === 'PATCH' && call.url === '/api/accounts/a1')).toBe(
        true,
      );
    });

    const patch = calls.find((call) => call.method === 'PATCH' && call.url === '/api/accounts/a1');
    expect(patch?.headers.get('Content-Type')).toBe('application/json');
    const parsed = JSON.parse(patch?.body ?? '{}') as {
      label: string;
      values: Record<string, string>;
    };
    expect(parsed.label).toBe('Box');
    expect(parsed.values).toEqual({ user: 'alice' });
    expect(parsed.values).not.toHaveProperty('token');
  });

  it('Create connection-check failure shows API error text', async () => {
    const user = userEvent.setup();
    const fixtureSecret = 'fixture-secret-value';
    connectorsPageFetch({
      connectors: [fakeConnector],
      accounts: [],
      postAccount: { status: 400, body: 'Connection check failed' },
    });

    render(<ConnectorsPage />);
    expect(await screen.findByText('Fake')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add account' }));
    await user.type(screen.getByLabelText('Label'), 'Box');
    await user.type(screen.getByLabelText('User'), 'alice');
    await user.type(screen.getByLabelText('Token'), fixtureSecret);
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Connection check failed');
    expect(screen.queryByText(/Error:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/at Object\./)).not.toBeInTheDocument();
    expect(screen.queryByText(fixtureSecret)).not.toBeInTheDocument();
  });
});

describe('admin-configurations-ui: Show English errors from failed connectors list', () => {
  it('Connectors list error is shown in English', async () => {
    mockFetch((url, _init, call) => {
      if (call.method === 'GET' && url === '/api/connectors') {
        return textResponse('Connectors unavailable', 500);
      }
      if (call.method === 'GET' && url === '/api/accounts') {
        return jsonResponse([]);
      }
      throw new Error(`unexpected fetch: ${call.method} ${url}`);
    });

    render(<ConnectorsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/Connectors unavailable/i);
    expect(screen.queryByText('super-secret-token-value')).not.toBeInTheDocument();
  });
});

describe('admin-configurations-ui: Check connection, disable, and delete account', () => {
  it('Check connection calls the check route', async () => {
    const user = userEvent.setup();
    const { calls } = connectorsPageFetch({
      connectors: [fakeConnector],
      accounts: [accountBox],
    });

    render(<ConnectorsPage />);
    expect(await screen.findByText('Box')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Check connection' }));

    await waitFor(() => {
      expect(
        calls.some((call) => call.method === 'POST' && call.url === '/api/accounts/a1/check'),
      ).toBe(true);
    });

    const check = calls.find(
      (call) => call.method === 'POST' && call.url === '/api/accounts/a1/check',
    );
    expect(check?.headers.get('Content-Type')).toBe('application/json');
    expect(
      calls.some(
        (call) =>
          (call.method === 'PATCH' || call.method === 'DELETE') &&
          call.url.startsWith('/api/accounts/a1'),
      ),
    ).toBe(false);
  });

  it('Disable sends enabled-only PATCH', async () => {
    const user = userEvent.setup();
    const { calls } = connectorsPageFetch({
      connectors: [fakeConnector],
      accounts: [accountBox],
      patchAccount: {
        status: 200,
        body: {
          id: 'a1',
          connector: 'fake',
          label: 'Box',
          enabled: false,
          values: { user: 'alice' },
        },
      },
    });

    render(<ConnectorsPage />);
    expect(await screen.findByText('Box')).toBeInTheDocument();
    expect(screen.getByText('Enabled')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Enable Box' }));

    await waitFor(() => {
      expect(calls.some((call) => call.method === 'PATCH' && call.url === '/api/accounts/a1')).toBe(
        true,
      );
    });

    const patch = calls.find((call) => call.method === 'PATCH' && call.url === '/api/accounts/a1');
    expect(patch?.headers.get('Content-Type')).toBe('application/json');
    expect(JSON.parse(patch?.body ?? '{}')).toEqual({ enabled: false });
    expect(await screen.findByText('Disabled')).toBeInTheDocument();
  });

  it('Delete requires confirmation then removes the row', async () => {
    const user = userEvent.setup();
    const { calls } = connectorsPageFetch({
      connectors: [fakeConnector],
      accounts: [accountBox],
    });

    render(<ConnectorsPage />);
    expect(await screen.findByText('Box')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }));

    await waitFor(() => {
      expect(
        calls.some((call) => call.method === 'DELETE' && call.url === '/api/accounts/a1'),
      ).toBe(true);
    });

    const del = calls.find((call) => call.method === 'DELETE' && call.url === '/api/accounts/a1');
    expect(del?.headers.get('Content-Type')).toBe('application/json');
    await waitFor(() => {
      expect(screen.queryByText('Box')).not.toBeInTheDocument();
    });
  });

  it('Delete without confirmation does not call the API', async () => {
    const user = userEvent.setup();
    const { calls } = connectorsPageFetch({
      connectors: [fakeConnector],
      accounts: [accountBox],
    });

    render(<ConnectorsPage />);
    expect(await screen.findByText('Box')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
    expect(screen.getByText('Box')).toBeInTheDocument();
  });
});
