import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { GameIcon } from '../components/GameIcon'
import { BACKGROUND_MUSIC_TRACKS, type BackgroundMusicTrack } from './tracks'

const STORAGE_KEY = 'playlearnai-bgm-v1'
const MUSIC_VOLUME = 0.36

interface StoredMusicPreference {
  trackId?: BackgroundMusicTrack['id']
}

interface BackgroundMusicContextValue {
  currentTrack: BackgroundMusicTrack
  isPlaying: boolean
  togglePlayback: () => void
}

const BackgroundMusicContext = createContext<BackgroundMusicContextValue | null>(null)

const initialTrackIndex = () => {
  if (typeof window === 'undefined') return 0
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as StoredMusicPreference
    const index = BACKGROUND_MUSIC_TRACKS.findIndex((track) => track.id === stored.trackId)
    return index >= 0 ? index : 0
  } catch {
    return 0
  }
}

export function BackgroundMusicProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const playbackAttemptRef = useRef(0)
  const wantsPlaybackRef = useRef(false)
  const [trackIndex, setTrackIndex] = useState(initialTrackIndex)
  const [isPlaying, setIsPlaying] = useState(false)
  const currentTrack = BACKGROUND_MUSIC_TRACKS[trackIndex]

  const rememberTrack = useCallback((track: BackgroundMusicTrack) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ trackId: track.id }))
    } catch {
      // Music remains usable when storage is unavailable or full.
    }
  }, [])

  const play = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    const attempt = playbackAttemptRef.current + 1
    playbackAttemptRef.current = attempt
    wantsPlaybackRef.current = true
    void audio.play().catch(() => {
      if (playbackAttemptRef.current !== attempt || !wantsPlaybackRef.current) return
      wantsPlaybackRef.current = false
      setIsPlaying(false)
    })
  }, [])

  const togglePlayback = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (wantsPlaybackRef.current || !audio.paused) {
      playbackAttemptRef.current += 1
      wantsPlaybackRef.current = false
      audio.pause()
      setIsPlaying(false)
      return
    }
    play()
  }, [play])

  const advanceTrack = useCallback(() => {
    setTrackIndex((index) => (index + 1) % BACKGROUND_MUSIC_TRACKS.length)
  }, [])

  const handlePlaying = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !wantsPlaybackRef.current) {
      audio?.pause()
      setIsPlaying(false)
      return
    }
    setIsPlaying(true)
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = MUSIC_VOLUME
  }, [])

  useEffect(() => {
    rememberTrack(currentTrack)
    const audio = audioRef.current
    if (!audio || !wantsPlaybackRef.current) return
    audio.load()
    play()
  }, [currentTrack, play, rememberTrack])

  const value = useMemo<BackgroundMusicContextValue>(() => ({
    currentTrack,
    isPlaying,
    togglePlayback,
  }), [currentTrack, isPlaying, togglePlayback])

  return (
    <BackgroundMusicContext.Provider value={value}>
      {children}
      <audio
        aria-hidden="true"
        onEnded={advanceTrack}
        onPause={() => setIsPlaying(false)}
        onPlaying={handlePlaying}
        preload="metadata"
        ref={audioRef}
        src={currentTrack.src}
      />
    </BackgroundMusicContext.Provider>
  )
}

export function MusicToggle({ className = '' }: { className?: string }) {
  const music = useContext(BackgroundMusicContext)
  if (!music) throw new Error('MusicToggle must be rendered inside BackgroundMusicProvider.')

  const action = music.isPlaying ? 'Pause' : 'Play'
  const description = `${action} music. ${music.currentTrack.title}, ${music.currentTrack.polyrhythm} polyrhythm.`

  return (
    <button
      aria-label={description}
      aria-pressed={music.isPlaying}
      className={`${className} music-toggle`.trim()}
      onClick={music.togglePlayback}
      title={`${action} ${music.currentTrack.title} · ${music.currentTrack.polyrhythm}`}
      type="button"
    >
      <GameIcon name={music.isPlaying ? 'music' : 'musicOff'} />
    </button>
  )
}
