import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { listAccounts, type AccountPublic } from '@/features/accounts/api';
import {
  createConfiguration,
  deleteConfiguration,
  getDisabledTools,
  listConfigurations,
  rotateConfiguration,
  setConfigurationAccounts,
  setConfigurationEnabled,
  setDisabledTools,
  type ConfigurationListItem,
} from '@/features/configurations/api';
import { listConnectors, type ConnectorPublicDescription } from '@/features/connectors/api';
import { ApiError } from '@/shared/api';

type PendingConfirm =
  { kind: 'rotate'; id: string; name: string } | { kind: 'delete'; id: string; name: string };

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return 'Something went wrong';
}

function disabledToolsKey(configurationId: string, accountId: string): string {
  return `${configurationId}/${accountId}`;
}

async function loadDisabledToolMap(
  configurationRows: readonly ConfigurationListItem[],
): Promise<Record<string, string[]>> {
  const pairs = configurationRows.flatMap((row) =>
    row.accountIds.map((accountId) => ({ configurationId: row.id, accountId })),
  );
  const entries = await Promise.all(
    pairs.map(async (pair) => {
      const body = await getDisabledTools(pair.configurationId, pair.accountId);
      return [disabledToolsKey(pair.configurationId, pair.accountId), body.toolNames] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export function ConfigurationsPage() {
  const [items, setItems] = useState<ConfigurationListItem[]>([]);
  const [accounts, setAccounts] = useState<AccountPublic[]>([]);
  const [connectors, setConnectors] = useState<ConnectorPublicDescription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [accountsBusyId, setAccountsBusyId] = useState<string | null>(null);
  const [revealToken, setRevealToken] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [disabledTools, setDisabledToolsByAccount] = useState<Record<string, string[]>>({});

  const loadLists = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [configurationRows, accountRows, connectorRows] = await Promise.all([
        listConfigurations(),
        listAccounts(),
        listConnectors(),
      ]);
      const toolMap = await loadDisabledToolMap(configurationRows);
      setItems(configurationRows);
      setAccounts(accountRows);
      setConnectors(connectorRows);
      setDisabledToolsByAccount(toolMap);
    } catch (err) {
      setError(errorMessage(err));
      setItems([]);
      setAccounts([]);
      setConnectors([]);
      setDisabledToolsByAccount({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLists();
  }, [loadLists]);

  async function handleCreate(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = nameDraft.trim();
    if (name.length === 0 || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createConfiguration(name);
      setNameDraft('');
      setRevealToken(created.token);
      await loadLists();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleEnabled(item: ConfigurationListItem, enabled: boolean) {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await setConfigurationEnabled(item.id, enabled);
      setItems((current) => current.map((row) => (row.id === updated.id ? updated : row)));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleAccount(
    item: ConfigurationListItem,
    accountId: string,
    checked: boolean,
  ) {
    if (busy || accountsBusyId !== null) {
      return;
    }
    const nextIds = checked
      ? [...item.accountIds, accountId]
      : item.accountIds.filter((id) => id !== accountId);
    setAccountsBusyId(item.id);
    setError(null);
    try {
      const updated = await setConfigurationAccounts(item.id, nextIds);
      setItems((current) => current.map((row) => (row.id === updated.id ? updated : row)));
      const toolMap = await loadDisabledToolMap([updated]);
      setDisabledToolsByAccount((current) => {
        const next: Record<string, string[]> = {};
        const prefix = `${updated.id}/`;
        for (const [key, names] of Object.entries(current)) {
          if (!key.startsWith(prefix)) {
            next[key] = names;
          }
        }
        return { ...next, ...toolMap };
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAccountsBusyId(null);
    }
  }

  async function handleToggleTool(
    configurationId: string,
    accountId: string,
    toolName: string,
    enabled: boolean,
  ) {
    if (busy) {
      return;
    }
    const key = disabledToolsKey(configurationId, accountId);
    const currentNames = disabledTools[key] ?? [];
    const toolNames = enabled
      ? currentNames.filter((name) => name !== toolName)
      : currentNames.includes(toolName)
        ? currentNames
        : [...currentNames, toolName];
    setError(null);
    try {
      const saved = await setDisabledTools(configurationId, accountId, toolNames);
      setDisabledToolsByAccount((current) => ({
        ...current,
        [key]: saved.toolNames,
      }));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function runConfirmedAction() {
    if (pendingConfirm === null || busy) {
      return;
    }
    const action = pendingConfirm;
    setPendingConfirm(null);
    setBusy(true);
    setError(null);
    try {
      if (action.kind === 'rotate') {
        const rotated = await rotateConfiguration(action.id);
        setRevealToken(rotated.token);
      } else {
        await deleteConfiguration(action.id);
        setItems((current) => current.filter((row) => row.id !== action.id));
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="configurations-heading" className="space-y-6">
      <div className="space-y-1">
        <h2 id="configurations-heading" className="text-xl font-medium">
          Configurations
        </h2>
        <p className="text-sm text-muted-foreground">
          Create a configuration to get a bearer token. The token is shown once.
        </p>
      </div>

      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          void handleCreate(event);
        }}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Label htmlFor="configuration-name">Name</Label>
          <Input
            id="configuration-name"
            name="name"
            value={nameDraft}
            onChange={(event) => {
              setNameDraft(event.target.value);
            }}
            autoComplete="off"
            disabled={busy}
          />
        </div>
        <Button type="submit" disabled={busy || nameDraft.trim().length === 0}>
          Create
        </Button>
      </form>

      {error !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {loading ? <p className="text-sm text-muted-foreground">Loading configurations…</p> : null}

      {!loading && items.length === 0 && error === null ? (
        <p>No configurations yet. Create one to get a bearer token.</p>
      ) : null}

      {!loading && items.length > 0 ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {items.map((item) => {
            const accountsLocked = accountsBusyId === item.id;
            return (
              <li key={item.id} className="flex flex-col gap-4 px-4 py-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <p className="truncate font-medium">{item.name}</p>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={`enabled-${item.id}`}
                        checked={item.enabled}
                        disabled={busy}
                        onCheckedChange={(checked) => {
                          void handleToggleEnabled(item, checked === true);
                        }}
                        aria-label={`Enable ${item.name}`}
                      />
                      <Label
                        htmlFor={`enabled-${item.id}`}
                        className="font-normal text-muted-foreground"
                      >
                        {item.enabled ? 'Enabled' : 'Disabled'}
                      </Label>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setPendingConfirm({ kind: 'rotate', id: item.id, name: item.name });
                      }}
                    >
                      Rotate token
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={busy}
                      onClick={() => {
                        setPendingConfirm({ kind: 'delete', id: item.id, name: item.name });
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>

                <div className="space-y-3" aria-label={`Accounts for ${item.name}`}>
                  {connectors.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No connectors to assign.</p>
                  ) : (
                    connectors.map((connector) => {
                      const connectorAccounts = accounts.filter(
                        (account) => account.connector === connector.id,
                      );
                      if (connectorAccounts.length === 0) {
                        return null;
                      }
                      return (
                        <div key={connector.id} className="space-y-2">
                          <p className="text-sm font-medium text-muted-foreground">
                            {connector.name}
                          </p>
                          <ul className="space-y-2">
                            {connectorAccounts.map((account) => {
                              const checkboxId = `config-${item.id}-account-${account.id}`;
                              const checked = item.accountIds.includes(account.id);
                              const accountLabel = account.enabled
                                ? account.label
                                : `${account.label} (disabled)`;
                              const toolKey = disabledToolsKey(item.id, account.id);
                              const disabledNames = disabledTools[toolKey] ?? [];
                              return (
                                <li key={account.id} className="space-y-2">
                                  <div className="flex items-center gap-2">
                                    <Checkbox
                                      id={checkboxId}
                                      checked={checked}
                                      disabled={busy || accountsLocked}
                                      onCheckedChange={(value) => {
                                        void handleToggleAccount(item, account.id, value === true);
                                      }}
                                      aria-label={`Assign ${account.label} to ${item.name}`}
                                    />
                                    <Label
                                      htmlFor={checkboxId}
                                      className="font-normal text-muted-foreground"
                                    >
                                      {accountLabel}
                                    </Label>
                                  </div>
                                  {checked ? (
                                    <ul className="space-y-2 ps-6">
                                      {connector.tools.map((tool) => {
                                        const toolEnabled = !disabledNames.includes(tool.name);
                                        const toolCheckboxId = `config-${item.id}-account-${account.id}-tool-${tool.name}`;
                                        return (
                                          <li key={tool.name} className="space-y-1">
                                            <div className="flex items-center gap-2">
                                              <Checkbox
                                                id={toolCheckboxId}
                                                checked={toolEnabled}
                                                disabled={busy || accountsLocked}
                                                onCheckedChange={(value) => {
                                                  void handleToggleTool(
                                                    item.id,
                                                    account.id,
                                                    tool.name,
                                                    value === true,
                                                  );
                                                }}
                                                aria-label={`Enable ${tool.name} for ${account.label}`}
                                              />
                                              <Label
                                                htmlFor={toolCheckboxId}
                                                className="font-normal"
                                              >
                                                {tool.name}
                                              </Label>
                                            </div>
                                            <p className="ps-6 text-sm text-muted-foreground">
                                              {tool.description}
                                            </p>
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      );
                    })
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      <Dialog
        open={revealToken !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRevealToken(null);
          }
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Bearer token</DialogTitle>
            <DialogDescription>
              Copy this token now. It will not be shown again after you close this dialog.
            </DialogDescription>
          </DialogHeader>
          {revealToken !== null ? (
            <p className="break-all rounded-md bg-muted px-3 py-2 font-mono text-sm">
              {revealToken}
            </p>
          ) : null}
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingConfirm !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingConfirm(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingConfirm?.kind === 'rotate' ? 'Rotate token?' : 'Delete configuration?'}
            </DialogTitle>
            <DialogDescription>
              {pendingConfirm?.kind === 'rotate'
                ? `Rotate the bearer token for "${pendingConfirm.name}"? Existing clients will stop working until they use the new token.`
                : `Delete "${pendingConfirm?.name ?? ''}"? This cannot be undone.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPendingConfirm(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant={pendingConfirm?.kind === 'delete' ? 'destructive' : 'default'}
              onClick={() => {
                void runConfirmedAction();
              }}
            >
              {pendingConfirm?.kind === 'rotate' ? 'Confirm rotate' : 'Confirm delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
