import qrcode from 'qrcode-generator';
import { useMemo, useState } from 'react';
import type { ShareState } from '../live/hooks';

/** The coach's sharing status, under the clock. */
export function ShareStatus({ state, onLink, onStop }: { state: ShareState; onLink: () => void; onStop: () => void }) {
  const text =
    state.status === 'open'
      ? `Live · ${state.watchers === 0 ? 'no one watching yet' : `${state.watchers} watching`}`
      : state.status === 'offline'
        ? 'No signal · watchers catch up when it returns'
        : 'Connecting…';
  return (
    <div className={`live-status ${state.status}`}>
      {state.status === 'open' && <span className="dot" />}
      <span className="grow">{text}</span>
      <button className="link" onClick={onLink}>
        Link
      </button>
      <button className="link danger-text" onClick={onStop}>
        Stop
      </button>
    </div>
  );
}

/** Bottom sheet with the watch link as a QR code, plus copy / share buttons. */
export function ShareSheet({ url, onClose }: { url: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      /* clipboard blocked; the link is on screen to select by hand */
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label="Share live view" onClick={(e) => e.stopPropagation()}>
        <h2>Share live view</h2>
        <p className="small muted">
          Another coach can scan this to watch the game from their phone: lineup, clock, and minutes. They can't change
          anything. The link stops working when you tap Stop, or a day after the last change.
        </p>
        <QrCode text={url} />
        <p className="share-url small">{url}</p>
        <div className="actions">
          {'share' in navigator && (
            <button onClick={() => navigator.share({ title: 'Live game', url }).catch(() => {})}>Send link</button>
          )}
          <button onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/** QR code as one SVG path. Always dark-on-white, since scanners struggle with inverted codes. */
function QrCode({ text }: { text: string }) {
  const { size, d } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const size = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return { size, d };
  }, [text]);
  return (
    <svg className="qr" viewBox={`-4 -4 ${size + 8} ${size + 8}`} role="img" aria-label="QR code for the watch link">
      <rect x={-4} y={-4} width={size + 8} height={size + 8} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

/** The watcher's connection status, under the clock. */
export function WatchStatus({
  status,
  ownerOnline,
  lastUpdate,
}: {
  status: string;
  ownerOnline: boolean;
  lastUpdate: string;
}) {
  if (status !== 'open') {
    return (
      <div className="live-status offline">
        <span className="grow">No signal · reconnecting…</span>
      </div>
    );
  }
  if (!ownerOnline) {
    return (
      <div className="live-status offline">
        <span className="grow">Coach's phone is offline · last update {lastUpdate}</span>
      </div>
    );
  }
  return (
    <div className="live-status open">
      <span className="dot" />
      <span className="grow">Watching live</span>
    </div>
  );
}
