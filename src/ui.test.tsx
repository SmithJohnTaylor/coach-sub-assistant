// @vitest-environment jsdom
/**
 * Sideline simulation through the real screens: taps buttons like a coach would,
 * with a fake wall clock and an in-memory IndexedDB.
 */
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { db } from './db';
import { parseRosterFile } from './roster';
import { GUIDE_URL } from './screens/Teams';

const SEC = 1000;
const MIN = 60 * SEC;

function nav(hash: string) {
  act(() => {
    location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

/** Move the wall clock forward, then "wake the phone" so the screen catches up. */
function advance(ms: number) {
  vi.setSystemTime(Date.now() + ms);
  act(() => document.dispatchEvent(new Event('visibilitychange')));
}

function button(root: ParentNode, text: string | RegExp): HTMLElement {
  const all = [...root.querySelectorAll<HTMLElement>('button, a')];
  const hit = all.find((b) => (typeof text === 'string' ? b.textContent?.trim() === text : text.test(b.textContent ?? '')));
  if (!hit) throw new Error(`no button "${text}". Have: ${all.map((b) => b.textContent?.trim()).join(' | ')}`);
  return hit;
}

async function tap(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

const slotOf = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('.slot')].find((s) => s.querySelector('.pname')?.textContent === name);
const benchOf = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('.bench-card')].find((s) => s.querySelector('.pname')?.textContent === name);

async function onField(name: string) {
  await waitFor(() => expect(slotOf(name), `${name} should be on the field`).toBeTruthy());
  return slotOf(name)!;
}
async function onBench(name: string) {
  await waitFor(() => expect(benchOf(name), `${name} should be on the bench`).toBeTruthy());
  return benchOf(name)!;
}
async function sees(text: string | RegExp) {
  await waitFor(() => expect(document.body.textContent).toMatch(text));
}
const clock = () => document.querySelector('.clock')?.textContent;

/** Name → Total cell from whatever time table is showing. */
function tableTotals(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tr of document.querySelectorAll('table.times tbody tr')) {
    const name = tr.querySelector('td div')!.textContent!;
    out[name] = tr.querySelector('strong')!.textContent!;
  }
  return out;
}

const ROSTER = ['Ava', 'Ben', 'Cal', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo'];

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-27T09:00:00'));
  window.confirm = vi.fn(() => true);
  await db.delete();
  await db.open();
  location.hash = '#/';
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function createTeamAndRoster() {
  const { container } = render(<App />);
  await sees('Create your team');
  const teamName = container.querySelector<HTMLInputElement>('input[placeholder="Team name"]')!;
  fireEvent.change(teamName, { target: { value: 'Tigers' } });
  await tap(button(container, 'Add team'));
  await sees('Roster (0)');
  for (const name of ROSTER) {
    const input = container.querySelector<HTMLInputElement>('input[placeholder="Player name"]')!;
    fireEvent.change(input, { target: { value: name } });
    await tap(button(container, 'Add'));
    await waitFor(() => expect(input.value).toBe(''));
  }
  await sees(`Roster (${ROSTER.length})`);
  return container;
}

describe('home screen', () => {
  it('first visit shows the welcome page; it gives way to the team list once a team exists', async () => {
    const { container } = render(<App />);
    await sees('Fair playing time, tracked from the sideline');
    await sees('Create your team');
    await sees('Add it to your home screen');
    const guides = [...container.querySelectorAll('a')].filter((a) => a.getAttribute('href') === GUIDE_URL);
    expect(guides.map((a) => a.textContent)).toEqual(['Guide', 'Read the full guide ›']);
    expect(guides.every((a) => a.target === '_blank')).toBe(true);

    fireEvent.change(container.querySelector('input[placeholder="Team name"]')!, { target: { value: 'Tigers' } });
    await tap(button(container, 'Add team'));
    await sees('Roster (0)');
    nav('#/');
    await sees('Tigers');
    expect(document.body.textContent).not.toContain('Fair playing time');
    expect(document.body.textContent).toContain('New team');
    expect(button(container, 'Guide').getAttribute('href')).toBe(GUIDE_URL);
  });
});

describe('game day, tapped through the real screens', () => {
  it('7v7: setup, subs, swap, undo, halftime, late arrival, reload, full time, summary, season', async () => {
    let container = await createTeamAndRoster();

    // --- Game setup: Jo is absent, auto-fill the lineup.
    await tap(button(container, 'New game'));
    await sees("Who's here (10/10)");
    fireEvent.change(container.querySelector('input[placeholder="Opponent (optional)"]')!, { target: { value: 'Lions' } });
    await tap(button(container, 'Jo'));
    await sees("Who's here (9/10)");
    // 7v7 defaults to two 30-minute halves; this league plays 25.
    const minutes = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    expect(minutes.value).toBe('30');
    expect(container.querySelector<HTMLSelectElement>('select')!.value).toBe('2');
    fireEvent.change(minutes, { target: { value: '25' } });
    await tap(button(container, 'Auto-fill'));
    await sees('Starting lineup (7/7)');
    await tap(button(container, 'Start game'));

    // --- Kickoff.
    await onField('Ava');
    expect(document.body.textContent).toContain('Tap Start at kickoff');
    await tap(button(container, 'Start'));
    await sees('Pause');
    advance(8 * MIN);
    await waitFor(() => expect(clock()).toBe('8:00'));

    // Bench-first sub: Hal in for Gus at 8:00.
    await tap(await onBench('Hal'));
    await sees('Tap a spot on the field to put Hal in');
    await tap(await onField('Gus'));
    await sees('Hal in for Gus');
    await onBench('Gus');

    // Position swap at 12:00: Ava (GK) <-> Ben (DEF).
    advance(4 * MIN);
    await tap(await onField('Ava'));
    await tap(await onField('Ben'));
    await sees('Swapped Ava ↔ Ben');
    await waitFor(() => expect(slotOf('Ben')!.querySelector('.pos')!.textContent).toBe('GK'));

    // Wrong sub at 13:00, undone, then done field-first.
    advance(1 * MIN);
    await tap(await onBench('Ivy'));
    await tap(await onField('Dee'));
    await onBench('Dee');
    await tap(button(container, /Undo: Ivy in/));
    await sees('Undid: Ivy in');
    await onField('Dee');
    await tap(await onField('Dee'));
    await sees('Tap a bench player to sub for Dee');
    await tap(await onBench('Ivy'));
    await onBench('Dee');

    // Goals: Tigers score, then a mis-tap for Lions is undone.
    const score = () => [...document.querySelectorAll('.score-bar .score')].map((n) => n.textContent);
    expect(score()).toEqual(['0', '0']);
    const goalFor = (team: string) => container.querySelector<HTMLElement>(`[aria-label="Goal ${team}"]`)!;
    await tap(goalFor('Tigers'));
    await sees('Goal Tigers! 1–0');
    await tap(goalFor('Lions'));
    await waitFor(() => expect(score()).toEqual(['1', '1']));
    await tap(button(container, /Undo: their goal/));
    await waitFor(() => expect(score()).toEqual(['1', '0']));

    // Half runs 30 seconds long; clock shows stoppage.
    advance(12 * MIN + 30 * SEC);
    await waitFor(() => expect(clock()).toBe('25:00 +0:30'));

    // Fair-share colors at 25:30: target = 25.5 × 7 / 9 ≈ 19.8 min.
    expect(benchOf('Dee')!.className).toContain('low'); // 13:00
    expect(slotOf('Ivy')!.className).toContain('low'); // 12:30
    expect(slotOf('Cal')!.className).toContain('high'); // 25:30
    expect(benchOf('Gus')!.className).toContain('low'); // 8:00

    await tap(button(container, 'End period'));
    expect(window.confirm).toHaveBeenCalledWith('End 1st half?');
    await sees('2nd half');
    await sees('Clock paused');

    // Halftime: 10 minutes pass, nothing counts. Late arrival and halftime subs.
    advance(10 * MIN);
    expect(clock()).toBe('0:00');
    await tap(button(container, '+ Late arrival'));
    await tap(button(container, '+ Jo'));
    await sees('Jo added to bench');
    await tap(await onBench('Jo'));
    await tap(await onField('Fay'));
    await tap(await onBench('Gus'));
    await tap(await onField('Hal'));
    await onBench('Hal');

    await tap(button(container, 'Start'));
    await sees('Pause');

    // Phone dies / app is closed for 10 minutes mid-half, then reopened.
    cleanup();
    advance(10 * MIN);
    container = render(<App />).container;
    await onField('Jo');
    await waitFor(() => expect(clock()).toBe('10:00'));
    await sees('Pause');

    advance(15 * MIN);
    await waitFor(() => expect(clock()).toBe('25:00'));
    await tap(button(container, 'End game'));
    expect(window.confirm).toHaveBeenLastCalledWith('End the game?');
    await sees('Full time');
    await tap(button(container, 'Save game'));

    // --- Summary.
    await sees('Share summary');
    await sees('Tigers 1–0 Lions');
    await sees('10 players');
    expect(tableTotals()).toEqual({
      Ava: '50:30',
      Ben: '50:30',
      Cal: '50:30',
      Eli: '50:30',
      Ivy: '37:30',
      Gus: '33:00',
      Fay: '25:30',
      Jo: '25:00',
      Hal: '17:30',
      Dee: '13:00',
    });

    // --- Season: one completed game, everybody GP 1.
    nav('#/team/1/season');
    await sees('1 completed game');
    await waitFor(() => expect(Object.keys(tableTotals())).toHaveLength(10));
    expect(tableTotals().Ivy).toBe('37:30');

    // --- Two days later: reopen the saved game and undo the final whistle.
    advance(2 * 24 * 60 * MIN);
    nav('#/game/1');
    await sees('Reopen game');
    await tap(button(container, 'Reopen game'));
    await sees('Full time');
    await tap(button(container, /Undo: end of period/));
    await sees('Clock paused where it stopped');
    await sees('2nd half');
    expect(clock()).toBe('25:00');
    advance(30 * MIN);
    expect(clock()).toBe('25:00');
    await tap(button(container, 'Table'));
    await waitFor(() => expect(tableTotals().Ava).toBe('50:30'));
    await tap(button(container, 'Field'));
    await tap(button(container, 'End game'));
    await sees('Full time');
    await tap(button(container, 'Save game'));
    await sees('Share summary');
    expect(tableTotals().Ava).toBe('50:30');
    expect(tableTotals().Jo).toBe('25:00');
  });

  it('a game can be discarded and a new one started', async () => {
    const container = await createTeamAndRoster();
    await tap(button(container, 'New game'));
    await sees("Who's here");
    await tap(button(container, 'Auto-fill'));
    await tap(button(container, 'Start game'));
    await onField('Ava');
    await tap(button(container, 'Start'));
    advance(5 * MIN);
    await tap(button(container, 'Discard game'));
    await sees('No games yet.');
    expect(await db.games.count()).toBe(0);
    expect(await db.events.count()).toBe(0);
    await sees('New game');
    // An old link to the discarded game explains itself instead of going blank.
    nav('#/game/1');
    await sees('Game not found.');
  });

  it('11v11 with a short bench: every spot renders and subs work', async () => {
    const { container } = render(<App />);
    await sees('Create your team');
    fireEvent.change(container.querySelector('input[placeholder="Team name"]')!, { target: { value: 'Big' } });
    fireEvent.change(container.querySelector('select')!, { target: { value: '11v11' } });
    await tap(button(container, 'Add team'));
    await sees('Roster (0)');
    const names = Array.from({ length: 13 }, (_, i) => `P${String(i + 1).padStart(2, '0')}`);
    for (const name of names) {
      const input = container.querySelector<HTMLInputElement>('input[placeholder="Player name"]')!;
      fireEvent.change(input, { target: { value: name } });
      await tap(button(container, 'Add'));
      await waitFor(() => expect(input.value).toBe(''));
    }
    await tap(button(container, 'New game'));
    await sees("Who's here (13/13)");
    await tap(button(container, 'Auto-fill'));
    await sees('Starting lineup (11/11)');
    await tap(button(container, 'Start game'));
    await onField('P11');
    expect(document.querySelectorAll('.slot')).toHaveLength(11);
    await sees('Bench (2)');
    await tap(button(container, 'Start'));
    advance(20 * MIN);
    await tap(await onBench('P12'));
    await tap(await onField('P05'));
    await onBench('P05');
    advance(15 * MIN);
    await waitFor(() => expect(clock()).toBe('35:00'));
  });
});

describe('sharing a roster with another coach', () => {
  // jsdom's Blob lacks text(); every browser the app runs in has it.
  Blob.prototype.text ??= function (this: Blob) {
    return new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.readAsText(this);
    });
  };

  it("exports the team, and the other coach's phone imports it as a new team", async () => {
    let container = await createTeamAndRoster();
    // Jersey number for one kid; the format comes along too.
    await tap(button(container, 'Edit'));
    fireEvent.change(container.querySelector('input[placeholder="#"]')!, { target: { value: '7' } });
    await tap(button(container, 'Save'));
    await sees('#7 Ava');

    // No share sheet in this browser, so the file downloads.
    let saved: Blob | undefined;
    URL.createObjectURL = vi.fn((b: Blob) => ((saved = b), 'blob:roster'));
    URL.revokeObjectURL = vi.fn();
    await tap(button(container, 'Share roster'));
    await sees('Saved tigers-roster.json');
    const json = await saved!.text();
    expect(json).not.toMatch(/teamId|"id"/);

    // The other coach's phone: nothing on it yet.
    cleanup();
    await db.delete();
    await db.open();
    location.hash = '#/';
    container = render(<App />).container;
    await sees('Create your team');
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File([json], 'tigers-roster.json')] } });
    });
    await sees(`Roster (${ROSTER.length})`);
    await sees('#7 Ava');
    const team = (await db.teams.toArray())[0];
    expect(team).toMatchObject({ name: 'Tigers', format: '7v7' });
    expect(team.slots).toHaveLength(7);

    // A file that isn't a roster says so and adds nothing.
    nav('#/');
    await sees('Import a team from a roster file');
    const input2 = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await act(async () => {
      fireEvent.change(input2, { target: { files: [new File(['Player,Number\nAva,7'], 'playing-time.csv')] } });
    });
    await sees("That file isn't a Sub Assistant roster.");
    expect(await db.teams.count()).toBe(1);
  });

  it('rejects files that are not quite rosters', () => {
    const ok = { app: 'sub-assistant-roster', v: 1, team: { name: 'Tigers', format: '5v5', slots: ['GK', 'DEF', 'DEF', 'FWD', 'FWD'] }, players: [{ name: ' Ava ', number: '7' }] };
    const parse = (x: unknown) => () => parseRosterFile(JSON.stringify(x));
    expect(parse(ok)()).toEqual({ ...ok, players: [{ name: 'Ava', number: '7' }] });
    // Edited positions mean a custom formation.
    expect(parse({ ...ok, team: { ...ok.team, slots: ['GK', 'MID'] } })().team.format).toBe('custom');
    expect(parse({ ...ok, v: 2 })).toThrow('newer version');
    for (const bad of [
      null,
      [],
      { ...ok, app: 'other' },
      { ...ok, team: { ...ok.team, name: '  ' } },
      { ...ok, team: { ...ok.team, slots: ['GK', 'STRIKER'] } },
      { ...ok, team: { ...ok.team, slots: [] } },
      { ...ok, players: [{ number: '7' }] },
      { ...ok, players: 'Ava' },
    ]) {
      expect(parse(bad), JSON.stringify(bad)).toThrow("isn't a Sub Assistant roster");
    }
    expect(() => parseRosterFile('not json')).toThrow("isn't a Sub Assistant roster");
  });
});
