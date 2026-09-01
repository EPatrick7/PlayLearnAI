export interface BackgroundMusicTrack {
  durationSeconds: number
  id: 'lunar-drift' | 'crater-glass' | 'far-side-signals'
  polyrhythm: '3:2' | '4:3' | '5:4'
  src: string
  title: string
}

export const BACKGROUND_MUSIC_TRACKS: readonly BackgroundMusicTrack[] = [
  {
    durationSeconds: 80,
    id: 'lunar-drift',
    polyrhythm: '3:2',
    src: new URL('../assets/audio/lunar-drift.ogg', import.meta.url).href,
    title: 'Lunar Drift',
  },
  {
    durationSeconds: 75,
    id: 'crater-glass',
    polyrhythm: '4:3',
    src: new URL('../assets/audio/crater-glass.ogg', import.meta.url).href,
    title: 'Crater Glass',
  },
  {
    durationSeconds: 76.8,
    id: 'far-side-signals',
    polyrhythm: '5:4',
    src: new URL('../assets/audio/far-side-signals.ogg', import.meta.url).href,
    title: 'Far-side Signals',
  },
] as const
