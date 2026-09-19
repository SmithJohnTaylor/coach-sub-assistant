import { mins } from './timing';
import type { PlayerLine } from './stats';
import { playerLabel } from './stats';
import { POSITIONS } from './types';

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(lines: PlayerLine[], opts: { perGame: boolean }): string {
  const header = ['Player', 'Number', ...(opts.perGame ? ['Games', 'Avg min/game'] : []), 'Total min', ...POSITIONS.map((p) => `${p} min`)];
  const rows = lines.map((l) => [
    l.player.name,
    l.player.number ?? '',
    ...(opts.perGame ? [l.games, l.games ? mins(l.total / l.games) : '0'] : []),
    mins(l.total),
    ...POSITIONS.map((p) => mins(l.byPos[p])),
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}

export function toText(title: string, lines: PlayerLine[], opts: { perGame: boolean }): string {
  const body = lines
    .map((l) => {
      const pos = POSITIONS.filter((p) => l.byPos[p] > 0)
        .map((p) => `${p} ${mins(l.byPos[p])}`)
        .join(', ');
      const avg = opts.perGame && l.games ? ` (${l.games} games, avg ${mins(l.total / l.games)})` : '';
      return `${playerLabel(l.player)}: ${mins(l.total)} min${avg}${pos ? ` — ${pos}` : ''}`;
    })
    .join('\n');
  return `${title}\n\n${body}`;
}

export function downloadFile(filename: string, content: string, type = 'text/csv'): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Native share sheet when available; otherwise copy to clipboard. Returns what happened. */
export async function shareText(title: string, text: string): Promise<'shared' | 'copied' | 'cancelled'> {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return 'shared';
    } catch {
      return 'cancelled';
    }
  }
  await navigator.clipboard.writeText(text);
  return 'copied';
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
