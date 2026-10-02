'use client';

import { nonNegative } from '@/components/actions/form-fields';

export function AmountInput({
  amount,
  setAmount,
  maxAmount,
  unit,
  busy,
  ariaLabel,
  overMax = false,
  disabled = false,
}: {
  amount: string;
  setAmount: (amount: string) => void;
  maxAmount: string;
  unit: string;
  busy: boolean;
  ariaLabel: string;
  overMax?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className={`amount${overMax ? ' over' : ''}`}>
      <input
        disabled={busy || disabled}
        type="number"
        placeholder="0.0"
        value={amount}
        {...nonNegative(setAmount)}
        aria-label={ariaLabel}
      />
      <button className="max" disabled={busy || disabled} onClick={() => setAmount(maxAmount)}>
        MAX
      </button>
      <span className="unit">{unit}</span>
    </div>
  );
}
