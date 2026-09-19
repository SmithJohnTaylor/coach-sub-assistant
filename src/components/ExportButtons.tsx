import { useState } from 'react';
import { downloadFile, shareText, slug, toCsv, toText } from '../export';
import type { PlayerLine } from '../stats';

export function ExportButtons({ title, lines, perGame }: { title: string; lines: PlayerLine[]; perGame: boolean }) {
  const [msg, setMsg] = useState<string | null>(null);

  async function share() {
    const result = await shareText(title, toText(title, lines, { perGame }));
    if (result === 'copied') {
      setMsg('Copied to clipboard');
      setTimeout(() => setMsg(null), 2500);
    }
  }

  return (
    <div className="actions">
      <button className="primary" onClick={share}>
        Share summary
      </button>
      <button onClick={() => downloadFile(`${slug(title)}.csv`, toCsv(lines, { perGame }))}>Download CSV</button>
      {msg && <span className="muted small">{msg}</span>}
    </div>
  );
}
