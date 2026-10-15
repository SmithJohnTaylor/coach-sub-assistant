# Step 2: two coaches running one game

Status: **planned, not started** (written 2026-10-15).
Step 1, a read-only live view, shipped on 2026-10-15 in commits `666bcdf` and `c75740c`.

The goal: an assistant coach opens a link and can make subs, swaps, clock changes, and undos from their own phone. Those changes count toward minutes exactly as if the head coach had tapped them.

## Where step 1 left things

- The coach's phone **owns** the game. It is the only device that writes it to storage (IndexedDB). While sharing, it sends the whole game (`Snapshot` in `src/live/protocol.ts`) to the relay on every change.
- The relay is `server/src/index.ts`: one Durable Object per share, at `wss://live.subassistant.soccer`. It keeps the latest snapshot and passes it to watchers. The owner proves ownership with a secret key, and only that key's hash is stored.
- Watchers rebuild the screen with the same `replay()` (`src/timing.ts`). They correct for the difference between the two phones' clocks: both phones measure their offset from the server, and the snapshot carries the owner's offset (`ClockSync` in `src/live/client.ts`).
- `LiveGame` has a `readOnly` mode. `WatchScreen` is at `#/watch/<id>`.
- Deploys:
  - The site deploys when you push to `main`.
  - The relay deploys through `.github/workflows/deploy-live.yml` when `server/`, `src/live/protocol.ts` or `src/types.ts` change.
  - The auto-mode permission check blocks Claude from running `wrangler deploy` by hand, so manual deploys are run by the user with `!`.

## The approach: the owner's phone stays the only writer

Earlier I said step 2 needed globally unique IDs, undo recorded as its own event, and server timestamps. That's what it takes for **every** phone to be able to write the game. This plan avoids it:

> Editors don't write the game. They send **commands** ("Dee in for Ben at 14:32") through the relay to the owner's phone. The owner's phone checks each one, saves it as a normal event with the editor's timestamp, and sends out a new snapshot as usual.

**Why this approach:**
- **No database migration.** Event and player ids stay the owner's local numbers, and editors refer to them through the snapshot.
- **No merge logic.** One device puts events in order, so two coaches tapping at once is just two events in time order. `replay()` already handles that.
- **Undo stays simple.** It's still "delete this event" on the owner's phone.
- **Minutes stay accurate under lag.** The command carries the time of the tap, converted into the owner's clock with the offset machinery we already have. A sub that takes 3 seconds to arrive is still recorded at the moment it happened.

**The cost:** editors' changes only take effect while the owner's phone is connected. If it's offline, commands wait on the relay, and the editor sees them applied on their own screen in the meantime (see "Offline" below). They take effect, with their original times, when the owner reconnects. If the owner's phone dies for good, the fix is a "take over" feature (phase 5).

**When to switch to a fully peer-to-peer model** (every phone writes, with globally unique ids): if games regularly run with the owner's phone absent, or if you want no "owner" at all. Nothing in this plan rules that out later.

## Design

### Links and roles
- Sharing creates two links:
  - **Watch:** `#/watch/<id>`, unchanged.
  - **Coach:** `#/coach/<id>/<editKey>`. The edit key is 128 random bits.
- Both live in the URL fragment (the part after `#`), which browsers never send to servers.
- The owner sends `sha256(editKey)` in its `auth` message, and the relay stores only that hash.
- Rotating the edit key revokes coach access without ending the share. The UI for that can wait.
- The share sheet gets two choices: **Watch only**, for parents, and **Can make changes**, for coaches. Each has its own QR code and Send link.

### Protocol (bump `Snapshot.v` to 2)
New messages:

- **Editor → relay:**
  - `{ type: 'auth-coach', editKey, name }`
  - `{ type: 'command', cmd }`
- **Relay → owner:**
  - `{ type: 'commands', cmds }`. All pending commands are sent on owner auth, then each new one as it arrives.
- **Owner → relay:**
  - `{ type: 'ack', ids }`. The relay deletes acknowledged commands from its queue.
- **Snapshot additions:**
  - `applied: string[]`, the ids of the last ~50 commands applied, so editors can clear their pending list;
  - `rejected: { id, reason }[]`;
  - `roster`: everyone on the team, names only, so editors can add late arrivals. Only sent once a coach link exists.
- **Counts:** `watchers` becomes `{ watchers, coaches }`.

A command:
```ts
{ id: string /* uuid */, by: string /* coach's name */, t: number /* owner-clock ms */,
  action: EventInput | { type: 'undo'; eventId: number } | { type: 'addPlayer'; playerId: number } }
```

**Compatibility:** phones keep running the old app version until the PWA updates, so the relay must keep accepting v1 owners and watchers. `isSnapshot` currently requires `v === 1` and must accept both. **Deploy the relay before the app.**

### Owner's phone: applying commands
A pure function, `applyCommand(game, events, cmd, now)`, returns either an event to save or a reason to reject:

- **Timestamp:** keep `t` within the period being played, and no later than `now + 2s`.
- **Subs and swaps:** check the slot index and that the player is present. A player who is already on the field is allowed, because `replay()` moves them.
- **Clock commands:** ignore `start` once the game is finished. Commands that change nothing, such as pausing a paused clock, are dropped quietly.
- **Undo:** only allowed if `eventId` is still the newest event. If someone acted in between, reject it as "Something changed; try again". End period uses the same `undoReplacement` rule as today.
- **Late arrival (`addPlayer`):** adds the player to `game.present`.
- **Owner-only actions:** Save game, Discard, Reopen and Stop sharing are not commands.

Other owner-side changes:
- Saved events get an optional `by?: string`. It isn't indexed, so no schema bump is needed.
- A brief message shows each remote change, e.g. "Coach Sam: Dee in for Ben".
- The Undo label names who made the action: "Undo: Dee in (Sam)".
- Acknowledge each command only after it's saved, so a crash re-delivers it. Commands are processed in arrival order. Duplicates are ignored by command id, because `applied` remembers them.

### Coach's phone (editor)
- New `CoachScreen` at `#/coach/<id>/<key>`. It asks once for a name ("Shown to the other coach"), saved on that phone.
- It reuses `LiveGame` in a new `remote` mode: fully interactive, but `emit()` sends a command instead of calling `addEvent`.
- **Shows its own changes immediately:** it displays `replay(snapshot events + pending commands)`. A pending command is dropped once a snapshot lists its id in `applied` or `rejected`. If rejected, it shows the reason.
- **Pending commands are saved on the phone** under the share id, so a reload with no signal doesn't lose them. They're resent on reconnect, with the same id, so duplicates are harmless.
- **Status bar:**
  - "Coaching · in sync"
  - "2 changes waiting for <owner>'s phone"
  - "No signal · changes will send when back"
- **Hidden from editors:** Save game, Discard, Share.
- End period and End game keep their confirmations.

### Offline cases

| Situation | What happens |
|---|---|
| Editor has no signal | Their phone saves commands and shows them right away. They're sent on reconnect and applied at the original tap times. |
| Owner has no signal | The relay holds commands, and the editor sees "waiting for <owner>'s phone". They're applied when the owner reconnects. |
| Both tap at once | Both events are saved in time order, and the later one wins for that position. Both phones show who did what. |
| Owner's phone dies for good | The game is stuck until phase 5 (take over). |

## Phases

1. **Relay** (about 150 lines plus tests):
   - coach role and edit-key auth;
   - a command queue in Durable Object storage, capped at about 200 commands and 64 KB;
   - forwarding commands to the owner, and removing them on ack;
   - coach counts;
   - v1/v2 compatibility.
   Deploy it on its own; the current app keeps working.
2. **Owner's phone** (about 200 lines):
   - `applyCommand` and its tests;
   - the `by` field;
   - the two-link share sheet;
   - remote-change messages;
   - `roster` and `applied` in the snapshot.
3. **Coach's phone** (about 250 lines):
   - `CoachScreen` with the name prompt;
   - the remote mode in `LiveGame`;
   - the saved pending queue and showing pending changes immediately;
   - undo.
4. **Tests and docs:**
   - A randomized test in the style of `scenarios.test.ts`: two coaches, with random delays and disconnections. It checks that the owner's final state equals `replay()` of every accepted event, and that the editor's screen ends up identical.
   - UI tests with `FakeWebSocket`, as in `src/live.test.tsx`.
   - A README section.
   - A real three-phone test before merging.
5. **Later, optional:**
   - **Take over:** an editor turns the snapshot plus pending commands into a game on their own phone and becomes the owner. The old share is marked as transferred.
   - **Revoke coach access:** rotate the edit key.
   - **Save a copy** of the finished game on the editor's phone.

## Questions to settle before building
1. **Undo.** Can an assistant undo the head coach's action? Proposed: anyone can undo the newest action, and the label shows who made it.
2. **Ending periods.** Can assistants end a period or the game? Proposed: yes, with the same confirmation.
3. **Roster.** Should the full roster go to coach links, for late arrivals? Proposed: yes, names and numbers only, and never to watch-only links.
4. **Names.** Should edits show a name, or just "Assistant"? Proposed: ask for a name once.
5. **Links.** Two separate links (watch vs. coach), or one link with an "allow changes" switch? Proposed: two links, so parents can never get coach access by accident.

## Resuming checklist (for Claude)
- Read this file, `src/live/protocol.ts`, `src/live/client.ts`, `src/live/hooks.ts` and `server/src/index.ts`.
- Node quirk: in tool shells, prepend `~/.nvm/versions/node/v23.11.0/bin` to `PATH` and `unset -f node npm npx`.
- Tests:
  - app: `npm test` (vitest 3, `src/` only);
  - relay: `cd server && npm test` (vitest 4, inside the Workers runtime).
- Ask the user the five questions above before starting phase 2.
