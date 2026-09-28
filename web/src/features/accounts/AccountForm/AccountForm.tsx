import { useEffect, useState, type SyntheticEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ConnectorFieldDescription } from '@/features/connectors/api';

export type AccountFormSubmit = {
  label: string;
  values: Record<string, string>;
};

export type AccountFormProps = {
  mode: 'create' | 'edit';
  fields: ConnectorFieldDescription[];
  initialLabel?: string;
  initialValues?: Record<string, string>;
  busy?: boolean;
  error?: string | null;
  submitLabel?: string;
  onSubmit: (data: AccountFormSubmit) => void | Promise<void>;
  onCancel?: () => void;
};

function emptyValues(fields: ConnectorFieldDescription[]): Record<string, string> {
  const next: Record<string, string> = {};
  for (const field of fields) {
    next[field.name] = '';
  }
  return next;
}

function seedValues(
  fields: ConnectorFieldDescription[],
  mode: 'create' | 'edit',
  initialValues: Record<string, string> | undefined,
): Record<string, string> {
  const next = emptyValues(fields);
  if (mode === 'create' || initialValues === undefined) {
    return next;
  }
  for (const field of fields) {
    if (field.type === 'secret') {
      next[field.name] = '';
      continue;
    }
    const existing = initialValues[field.name];
    if (typeof existing === 'string') {
      next[field.name] = existing;
    }
  }
  return next;
}

function buildSubmitValues(
  mode: 'create' | 'edit',
  fields: ConnectorFieldDescription[],
  draft: Record<string, string>,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of fields) {
    const raw = draft[field.name] ?? '';
    if (mode === 'edit' && field.type === 'secret' && raw.length === 0) {
      continue;
    }
    values[field.name] = raw;
  }
  return values;
}

export function AccountForm({
  mode,
  fields,
  initialLabel = '',
  initialValues,
  busy = false,
  error = null,
  submitLabel,
  onSubmit,
  onCancel,
}: AccountFormProps) {
  const [label, setLabel] = useState(initialLabel);
  const [values, setValues] = useState(() => seedValues(fields, mode, initialValues));
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setLabel(initialLabel);
    setValues(seedValues(fields, mode, initialValues));
  }, [fields, initialLabel, initialValues, mode]);

  const disabled = busy || submitting;

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedLabel = label.trim();
    if (trimmedLabel.length === 0 || disabled) {
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        label: trimmedLabel,
        values: buildSubmitValues(mode, fields, values),
      });
      setValues((current) => {
        const cleared = { ...current };
        for (const field of fields) {
          if (field.type === 'secret') {
            cleared[field.name] = '';
          }
        }
        return cleared;
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="account-label">Label</Label>
        <Input
          id="account-label"
          name="label"
          value={label}
          onChange={(event) => {
            setLabel(event.target.value);
          }}
          autoComplete="off"
          required
          disabled={disabled}
        />
      </div>

      {fields.map((field) => {
        const inputId = `account-field-${field.name}`;
        const inputType = field.type === 'secret' ? 'password' : 'text';
        return (
          <div key={field.name} className="flex flex-col gap-2">
            <Label htmlFor={inputId}>{field.label}</Label>
            <Input
              id={inputId}
              name={field.name}
              type={inputType}
              value={values[field.name] ?? ''}
              onChange={(event) => {
                const nextValue = event.target.value;
                setValues((current) => ({ ...current, [field.name]: nextValue }));
              }}
              autoComplete="off"
              required={field.required && !(mode === 'edit' && field.type === 'secret')}
              disabled={disabled}
            />
          </div>
        );
      })}

      {error !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        {onCancel !== undefined ? (
          <Button type="button" variant="outline" disabled={disabled} onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" disabled={disabled || label.trim().length === 0}>
          {submitLabel ?? (mode === 'create' ? 'Create' : 'Save')}
        </Button>
      </div>
    </form>
  );
}
