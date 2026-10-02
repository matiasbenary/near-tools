'use client';

import { ChangeEvent, KeyboardEvent, useState } from 'react';

/**
 * Props for a number <input> that only ever holds a non-negative decimal.
 * `min` alone only affects the spinner; typing or pasting "-5" or "1e3" still works.
 */
export const nonNegative = (onChange: (value: string) => void) => ({
  min: '0',
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
    if (['-', '+', 'e', 'E'].includes(event.key)) event.preventDefault();
  },
  onChange: (event: ChangeEvent<HTMLInputElement>) => {
    if (/^\d*\.?\d*$/.test(event.target.value)) onChange(event.target.value);
  },
});

type Errors<F> = Partial<Record<keyof F, string>>;

/**
 * Form state for one action: values, per-field errors, and a `bind` that wires a
 * field to both. Validation reports every problem at once and focuses the first.
 */
export function useForm<F extends Record<string, string>>(initial: F) {
  const [fields, setFields] = useState(initial);
  const [errors, setErrors] = useState<Errors<F>>({});

  const set = (key: keyof F, value: string) => {
    setFields((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const bind = (key: keyof F & string) => ({
    id: key,
    value: fields[key],
    error: errors[key],
    onChange: (value: string) => set(key, value),
  });

  /** True when `found` is empty; otherwise shows the errors and focuses the first. */
  const check = (found: Errors<F>) => {
    setErrors(found);
    const first = Object.keys(found)[0];
    if (first) document.getElementById(first)?.focus();
    return !first;
  };

  const dirty = (Object.keys(initial) as (keyof F)[]).some((key) => fields[key] !== initial[key]);
  const reset = () => {
    setFields(initial);
    setErrors({});
  };

  return { fields, errors, set, bind, check, dirty, reset };
}

export function Field({
  id,
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  hint,
  error,
  required = false,
  min,
  max,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'number' | 'textarea';
  placeholder?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  min?: string;
  max?: string;
}) {
  const input = {
    id,
    value,
    placeholder,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${id}-error` : hint ? `${id}-hint` : undefined,
  };
  return (
    <label className={`wizard-field${type === 'textarea' ? ' wizard-field-wide' : ''}`} htmlFor={id}>
      <span>
        {label}
        {!required && <em className="optional"> (optional)</em>}
      </span>
      {type === 'textarea' ? (
        <textarea {...input} rows={4} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input
          {...input}
          type={type}
          max={max}
          {...(type === 'number'
            ? { ...nonNegative(onChange), min: min ?? '0' }
            : {
                min,
                onChange: (event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value),
              })}
        />
      )}
      <FieldMessage id={id} error={error} hint={hint} />
    </label>
  );
}

function FieldMessage({ id, error, hint }: { id: string; error?: string; hint?: string }) {
  if (error)
    return (
      <small className="field-error" id={`${id}-error`}>
        {error}
      </small>
    );
  return hint ? <small id={`${id}-hint`}>{hint}</small> : null;
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/svg+xml'];

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.readAsDataURL(file);
  });

/** Fit the encoded icon within the on-chain budget, including base64 overhead. */
async function shrinkIcon(file: File, maxBytes: number, maxDimension: number): Promise<string> {
  const original = await readAsDataUrl(file);
  if (original.length <= maxBytes) return original;

  const image = new Image();
  image.src = original;
  await image.decode();
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not resize that image.');
  const ratio = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  let width = Math.max(1, Math.round(image.naturalWidth * ratio));
  let height = Math.max(1, Math.round(image.naturalHeight * ratio));
  while (true) {
    canvas.width = width;
    canvas.height = height;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, width, height);
    for (const quality of [0.85, 0.65, 0.45]) {
      const compressed = canvas.toDataURL('image/webp', quality);
      if (compressed.length <= maxBytes) return compressed;
    }
    if (Math.max(width, height) <= 16) break;
    width = Math.max(1, Math.floor(width * 0.75));
    height = Math.max(1, Math.floor(height * 0.75));
  }
  throw new Error('Could not shrink that image enough. Try a simpler icon.');
}

/** An image picked from disk, optionally compressed before storing its data URL. */
export function ImageField({
  id,
  label,
  value,
  onChange,
  maxBytes,
  resizeTo,
  hint,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (dataUrl: string) => void;
  maxBytes: number;
  resizeTo?: number;
  hint: string;
  error?: string;
}) {
  const [pickError, setPickError] = useState('');
  const [processing, setProcessing] = useState(false);

  const pick = async (file: File | undefined) => {
    setPickError('');
    if (!file) return onChange('');
    if (!IMAGE_TYPES.includes(file.type)) return setPickError('Use a PNG, JPEG, GIF or SVG image.');
    if (!resizeTo && file.size > maxBytes)
      return setPickError(
        `That image is ${Math.round(file.size / 1024)} KB. The limit is ${Math.round(maxBytes / 1024)} KB.`
      );
    onChange('');
    setProcessing(true);
    try {
      onChange(resizeTo ? await shrinkIcon(file, maxBytes, resizeTo) : await readAsDataUrl(file));
    } catch {
      setPickError('Could not process that image. Try a different or simpler icon.');
    } finally {
      setProcessing(false);
    }
  };

  const shownError = pickError || error;
  return (
    <label className="wizard-field wizard-field-wide" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type="file"
        disabled={processing}
        accept={IMAGE_TYPES.join(',')}
        aria-invalid={shownError ? true : undefined}
        aria-describedby={shownError ? `${id}-error` : `${id}-hint`}
        onChange={(event) => pick(event.target.files?.[0])}
      />
      <FieldMessage id={id} error={shownError} hint={processing ? 'Optimizing image…' : hint} />
      {value && (
        <span className="image-preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="Preview of the image you selected" />
        </span>
      )}
    </label>
  );
}
