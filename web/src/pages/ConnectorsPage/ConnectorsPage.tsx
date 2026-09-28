import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { AccountForm, type AccountFormSubmit } from '@/features/accounts/AccountForm';
import {
  checkAccount,
  createAccount,
  deleteAccount,
  listAccounts,
  patchAccount,
  type AccountPublic,
} from '@/features/accounts/api';
import {
  listConnectors,
  type ConnectorFieldDescription,
  type ConnectorPublicDescription,
} from '@/features/connectors/api';
import { ApiError } from '@/shared/api';

const EMPTY_COPY = 'No connectors yet.';

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return 'Something went wrong';
}

function secretFieldNames(fields: ConnectorFieldDescription[]): Set<string> {
  return new Set(fields.filter((field) => field.type === 'secret').map((field) => field.name));
}

function visibleValueEntries(
  fields: ConnectorFieldDescription[],
  values: Record<string, string>,
): Array<[string, string]> {
  const secrets = secretFieldNames(fields);
  return Object.entries(values).filter(([key]) => !secrets.has(key));
}

type AccountDialog =
  | { kind: 'create'; connector: ConnectorPublicDescription }
  | { kind: 'edit'; connector: ConnectorPublicDescription; account: AccountPublic };

type DeleteConfirm = { id: string; label: string };

export function ConnectorsPage() {
  const [connectors, setConnectors] = useState<ConnectorPublicDescription[]>([]);
  const [accounts, setAccounts] = useState<AccountPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<AccountDialog | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DeleteConfirm | null>(null);
  const [busy, setBusy] = useState(false);

  const loadLists = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [connectorRows, accountRows] = await Promise.all([listConnectors(), listAccounts()]);
      setConnectors(connectorRows);
      setAccounts(accountRows);
    } catch (err) {
      setError(errorMessage(err));
      setConnectors([]);
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLists();
  }, [loadLists]);

  function openCreate(connector: ConnectorPublicDescription) {
    setFormError(null);
    setDialog({ kind: 'create', connector });
  }

  function openEdit(connector: ConnectorPublicDescription, account: AccountPublic) {
    setFormError(null);
    setDialog({ kind: 'edit', connector, account });
  }

  function closeDialog() {
    setDialog(null);
    setFormError(null);
  }

  async function handleFormSubmit(data: AccountFormSubmit) {
    if (dialog === null || busy) {
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      if (dialog.kind === 'create') {
        await createAccount({
          connector: dialog.connector.id,
          label: data.label,
          values: data.values,
        });
      } else {
        await patchAccount(dialog.account.id, {
          label: data.label,
          values: data.values,
        });
      }
      closeDialog();
      await loadLists();
    } catch (err) {
      setFormError(errorMessage(err));
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function handleCheck(account: AccountPublic) {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await checkAccount(account.id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleEnabled(account: AccountPublic, enabled: boolean) {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await patchAccount(account.id, { enabled });
      setAccounts((current) => current.map((row) => (row.id === updated.id ? updated : row)));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmDelete() {
    if (pendingDelete === null || busy) {
      return;
    }
    const { id } = pendingDelete;
    setPendingDelete(null);
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(id);
      setAccounts((current) => current.filter((row) => row.id !== id));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="connectors-heading" className="space-y-4">
      <h2 id="connectors-heading" className="text-xl font-medium">
        Connectors
      </h2>

      {error !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {loading ? <p className="text-sm text-muted-foreground">Loading connectors…</p> : null}

      {!loading && connectors.length === 0 && error === null ? <p>{EMPTY_COPY}</p> : null}

      {!loading && connectors.length > 0 ? (
        <ul className="space-y-6">
          {connectors.map((connector) => {
            const connectorAccounts = accounts.filter(
              (account) => account.connector === connector.id,
            );
            return (
              <li key={connector.id} className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{connector.name}</p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      openCreate(connector);
                    }}
                  >
                    Add account
                  </Button>
                </div>
                {connectorAccounts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No accounts yet.</p>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {connectorAccounts.map((account) => {
                      const visible = visibleValueEntries(connector.fields, account.values);
                      const enabledId = `account-enabled-${account.id}`;
                      return (
                        <li
                          key={account.id}
                          className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0 space-y-2">
                            <p className="truncate font-medium">{account.label}</p>
                            <div className="flex items-center gap-2">
                              <Checkbox
                                id={enabledId}
                                checked={account.enabled}
                                disabled={busy}
                                onCheckedChange={(checked) => {
                                  void handleToggleEnabled(account, checked === true);
                                }}
                                aria-label={`Enable ${account.label}`}
                              />
                              <Label
                                htmlFor={enabledId}
                                className="font-normal text-muted-foreground"
                              >
                                {account.enabled ? 'Enabled' : 'Disabled'}
                              </Label>
                            </div>
                            {visible.length > 0 ? (
                              <ul className="space-y-0.5 text-sm text-muted-foreground">
                                {visible.map(([key, value]) => (
                                  <li key={key}>
                                    {key}: {value}
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              disabled={busy}
                              onClick={() => {
                                openEdit(connector, account);
                              }}
                            >
                              Edit
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              disabled={busy}
                              onClick={() => {
                                void handleCheck(account);
                              }}
                            >
                              Check connection
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              disabled={busy}
                              onClick={() => {
                                setPendingDelete({ id: account.id, label: account.label });
                              }}
                            >
                              Delete
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            closeDialog();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog?.kind === 'edit' ? 'Edit account' : 'Add account'}</DialogTitle>
            <DialogDescription>
              {dialog !== null
                ? `Account for ${dialog.connector.name}. Secret fields stay blank on edit to keep the stored value.`
                : 'Account form'}
            </DialogDescription>
          </DialogHeader>
          {dialog !== null ? (
            <AccountForm
              mode={dialog.kind === 'create' ? 'create' : 'edit'}
              fields={dialog.connector.fields}
              initialLabel={dialog.kind === 'edit' ? dialog.account.label : ''}
              {...(dialog.kind === 'edit' ? { initialValues: dialog.account.values } : {})}
              busy={busy}
              error={formError}
              onCancel={closeDialog}
              onSubmit={handleFormSubmit}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDelete(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete account?</DialogTitle>
            <DialogDescription>
              {`Delete "${pendingDelete?.label ?? ''}"? This cannot be undone.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPendingDelete(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                void handleConfirmDelete();
              }}
            >
              Confirm delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
