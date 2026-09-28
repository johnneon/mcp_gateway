import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectorFieldDescription } from '@/features/connectors/api';
import { AccountForm } from './AccountForm';

const fakeFields: ConnectorFieldDescription[] = [
  { name: 'user', label: 'User', type: 'text', required: true },
  { name: 'token', label: 'Token', type: 'secret', required: true },
  { name: 'host', label: 'Host', type: 'host', required: false },
];

describe('AccountForm', () => {
  it('create payload includes full values including secret', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<AccountForm mode="create" fields={fakeFields} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText('Label'), 'Box');
    await user.type(screen.getByLabelText('User'), 'alice');
    await user.type(screen.getByLabelText('Token'), 'fixture-secret-value');
    await user.type(screen.getByLabelText('Host'), 'mail.example');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).toHaveBeenCalledWith({
      label: 'Box',
      values: {
        user: 'alice',
        token: 'fixture-secret-value',
        host: 'mail.example',
      },
    });
  });

  it('edit omits blank secret keys from values', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <AccountForm
        mode="edit"
        fields={fakeFields}
        initialLabel="Box"
        initialValues={{ user: 'alice', host: 'mail.example' }}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByLabelText('Token')).toHaveValue('');
    await user.clear(screen.getByLabelText('User'));
    await user.type(screen.getByLabelText('User'), 'bob');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).toHaveBeenCalledWith({
      label: 'Box',
      values: {
        user: 'bob',
        host: 'mail.example',
      },
    });
    const submitted = onSubmit.mock.calls[0]?.[0] as { values: Record<string, string> };
    expect(submitted.values).not.toHaveProperty('token');
  });

  it('clears secret input so fixture secret is absent from the document after success', async () => {
    const user = userEvent.setup();
    const fixtureSecret = 'fixture-secret-value';
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<AccountForm mode="create" fields={fakeFields} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText('Label'), 'Box');
    await user.type(screen.getByLabelText('User'), 'alice');
    await user.type(screen.getByLabelText('Token'), fixtureSecret);
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByLabelText('Token')).toHaveValue('');
    expect(screen.queryByDisplayValue(fixtureSecret)).not.toBeInTheDocument();
    expect(screen.queryByText(fixtureSecret)).not.toBeInTheDocument();
  });
});
