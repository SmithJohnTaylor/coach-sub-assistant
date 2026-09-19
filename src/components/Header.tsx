import type { ReactNode } from 'react';

export function Header({ title, back, right }: { title: ReactNode; back?: string; right?: ReactNode }) {
  return (
    <header className="topbar">
      {back ? (
        <a className="back" href={back} aria-label="Back">
          ‹
        </a>
      ) : (
        <span className="back-spacer" />
      )}
      <h1>{title}</h1>
      <div className="topbar-right">{right}</div>
    </header>
  );
}
