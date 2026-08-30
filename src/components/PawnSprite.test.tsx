import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PawnSprite } from './PawnSprite'

describe('PawnSprite', () => {
  it('renders its visual layers without replacing the parent accessible name', () => {
    const { container } = render(
      <button aria-label="Select Amina Okafor" type="button">
        <PawnSprite
          accent="#b8664e"
          initials="a.o."
          showInitials
          showStatusDot
          size="compact"
          status="working"
          variant="umber"
        />
      </button>,
    )

    expect(screen.getByRole('button', { name: 'Select Amina Okafor' })).toBeInTheDocument()

    const pawn = container.querySelector('.pawn-sprite')
    expect(pawn).toHaveAttribute('aria-hidden', 'true')
    expect(pawn).toHaveAttribute('data-pawn-size', 'compact')
    expect(pawn).toHaveAttribute('data-pawn-status', 'working')
    expect(pawn).toHaveAttribute('data-pawn-variant', 'umber')
    expect(pawn).toHaveStyle({ height: '30px', width: '24px' })
    expect(container.querySelector('.pawn-sprite__shadow')).toBeInTheDocument()
    expect(container.querySelector('.pawn-sprite__backpack')).toBeInTheDocument()
    expect(container.querySelector('.pawn-sprite__arms')).toBeInTheDocument()
    expect(container.querySelector('.pawn-sprite__torso')).toBeInTheDocument()
    expect(container.querySelector('.pawn-sprite__head')).toBeInTheDocument()
    expect(container.querySelector('.pawn-sprite__hair')).toBeInTheDocument()
    expect(container.querySelector('.pawn-sprite__initials')).toHaveTextContent('AO')
    expect(container.querySelector('[data-pawn-status-dot="working"]')).toBeInTheDocument()
  })

  it('omits optional status and initials unless requested', () => {
    const { container } = render(<PawnSprite initials="MA" />)

    expect(container.querySelector('.pawn-sprite__status')).not.toBeInTheDocument()
    expect(container.querySelector('.pawn-sprite__initials')).not.toBeInTheDocument()
  })
})
