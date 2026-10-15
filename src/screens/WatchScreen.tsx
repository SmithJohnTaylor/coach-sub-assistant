import { useMemo } from 'react';
import { Header } from '../components/Header';
import { WatchStatus } from '../components/LiveShare';
import { useNow } from '../hooks';
import { fromSnapshot } from '../live/client';
import { useWatch } from '../live/hooks';
import { href } from '../router';
import { LiveGame } from './LiveGame';

/** Another coach's game, read-only, kept up to date over the relay. Nothing is saved here. */
export function WatchScreen({ shareId }: { shareId: string }) {
  const w = useWatch(shareId);
  const view = useMemo(() => (w.snap ? fromSnapshot(w.snap) : null), [w.snap]);
  // Only needed to age the "last update" label while the coach's phone is offline.
  const now = useNow(!w.ownerOnline && view != null, 15_000);

  if (w.status === 'ended') {
    return <Message title="Live game" text="This game isn't being shared anymore, or the link is incomplete." />;
  }
  if (!view || !w.snap) {
    const text =
      w.status === 'offline'
        ? 'No signal. Trying again…'
        : w.waiting
          ? "Waiting for the coach's phone to send the game…"
          : 'Connecting…';
    return <Message title="Live game" text={text} />;
  }

  return (
    <LiveGame
      {...view}
      readOnly
      clockOffset={w.offset - w.snap.clockOffset}
      statusBar={
        <WatchStatus status={w.status} ownerOnline={w.ownerOnline} lastUpdate={ago(now + w.offset - w.at)} />
      }
    />
  );
}

function Message({ title, text }: { title: string; text: string }) {
  return (
    <>
      <Header title={title} back={href.home()} />
      <main>
        <p className="muted center">{text}</p>
      </main>
    </>
  );
}

function ago(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)} h ago`;
}
