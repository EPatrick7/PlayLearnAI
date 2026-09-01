# Procedural background music

The Moonbase background tracks are original procedural compositions rendered by
[`scripts/generate-bgm.mjs`](../scripts/generate-bgm.mjs). They use only generated
waveforms: there are no samples, soundfonts, recordings, or third-party musical
assets.

## Regenerating the files

The renderer requires Node.js 22 or newer and `ffmpeg` built with `libvorbis`
and `libmp3lame`:

```bash
npm run audio:generate
```

It writes three 48 kHz stereo Ogg Vorbis files for the game and matching 128 kbps
MP3 review copies to `src/assets/audio/`. The musical render is deterministic.
Encoded bytes can differ between FFmpeg/codec versions.

## Track specifications

All beat offsets below are measured in quarter-note beats. Each arrangement stays
within three musical roles: a sustained low bass foundation and two lighter
upper-register pulse voices. The upper voices carry the two sides of the
polyrhythm; the bass only states the changing harmony. Their grids meet at the
end of every cell, so the ratio remains legible without accumulating phase drift.

### Lunar Drift

- **Length:** 80 seconds; 60 BPM; 20 bars of 4/4.
- **Polyrhythm:** three moon-droplet notes at `[0, 4/3, 8/3]` interlock with two
  warm pulses at `[0, 2]` in each four-beat bar. The first bar introduces no new
  upper attacks beyond the preceding loop's quiet tails; the complete 3:2 overlay
  enters in bar two.
- **Form:** five four-bar sections move from a sparse `Dmaj9` emergence into the
  main theme, depart through `F#m11–Bm11–Em9–A11`, crest across `Bm11–Gmaj9–D/F#–A`,
  and thin back to `D6/9` for the loop home.
- **Voice:** a warm low dyad sustains the harmony while a soft pulse lane on the
  left counts two and moon droplets on the right count three. Their pitches open
  upward at the crest and settle back into the final D harmony.

### Crater Glass

- **Length:** 75 seconds; 57.6 BPM; 12 six-beat cells.
- **Polyrhythm:** four FM bell notes at `[0, 1.5, 3, 4.5]` interlock with three
  bowl-like pulses at `[0, 2, 4]` in every six-beat cell.
- **Form:** a continuous modal arch leaves `Em9`, brightens through suspended A
  and `Cmaj7(#11)`, climbs through B minor, A, G, and D/F-sharp colors, then folds
  back through ambiguity to `Em9`.
- **Voice:** a mellow hollow dyad supports a rounded bowl-like three-pulse lane
  on the left and soft glass/celesta notes on the right. Gentle harmonic FM and
  both upper voices intensify toward the apex, then soften during the return.

### Far-side Signals

- **Length:** 76.8 seconds; 50 BPM; eight eight-beat cells.
- **Polyrhythm:** five beacon chirps at `[0, 1.6, 3.2, 4.8, 6.4]` interlock with
  four rounded signal pulses at `[0, 2, 4, 6]` in every eight-beat cell.
- **Form:** a slow signal narrative moves through `C#m9`, `C#m9/B`, `Amaj9`,
  `Emaj9/B`, and `F#m11`; a luminous `Dmaj7(#11)/A` contact chord gives way to
  `G#7sus(b9)` tension before a quieter `C#m6/9` return.
- **Voice:** a narrow dark bass dyad sits beneath a rounded four-pulse lane on the
  left and briefly sharp, downward-settling beacon chirps on the right. A bright
  contact event and the subdued final cell give the piece its most spacious arc.

## Synthesis and loop construction

- The bass foundations use only two low sustained notes per bar or cell. Lunar's
  is softly detuned and warm, Crater's has a pure fundamental-and-octave body,
  and Far-side's attacks more slowly with a darker spectrum. A shallow gain curve
  keeps this harmonic floor present while the upper voices bloom and recede.
- Each ratio uses two separately synthesized pulse buses. Lunar pairs an additive
  droplet with a warm short pluck, Crater pairs an FM bell with a muted bowl, and
  Far-side pairs a pitch-settling beacon with a rounded signal pulse.
- The numerator voices occupy the right stereo lane and the denominator voices
  the left, with register and timbre separation that also preserves the rhythm in
  mono. Only the brighter numerator buses receive noticeable delays.
- Exponential one-shot voices receive a short terminal fade so their tails reach
  zero without an internal discontinuity. All releases and delay taps wrap around
  the render buffer. This means
  the beginning contains the previous cycle's natural tail instead of a fade from
  silence, and the end meets the beginning without truncating a note.
- Each mix is DC-centered, gently soft-clipped, and level-conditioned before
  16-bit PCM staging and Vorbis/MP3 encoding. Section gain curves create an audible
  rise and release while retaining comfortable background-music headroom.

## Provenance and license

The compositions, note data, synthesizer code, and generated audio were created
for PlayLearnAI. They contain no third-party material and are distributed under
the repository's [MIT License](../LICENSE).
