import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'team'; teamId: number }
  | { name: 'newGame'; teamId: number }
  | { name: 'game'; gameId: number }
  | { name: 'season'; teamId: number };

export function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const id = Number(parts[1]);
  if (parts[0] === 'team' && id) {
    if (parts[2] === 'new-game') return { name: 'newGame', teamId: id };
    if (parts[2] === 'season') return { name: 'season', teamId: id };
    return { name: 'team', teamId: id };
  }
  if (parts[0] === 'game' && id) return { name: 'game', gameId: id };
  return { name: 'home' };
}

export const href = {
  home: () => '#/',
  team: (id: number) => `#/team/${id}`,
  newGame: (id: number) => `#/team/${id}/new-game`,
  season: (id: number) => `#/team/${id}/season`,
  game: (id: number) => `#/game/${id}`,
};

export function go(to: string, replace = false): void {
  if (replace) location.replace(to);
  else location.hash = to;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(location.hash));
  useEffect(() => {
    const on = () => {
      setRoute(parse(location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
