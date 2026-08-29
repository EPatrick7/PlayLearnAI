import type { SVGProps } from 'react'

export type GameIconName =
  | 'oxygen'
  | 'water'
  | 'food'
  | 'power'
  | 'alert'
  | 'dust'
  | 'clock'
  | 'reset'
  | 'work'
  | 'crew'
  | 'gear'
  | 'plan'
  | 'log'
  | 'research'
  | 'shield'
  | 'check'
  | 'chevron'
  | 'close'
  | 'plus'
  | 'minus'
  | 'play'
  | 'fastForward'
  | 'verify'
  | 'map'
  | 'activity'
  | 'warning'
  | 'habitat'
  | 'corridor'
  | 'lifeSupport'
  | 'storage'
  | 'laboratory'
  | 'airlock'
  | 'solar'
  | 'landingPad'
  | 'evaSuit'
  | 'engineeringKit'
  | 'medicalKit'
  | 'rover'
  | 'pawn'
  | 'breach'
  | 'atmosphere'
  | 'door'
  | 'bed'
  | 'table'
  | 'console'
  | 'tank'
  | 'crate'
  | 'microscope'
  | 'battery'

export interface GameIconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  name: GameIconName
  size?: number | string
  title?: string
}

function IconArtwork({ name }: { name: GameIconName }) {
  switch (name) {
    case 'oxygen':
      return (
        <>
          <path d="M12 3.2c-3.6 4.1-6 7-6 10.1a6 6 0 0 0 12 0c0-3.1-2.4-6-6-10.1Z" />
          <path d="M9 14.1c.4 1.6 1.4 2.4 3 2.4" />
        </>
      )
    case 'water':
      return (
        <>
          <path d="M12 2.8C8.5 7.1 6.2 10 6.2 13.2a5.8 5.8 0 0 0 11.6 0C17.8 10 15.5 7.1 12 2.8Z" />
          <path d="M9.2 14.1c.3 1.2 1.2 2 2.5 2.2" />
        </>
      )
    case 'food':
      return (
        <>
          <path d="M12 20V9.8" />
          <path d="M12 13.6c-4.8 0-7.2-2.4-7.2-7.2 4.8 0 7.2 2.4 7.2 7.2Z" />
          <path d="M12 10.6c0-4.2 2.3-6.3 6.8-6.3 0 4.3-2.3 6.4-6.8 6.3Z" />
        </>
      )
    case 'power':
      return <path d="m13.2 2-7 11h5L10.8 22l7-11h-5L13.2 2Z" />
    case 'alert':
    case 'warning':
      return (
        <>
          <path d="M12 3 2.8 20h18.4L12 3Z" />
          <path d="M12 9v5" />
          <path d="M12 17.4h.01" />
        </>
      )
    case 'dust':
      return (
        <>
          <path d="M3 8h10.5c2.2 0 2.2-3 0-3-1 0-1.7.5-2 1.2" />
          <path d="M3 12h15.5c2.4 0 2.4 3.2 0 3.2-1 0-1.8-.5-2.1-1.3" />
          <path d="M3 16.5h8.2" />
        </>
      )
    case 'clock':
      return (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7v5l3.5 2" />
        </>
      )
    case 'reset':
      return (
        <>
          <path d="M5.2 8.2A8 8 0 1 1 4 14" />
          <path d="M4.8 3.8v4.8h4.8" />
        </>
      )
    case 'work':
      return (
        <>
          <path d="m5 19 7.2-7.2" />
          <path d="m13.7 10.3 4.7-4.7" />
          <path d="M15.3 3.7 20.2 8.6" />
          <path d="m4.2 15.8 4 4" />
          <path d="m7.3 5.2 3.1 3.1-2.1 2.1-3.1-3.1-1.4-.4-.9-2.6 1.4-1.4 2.6.9.4 1.4Z" />
        </>
      )
    case 'crew':
    case 'pawn':
      return (
        <>
          <circle cx="12" cy="7" r="3" />
          <path d="M6.5 21v-4.1c0-3.2 2.1-5.4 5.5-5.4s5.5 2.2 5.5 5.4V21" />
          <path d="M9 21v-4m6 4v-4" />
        </>
      )
    case 'gear':
      return (
        <>
          <circle cx="12" cy="12" r="3.2" />
          <path d="m9.2 3.7.5 2a7 7 0 0 0-1.8 1L6 6.1 4.1 9.3l1.5 1.4a7.2 7.2 0 0 0 0 2.1l-1.5 1.4L6 17.5l2-.6a7 7 0 0 0 1.8 1l.5 2h3.8l.5-2a7 7 0 0 0 1.8-1l2 .6 1.9-3.3-1.5-1.4a7.2 7.2 0 0 0 0-2.1l1.5-1.4L18.4 6l-2 .6a7 7 0 0 0-1.8-1l-.5-2H9.2Z" />
        </>
      )
    case 'plan':
      return (
        <>
          <path d="M7 3.5h10v17H7z" />
          <path d="M9.5 3.5V2h5v1.5M9.8 8h4.8m-4.8 4h4.8m-4.8 4h3" />
        </>
      )
    case 'log':
      return (
        <>
          <path d="M5 4h14v16H5z" />
          <path d="M8 8h8M8 12h8M8 16h5" />
        </>
      )
    case 'research':
    case 'microscope':
      return (
        <>
          <path d="m9 3 4 1-1.7 6.3-4-1L9 3Z" />
          <path d="M10.7 10.2c2.7.7 4.1 2.3 4.1 4.7" />
          <path d="M7.2 11.3a6.2 6.2 0 0 0 6.2 7.4H18" />
          <path d="M5 21h14M14.8 14.9h3.4v3.8h-4.8" />
        </>
      )
    case 'shield':
      return <path d="M12 2.8 19 5v5.8c0 4.6-2.5 8-7 10.4-4.5-2.4-7-5.8-7-10.4V5l7-2.2Z" />
    case 'check':
      return <path d="m4 12.5 5 5L20 6.5" />
    case 'chevron':
      return <path d="m9 5 7 7-7 7" />
    case 'close':
      return <path d="m5 5 14 14M19 5 5 19" />
    case 'plus':
      return <path d="M12 4v16M4 12h16" />
    case 'minus':
      return <path d="M4 12h16" />
    case 'play':
      return <path d="m7 4 12 8-12 8V4Z" />
    case 'fastForward':
      return (
        <>
          <path d="m3 5 8 7-8 7V5Z" />
          <path d="m11 5 8 7-8 7V5Z" />
          <path d="M21 5v14" />
        </>
      )
    case 'verify':
      return (
        <>
          <circle cx="11" cy="11" r="7" />
          <path d="m7.8 11 2.1 2.1 4.5-4.5M16.3 16.3 21 21" />
        </>
      )
    case 'map':
      return (
        <>
          <path d="m3 5 5-2 8 3 5-2v15l-5 2-8-3-5 2V5Z" />
          <path d="M8 3v15M16 6v15" />
        </>
      )
    case 'activity':
      return <path d="M2.5 12h4l2-6 4.2 12 2.2-6H22" />
    case 'habitat':
      return (
        <>
          <path d="M3 19V8l4-4h10l4 4v11H3Z" />
          <path d="M8 19v-6h8v6M7 9h2m6 0h2" />
        </>
      )
    case 'corridor':
      return (
        <>
          <path d="M2 8h20v8H2z" />
          <path d="M6 8v8m6-8v8m6-8v8" />
        </>
      )
    case 'lifeSupport':
      return (
        <>
          <path d="M7 3h10v18H7z" />
          <path d="M7 8h10M7 16h10" />
          <path d="M12 10.2c-1.6 1.8-2.4 3-2.4 4a2.4 2.4 0 0 0 4.8 0c0-1-.8-2.2-2.4-4Z" />
        </>
      )
    case 'storage':
    case 'crate':
      return (
        <>
          <path d="M4 6h16v14H4z" />
          <path d="M4 10h16M8 6v14m8-14v14M8 10l8 10m0-10L8 20" />
        </>
      )
    case 'laboratory':
      return (
        <>
          <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3" />
          <path d="M7.2 15h9.6M9.3 12h5.4" />
        </>
      )
    case 'airlock':
    case 'door':
      return (
        <>
          <path d="M5 21V3h14v18M8 21V6h8v15" />
          <circle cx="13.5" cy="13.5" r=".7" />
        </>
      )
    case 'solar':
      return (
        <>
          <path d="M3 5h18l-2 11H5L3 5Z" />
          <path d="M4 9h16M4.5 13h15M8 5 7 16m9-11 1 11M12 16v4m-5 0h10" />
        </>
      )
    case 'landingPad':
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M8 7v10M16 7v10M8 12h8" />
        </>
      )
    case 'evaSuit':
      return (
        <>
          <path d="M8.5 7.5a3.5 3.5 0 1 1 7 0v2h-7v-2Z" />
          <path d="M7.5 10h9l2 5-2.5 1-1-3v8H9v-8l-1 3-2.5-1 2-5Z" />
          <path d="M12 10v5M9 18h6" />
        </>
      )
    case 'engineeringKit':
      return (
        <>
          <path d="M3 8h18v12H3z" />
          <path d="M8 8V5h8v3M3 12h18" />
          <path d="M10 11h4v3h-4z" />
        </>
      )
    case 'medicalKit':
      return (
        <>
          <path d="M4 7h16v13H4z" />
          <path d="M9 7V4h6v3M12 10v7M8.5 13.5h7" />
        </>
      )
    case 'rover':
      return (
        <>
          <path d="M4 16V9h11l4 4v3H4Z" />
          <path d="M8 9V6h5v3m2 0v4h4" />
          <circle cx="7" cy="17" r="2" />
          <circle cx="17" cy="17" r="2" />
        </>
      )
    case 'breach':
      return (
        <>
          <path d="m12 2-1.4 6.2-4.4-3.1 2.6 5.1-6.2.7 6 1.8-4.2 4.5 5.3-2.7-.5 6 2.8-5.3 3.5 4.3-1.2-5.6 5.6 1.5-5-3.5 4.2-3.3-5.3.3L12 2Z" />
          <circle cx="12" cy="12" r="2.2" />
        </>
      )
    case 'atmosphere':
      return (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M4 12h16M12 3.5c2.3 2.2 3.5 5 3.5 8.5S14.3 18.3 12 20.5C9.7 18.3 8.5 15.5 8.5 12S9.7 5.7 12 3.5Z" />
        </>
      )
    case 'bed':
      return (
        <>
          <path d="M3 18V8m0 7h18v3M7 15v-5h5c2 0 3 1 3 3v2" />
          <path d="M3 10h4v5" />
        </>
      )
    case 'table':
      return (
        <>
          <ellipse cx="12" cy="9" rx="8" ry="4" />
          <path d="M8 12v7m8-7v7" />
        </>
      )
    case 'console':
      return (
        <>
          <path d="M4 4h16v11H4z" />
          <path d="M8 20h8M12 15v5M7 8h3l2 3 2-4 3 2" />
        </>
      )
    case 'tank':
      return (
        <>
          <path d="M8 4c0-2 8-2 8 0v16c0 2-8 2-8 0V4Z" />
          <path d="M8 5c0 2 8 2 8 0M8 17c0 2 8 2 8 0" />
        </>
      )
    case 'battery':
      return (
        <>
          <path d="M7 4h10v17H7zM10 2h4v2" />
          <path d="m13 7-3 5h2l-1 5 3-6h-2l1-4Z" />
        </>
      )
  }
}

export function GameIcon({
  name,
  size = 18,
  title,
  className,
  width,
  height,
  role,
  'aria-label': ariaLabel,
  'aria-hidden': ariaHidden,
  ...svgProps
}: GameIconProps) {
  const labelled = Boolean(title || ariaLabel)

  return (
    <svg
      {...svgProps}
      aria-hidden={labelled ? ariaHidden : true}
      aria-label={ariaLabel}
      className={['game-icon', className].filter(Boolean).join(' ')}
      fill="none"
      height={height ?? size}
      role={labelled ? (role ?? 'img') : role}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
      width={width ?? size}
    >
      {title && <title>{title}</title>}
      <IconArtwork name={name} />
    </svg>
  )
}
