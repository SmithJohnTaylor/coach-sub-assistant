# Sub Assistant

Phone web app for tracking youth soccer playing time on the sideline. Works offline; all data stays on the device.

## Develop

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # timing engine unit tests
npm run build    # typecheck + production build into dist/
```

## Put it on your phone

Wake lock and offline mode need HTTPS, so deploy the `dist/` folder to any static host:

- **Netlify**: drag `dist/` onto https://app.netlify.com/drop
- **GitHub Pages**: push the repo and publish `dist/` (the build uses relative paths, so a subfolder works)

Then open the URL on your phone and choose **Add to Home Screen**. After the first load it works with no signal.

## How it works

- Every game action (start, pause, end period, sub, swap) is stored as an event with a timestamp in IndexedDB.
- Minutes are recomputed from that log (`src/timing.ts`), so locking the phone, switching apps, or reloading never loses time.
- Undo deletes the last event.
- "Fair share" coloring: each kid's expected minutes = game time × players on field ÷ players present. Orange = more than ~15% (min 1 minute) under, blue = over.

Data lives only in that phone's browser. Export season CSVs regularly as a backup.
