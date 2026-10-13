# frog-site

One-page personal site with a frog living in it. Vite + TypeScript + Three.js.

```
npm install
npm run dev
```

## Getting the frog out of Blender

1. File → Export → glTF 2.0, format **glTF Binary (.glb)**.
2. Tick *Apply Modifiers*; include *Animations* if there are any.
3. Save it as `public/models/frog.glb`.

Until that file exists, the page just shows the text and links.

Conventions the code picks up automatically:
- Objects whose names start with `Eye` blink.
- Clips are looked up by exact name (see `CLIPS` in `src/frog.ts`): Resting, Wake and move, Crawling, Alert idle, Looking around, Settle to rest, Idle.
- The model is auto-centered and scaled, so don't worry about units.

Layout: `src/frog.ts` holds the frog (loading, cursor tracking, blinking, breathing);
`src/pond.ts` draws the water (cursor ripples, raindrops, fireflies);
`src/main.ts` holds the scene, camera and page wiring.
