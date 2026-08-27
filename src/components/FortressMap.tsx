import type { Colonist } from '../game/types'

const terrain = [
  '~~~~~~~~~~~~~~~~~~~~~~',
  '~~..TT....TT....TT..~~',
  '~..TT.....##........~~',
  '~.....##########.....~',
  '~....##........##....~',
  '~...##..++++++..##...~',
  '~...#...+....+...#...~',
  '~...#...+....+...#...~',
  '~...##..++++++..##...~',
  '~....####....####.....~',
  '~.......#....#........~',
  '~....^^.######.^^.....~',
  '~~..^^^^^^^^^^^^....~~~',
  '~~~~~~~~~~~~~~~~~~~~~~',
]

const workerPositions = [
  [6, 7], [7, 8], [8, 6], [7, 13], [9, 10], [5, 11], [10, 11], [8, 15], [4, 9], [6, 12],
  [7, 10], [9, 13], [3, 12], [4, 16], [10, 8], [5, 8], [9, 6], [7, 16], [8, 10], [6, 15],
] as const

const tileClass: Record<string, string> = {
  '~': 'water',
  '.': 'earth',
  T: 'tree',
  '#': 'stone',
  '+': 'floor',
  '^': 'mountain',
}

const tileGlyph: Record<string, string> = {
  '~': '≈',
  '.': '·',
  T: '♠',
  '#': '▓',
  '+': '▪',
  '^': '▲',
}

export const FortressMap = ({ colonists }: { colonists: Colonist[] }) => {
  const occupants = new Map(workerPositions.map((position, index) => [`${position[0]}-${position[1]}`, colonists[index]]))

  return (
    <div className="fortress-map" role="img" aria-label="A top-down symbolic map of Emberdeep fortress">
      {terrain.flatMap((row, rowIndex) =>
        [...row].map((tile, columnIndex) => {
          const colonist = occupants.get(`${rowIndex}-${columnIndex}`)
          return (
            <span
              className={`map-tile ${tileClass[tile]}${colonist ? ` occupied ${colonist.status}` : ''}`}
              key={`${rowIndex}-${columnIndex}`}
              title={colonist ? `${colonist.name} — ${colonist.status}` : undefined}
            >
              {colonist ? '◆' : tileGlyph[tile]}
            </span>
          )
        }),
      )}
      <div className="map-label label-surface">SURFACE CAMP</div>
      <div className="map-label label-hall">GREAT HALL</div>
      <div className="map-label label-mine">EAST GALLERY</div>
    </div>
  )
}
