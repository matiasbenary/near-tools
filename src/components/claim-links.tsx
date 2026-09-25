'use client';

import { useState } from 'react';

const downloadText = (lines: string[]) => {
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `linkdrop-${Date.now()}.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
};

/**
 * The link is the secret. It is shown in "Your drops" as well as right after
 * funding, because a reload used to lose every link the browser had just been handed.
 */
export function ClaimLinks({ links, download = false }: { links: string[]; download?: boolean }) {
  const [copied, setCopied] = useState(-1);
  if (links.length === 0) return null;

  const copy = (link: string, index: number) =>
    navigator.clipboard.writeText(link).then(
      () => {
        setCopied(index);
        setTimeout(() => setCopied(-1), 2000);
      },
      () => setCopied(-1)
    );

  const list = (
    <ul className="holdings-links">
      {links.map((link, index) => (
        <li key={link}>
          <button className="btn btn-ghost" onClick={() => copy(link, index)}>
            {copied === index ? 'Copied' : `Copy ${links.length > 1 ? `#${index + 1}` : 'link'}`}
          </button>
        </li>
      ))}
    </ul>
  );

  if (!download) return list;
  return (
    <div className="claim-links">
      <button className="btn btn-ghost" onClick={() => downloadText(links)}>
        Download {links.length} claim link{links.length > 1 ? 's' : ''}
      </button>
      {list}
    </div>
  );
}
