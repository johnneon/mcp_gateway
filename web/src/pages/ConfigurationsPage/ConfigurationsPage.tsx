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
import {
  createConfiguration,
  deleteConfiguration,
  listConfigurations,
  rotateConfiguration,
  setConfigurationEnabled,
  type ConfigurationListItem,
} from '@/features/configurations/api';
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

export function ConfigurationsPage() {
  const [items, setItems] = useState<ConfigurationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [revealToken, setRevealToken] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listConfigurations();
      setItems(rows);
    } catch (err) {
      setError(errorMessage(err));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

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
      await loadList();
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
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
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
            </li>
          ))}
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
