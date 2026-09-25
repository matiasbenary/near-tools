/**
 * One vocabulary for every failure the user can hit, so a cancelled signature
 * never reads like a crash and a raw RPC blob never reaches the interface.
 */

export type ErrorKind =
  | 'cancelled'
  | 'insufficient-balance'
  | 'network-busy'
  | 'link-spent'
  | 'link-underfunded'
  | 'rejected'
  | 'unknown';

export type DescribedError = {
  kind: ErrorKind;
  /** Shown to the user. */
  message: string;
  /** The raw string, for a "Details" disclosure. Never shown by default. */
  detail: string;
  /** Whether offering a retry makes sense. */
  retryable: boolean;
};

/** The untruncated text, for a "Details" disclosure. */
export const rawError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// ponytail: first line + truncation — RPC errors are multi-line JSON blobs
export const errMsg = (error: unknown) => {
  const s = rawError(error).split('\n')[0];
  return s.length > 160 ? s.slice(0, 160) + '…' : s;
};

const matchers: { kind: ErrorKind; test: RegExp; message: string; retryable: boolean }[] = [
  {
    kind: 'cancelled',
    test: /user (rejected|cancell?ed|closed)|request rejected|denied by the user|closed by user|window closed/i,
    message: 'Cancelled in your wallet. Nothing was sent.',
    retryable: true,
  },
  {
    kind: 'insufficient-balance',
    test: /enough balance|enough funds|insufficient|exceeds the account balance|LackBalanceForState|NotEnoughBalance/i,
    message: 'Not enough balance for this transaction and its fees.',
    retryable: false,
  },
  {
    kind: 'network-busy',
    test: /429|rate.?limit|timeout|timed out|ECONNRESET|fetch failed|Exceeded \d+ providers|503|502|gateway/i,
    message: 'The network is busy. Nothing was lost — try again.',
    retryable: true,
  },
  {
    kind: 'link-underfunded',
    test: /not ?enough ?allowance|not enough gas attached|exceeds the maximum/i,
    message: 'This link cannot pay for its own claim. Ask whoever sent it to top it up.',
    retryable: false,
  },
  {
    kind: 'link-spent',
    test: /Key does not exist|No key found|Drop not found|already been claimed|no drop found/i,
    message: 'This link has already been used, or the drop was deleted.',
    retryable: false,
  },
  {
    kind: 'rejected',
    test: /Smart contract panicked|GuestPanic|MethodNotFound|FunctionCallError|AccountAlreadyExists|deserialize/i,
    message: 'The contract rejected this transaction.',
    retryable: false,
  },
];

export function describeError(error: unknown): DescribedError {
  const detail = errMsg(error);
  const text = rawError(error);
  const hit = matchers.find((m) => m.test.test(text));
  return hit
    ? { kind: hit.kind, message: hit.message, detail, retryable: hit.retryable }
    : {
        kind: 'unknown',
        message: 'Something went wrong. Nothing was charged unless your wallet says otherwise.',
        detail,
        retryable: true,
      };
}
