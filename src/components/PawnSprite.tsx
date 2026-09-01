import type { CSSProperties } from 'react'
import type { CrewStatus } from '../game/types'

export type PawnSpriteVariant =
  | 'copper'
  | 'gold'
  | 'olive'
  | 'rose'
  | 'slate'
  | 'umber'

export type PawnSpriteSize = 'compact' | 'standard'

export interface PawnSpriteProps {
  initials: string
  variant?: PawnSpriteVariant
  accent?: string
  status?: CrewStatus
  size?: PawnSpriteSize
  showStatusDot?: boolean
  showInitials?: boolean
  suited?: boolean
  className?: string
}

interface PawnPalette {
  skin: string
  skinShadow: string
  hair: string
  pack: string
}

const PALETTES: Record<PawnSpriteVariant, PawnPalette> = {
  copper: {
    skin: '#b97855',
    skinShadow: '#865239',
    hair: '#33231f',
    pack: '#5d6865',
  },
  gold: {
    skin: '#d8a06e',
    skinShadow: '#a36e48',
    hair: '#533827',
    pack: '#65716b',
  },
  olive: {
    skin: '#a46f4f',
    skinShadow: '#714934',
    hair: '#1f2422',
    pack: '#596763',
  },
  rose: {
    skin: '#c98d77',
    skinShadow: '#976252',
    hair: '#4a2927',
    pack: '#626b69',
  },
  slate: {
    skin: '#8e5d45',
    skinShadow: '#633d2e',
    hair: '#292422',
    pack: '#576361',
  },
  umber: {
    skin: '#704737',
    skinShadow: '#4b2e27',
    hair: '#171a19',
    pack: '#53615f',
  },
}

const STATUS_COLORS: Record<CrewStatus, string> = {
  idle: '#70d3ad',
  assigned: '#70b8e8',
  working: '#e8bd69',
  resting: '#b29ae8',
}

const SIZE_STYLES: Record<PawnSpriteSize, CSSProperties> = {
  compact: { width: 24, height: 30 },
  standard: { width: 34, height: 42 },
}

const normalizeInitials = (value: string) => value
  .replace(/[^\p{L}\p{N}]/gu, '')
  .slice(0, 2)
  .toUpperCase()

export function PawnSprite({
  initials,
  variant = 'slate',
  accent = '#a75b4c',
  status = 'idle',
  size = 'standard',
  showStatusDot = false,
  showInitials = false,
  suited = false,
  className,
}: PawnSpriteProps) {
  const palette = PALETTES[variant]
  const classes = [
    'pawn-sprite',
    `pawn-sprite--${size}`,
    suited ? 'pawn-sprite--suited' : 'pawn-sprite--shirtsleeves',
    className,
  ]
    .filter(Boolean)
    .join(' ')
  const uniform = suited ? '#d8d4c2' : accent
  const uniformShadow = suited ? '#aaa995' : '#642f2b'
  const pack = suited ? '#b8b9aa' : palette.pack

  return (
    <span
      aria-hidden="true"
      className={classes}
      data-pawn-size={size}
      data-pawn-status={status}
      data-pawn-suited={suited ? 'true' : 'false'}
      data-pawn-variant={variant}
      style={{
        display: 'inline-block',
        flex: '0 0 auto',
        lineHeight: 0,
        pointerEvents: 'none',
        ...SIZE_STYLES[size],
      }}
    >
      <svg
        className="pawn-sprite__art"
        focusable="false"
        height="100%"
        shapeRendering="geometricPrecision"
        viewBox="0 0 36 44"
        width="100%"
        xmlns="http://www.w3.org/2000/svg"
      >
        <ellipse
          className="pawn-sprite__shadow"
          cx="18"
          cy="37.5"
          fill="#111817"
          fillOpacity=".46"
          rx="13.5"
          ry="4.5"
        />

        <g className="pawn-sprite__backpack">
          <path
            d="M8.1 17.2c0-3 2.4-5.4 5.4-5.4h9c3 0 5.4 2.4 5.4 5.4v11.5c0 2.4-1.9 4.3-4.3 4.3H12.4a4.3 4.3 0 0 1-4.3-4.3Z"
            fill={pack}
            stroke="#26302f"
            strokeWidth="1.5"
          />
          <path d="M10.5 20h15v2.2h-15Z" fill="#303b39" opacity=".7" />
          <path d="M11.2 15.4h13.6" fill="none" stroke="#84918c" strokeOpacity=".62" strokeWidth="1.2" />
        </g>

        <g className="pawn-sprite__arms">
          <path
            d="M9.7 19.5c-2.9.4-5 3.4-4.4 6.5l1.2 6.3c.3 1.7 1.8 2.8 3.3 2.4 1.4-.4 2.2-1.9 1.9-3.5l-1-5.3c-.2-1.2.5-2.3 1.5-2.5Z"
            fill={uniform}
            stroke="#293130"
            strokeWidth="1.35"
          />
          <path
            d="M26.3 19.5c2.9.4 5 3.4 4.4 6.5l-1.2 6.3c-.3 1.7-1.8 2.8-3.3 2.4-1.4-.4-2.2-1.9-1.9-3.5l1-5.3c.2-1.2-.5-2.3-1.5-2.5Z"
            fill={uniform}
            stroke="#293130"
            strokeWidth="1.35"
          />
          <path d="M7.5 31.8c.2 1.5 1.4 2.5 2.7 2.2" fill="none" stroke="#d1d5ca" strokeWidth="1.4" />
          <path d="M28.5 31.8c-.2 1.5-1.4 2.5-2.7 2.2" fill="none" stroke="#d1d5ca" strokeWidth="1.4" />
        </g>

        <g className="pawn-sprite__torso">
          <path
            d="M10.5 18.2c0-3 2.6-5.5 5.7-5.5h3.6c3.1 0 5.7 2.5 5.7 5.5v13.4c0 2.8-2.3 5.1-5.2 5.1h-4.6c-2.9 0-5.2-2.3-5.2-5.1Z"
            fill={uniform}
            stroke="#293130"
            strokeWidth="1.6"
          />
          <path d="M12 21.1h12v3.2H12Z" fill="#e2dfd2" fillOpacity=".72" />
          <path d="M18 24.4v10.5" fill="none" stroke={uniformShadow} strokeOpacity=".42" />
          <path d="M12.9 17.1c2.8 1.3 7.4 1.3 10.2 0" fill="none" stroke="#f1e9d3" strokeOpacity=".48" strokeWidth="1.2" />
          {suited && (
            <>
              <path className="pawn-sprite__role-stripe" d="M11.8 21.2h12.4v3H11.8Z" fill={accent} />
              <path d="M13 27.2h10" fill="none" stroke="#596763" strokeWidth="1.1" />
            </>
          )}
          {showInitials && (
            <text
              className="pawn-sprite__initials"
              fill="#202928"
              fontFamily="ui-monospace, SFMono-Regular, Consolas, monospace"
              fontSize="5.1"
              fontWeight="900"
              letterSpacing="-.25"
              textAnchor="middle"
              x="18"
              y="28.8"
            >
              {normalizeInitials(initials)}
            </text>
          )}
        </g>

        {suited ? (
          <g className="pawn-sprite__helmet">
            <path
              d="M9.2 10.2c0-5.3 3.8-9.1 8.8-9.1s8.8 3.8 8.8 9.1v4.2c0 2.5-2 4.5-4.5 4.5h-8.6a4.5 4.5 0 0 1-4.5-4.5Z"
              fill="#e2dfd0"
              stroke="#29302f"
              strokeWidth="1.5"
            />
            <path
              className="pawn-sprite__visor"
              d="M11.5 8.3c.5-3.2 2.8-5 6.5-5 3.8 0 6.1 1.8 6.6 5v4.1c-.7 2.7-2.9 4.1-6.6 4.1-3.6 0-5.8-1.4-6.5-4.1Z"
              fill="#263c43"
              stroke="#6e7d7d"
              strokeWidth="1.1"
            />
            <path d="M13.1 7.4c1.7-2 4.7-2.7 8.7-1.6" fill="none" stroke="#d9f3ef" strokeLinecap="round" strokeOpacity=".62" strokeWidth="1.2" />
            <path d="M11.2 16.2h13.6v3H11.2Z" fill="#a5a897" stroke="#29302f" strokeWidth="1" />
            <circle cx="23.5" cy="16.9" fill="#78d9b1" r="1.15" stroke="#27322f" strokeWidth=".6" />
            <path className="pawn-sprite__suit-hose" d="M10.4 15.5C7.7 17.6 7.5 22 9.9 25" fill="none" stroke="#596763" strokeWidth="1.35" />
          </g>
        ) : (
          <>
            <g className="pawn-sprite__head">
              <ellipse
                cx="18"
                cy="10.3"
                fill={palette.skin}
                rx="7.3"
                ry="7.6"
                stroke="#29302f"
                strokeWidth="1.5"
              />
              <path d="M12 10.7c.8 2.7 2.8 4.3 6 4.3 3.1 0 5.1-1.6 6-4.3-.2 4-2.4 6.6-6 6.6s-5.8-2.6-6-6.6Z" fill={palette.skinShadow} opacity=".42" />
              <path d="M14.2 10.6c2.5 1 5.1 1 7.6 0" fill="none" stroke="#f2d7bd" strokeLinecap="round" strokeOpacity=".34" strokeWidth="1" />
            </g>

            <path
              className="pawn-sprite__hair"
              d="M11.1 9.7c-.6-4.1 2-7.2 6.7-7.2 4.8 0 7.6 3.2 7 7.4-1.7-2-4-2.9-6.7-2.9-2.9 0-5.1.9-7 2.7Z"
              fill={palette.hair}
              stroke="#242927"
              strokeLinejoin="round"
              strokeWidth="1.2"
            />
            <path d="M14.2 5.1c2.2-1 4.7-1.1 7.5.1" fill="none" stroke="#eee2ca" strokeOpacity=".16" strokeLinecap="round" />
          </>
        )}

        {showStatusDot && (
          <g className="pawn-sprite__status" data-pawn-status-dot={status}>
            <circle cx="29.2" cy="7" fill="#26302f" r="4.2" />
            <circle cx="29.2" cy="7" fill={STATUS_COLORS[status]} r="2.7" />
            <circle cx="28.3" cy="6.1" fill="#fff" fillOpacity=".55" r=".75" />
          </g>
        )}
      </svg>
    </span>
  )
}
