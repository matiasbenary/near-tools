'use client';
import { useMemo, useState } from 'react';
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  SortingFn,
  SortingState,
  useReactTable,
} from '@tanstack/react-table';
import { apyLabel, apyNum, Validator } from '@/lib/staking';
import { NetworkConfig } from '@/config';
import { useNetwork } from '@/components/app-providers';

type Props = {
  validators: Validator[];
  selected: string;
  busy: boolean;
  baseApy: number | null;
  fees: Record<string, number>;
  error: string;
  onRetry: () => void;
  onSelect: (id: string) => void;
};

const unavailable = 'n/a';

const numericSort: SortingFn<Validator> = (rowA, rowB, columnId) => {
  const a = Number(rowA.getValue(columnId));
  const b = Number(rowB.getValue(columnId));
  return (Number.isFinite(a) ? a : -Infinity) - (Number.isFinite(b) ? b : -Infinity);
};

export function ValidatorList({
  validators,
  selected,
  busy,
  baseApy,
  fees,
  error,
  onRetry,
  onSelect,
}: Props) {
  const { network } = useNetwork();
  const [sorting, setSorting] = useState<SortingState>([{ id: 'apy', desc: true }]);
  const [search, setSearch] = useState('');
  const liquidValidators = useMemo(() => validators.filter((validator) => validator.liquid), [validators]);
  const directValidators = useMemo(
    () =>
      validators.filter(
        (validator) =>
          !validator.liquid &&
          // testnet ships no metrics, so filtering on them would empty the list
          (network === 'testnet' ||
            (validator.uptime !== undefined && apyNum(baseApy, fees[validator.id]) > 0))
      ),
    [validators, baseApy, fees, network]
  );

  const columns = useMemo<ColumnDef<Validator>[]>(
    () => [
      { id: 'pool', accessorFn: (validator) => validator.id, header: 'Pool' },
      {
        id: 'apy',
        accessorFn: (validator) => apyNum(baseApy, fees[validator.id]),
        header: 'Est. APY',
        sortingFn: numericSort,
      },
      {
        id: 'uptime',
        accessorFn: (validator) => validator.uptime ?? -1,
        header: 'Uptime',
        sortingFn: numericSort,
      },
      {
        id: 'fee',
        accessorFn: (validator) => fees[validator.id] ?? -1,
        header: 'Fee',
        sortingFn: numericSort,
      },
      {
        id: 'stakePercent',
        accessorFn: (validator) => validator.stakePercent ?? -1,
        header: 'Stake %',
        sortingFn: numericSort,
      },
    ],
    [baseApy, fees]
  );

  const query = search.trim().toLowerCase();
  const shownValidators = useMemo(
    () => (query ? directValidators.filter((v) => v.id.toLowerCase().includes(query)) : directValidators),
    [directValidators, query]
  );

  const table = useReactTable({
    data: shownValidators,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const renderRow = (validator: Validator) => {
    const select = () => {
      if (!busy) onSelect(validator.id);
    };

    return (
    <tr
      key={validator.id}
      className={validator.id === selected ? 'active' : ''}
      role="radio"
      aria-checked={validator.id === selected}
      tabIndex={busy ? -1 : validator.id === selected ? 0 : -1}
      onClick={select}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          select();
        }
      }}
    >
      <td>
        <span className="validator-name">{validator.id}</span>
      </td>
      <td>{apyLabel(baseApy, fees[validator.id])}</td>
      <td>{validator.uptime !== undefined ? `${validator.uptime.toFixed(1)}%` : unavailable}</td>
      <td>{fees[validator.id] !== undefined ? `${(fees[validator.id] * 100).toFixed(1)}%` : unavailable}</td>
      <td>{validator.stakePercent !== undefined ? `${validator.stakePercent.toFixed(2)}%` : unavailable}</td>
    </tr>
    );
  };

  return (
    <div className="card validator-card">
      {liquidValidators.length > 0 && (
        <section className="liquid-pools-section">
          <h2>Liquid Staking</h2>
          <div className="liquid-pools" aria-label="Liquid pools">
            {liquidValidators.map((validator) => (
              <button
                key={validator.id}
                className={`liquid-pool${validator.id === selected ? ' active' : ''}`}
                disabled={busy}
                onClick={() => onSelect(validator.id)}
              >
                <span>
                  {validator.id}
                  <span className="badge">Liquid</span>
                </span>
                <span>Est. {apyLabel(baseApy, fees[validator.id])} APY</span>
              </button>
            ))}
          </div>
        </section>
      )}
      <div className="validator-heading">
        <div>
          <h2>Validators</h2>
          <p className="meta" role="status">
            {shownValidators.length} of {directValidators.length} shown
          </p>
        </div>
        <label className="validator-search">
          <span className="sr-only">Search validators</span>
          <input
            type="search"
            value={search}
            placeholder="Search pools…"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>
      <div className="validator-table-wrap">
        <table className="validator-table">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={
                      header.column.getIsSorted() === 'asc'
                        ? 'ascending'
                        : header.column.getIsSorted() === 'desc'
                          ? 'descending'
                          : 'none'
                    }
                  >
                    <button
                      className="table-sort"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      <span aria-hidden="true">
                        {header.column.getIsSorted() === 'asc'
                          ? ' ↑'
                          : header.column.getIsSorted() === 'desc'
                            ? ' ↓'
                            : ''}
                      </span>
                    </button>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody role="radiogroup" aria-label="Validator">
            {table.getRowModel().rows.map((row) => renderRow(row.original))}
          </tbody>
        </table>
        {error ? (
          <div className="validator-load-error">
            <p className="hint error">{error}</p>
            <button className="btn" disabled={busy} onClick={onRetry}>
              Retry loading validators
            </button>
          </div>
        ) : validators.length === 0 ? (
          <p className="hint">Loading validators…</p>
        ) : null}
        {validators.length > 0 && directValidators.length === 0 && (
          <p className="hint">No validators with a positive net APY are available.</p>
        )}
        {directValidators.length > 0 && shownValidators.length === 0 && (
          <p className="hint">No pool matches “{search}”.</p>
        )}
      </div>
      <p className="hint">
        Find more information on validators at{' '}
        <a
          className="validator-info-link"
          href={NetworkConfig[network].explorerUrl}
          target="_blank"
          rel="noreferrer"
        >
          NearBlocks
        </a>
        .
      </p>
    </div>
  );
}
