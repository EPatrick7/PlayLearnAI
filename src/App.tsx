import { FortressMap } from './components/FortressMap'
import { PromptCoach } from './components/PromptCoach'
import { resourceKeys } from './game/types'
import { useColonyStore } from './game/store'
import { useWebMcpTools } from './webmcp/registerTools'
import './styles.css'

const resourceGlyphs = {
  food: '✦',
  wood: '╫',
  stone: '◆',
  ore: '⬡',
  medicine: '✚',
}

const formatHour = (hour: number) => `${String(hour).padStart(2, '0')}:00`

export default function App() {
  const colony = useColonyStore()
  const webMcpStatus = useWebMcpTools()
  const openOrders = colony.workOrders
    .filter((order) => order.status === 'active' || order.status === 'queued')
    .sort((a, b) => b.priority - a.priority)

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">PL</div>
          <div>
            <span className="eyebrow">PlayLearnAI presents</span>
            <h1>EMBERDEEP</h1>
          </div>
        </div>
        <div className="colony-clock">
          <span>{colony.season}</span>
          <strong>Day {colony.day} · {formatHour(colony.hour)}</strong>
          <small>{colony.weather}</small>
        </div>
        <div className="topbar-actions">
          <div className={`mcp-badge ${webMcpStatus}`}>
            <span /> WebMCP {webMcpStatus}
          </div>
          <button className="button secondary" onClick={() => colony.advanceHours(1)} type="button">
            Advance 1h
          </button>
          <button className="icon-button" onClick={colony.resetColony} title="Reset demo colony" type="button">
            ↻
          </button>
        </div>
      </header>

      <section className="resource-strip" aria-label="Colony resources">
        {resourceKeys.map((resource) => {
          const percent = Math.round((colony.resources[resource] / colony.capacity[resource]) * 100)
          return (
            <div className={`resource resource-${resource}`} key={resource}>
              <span className="resource-glyph">{resourceGlyphs[resource]}</span>
              <div>
                <span>{resource}</span>
                <strong>{Math.floor(colony.resources[resource])}</strong>
              </div>
              <div className="resource-meter"><span style={{ width: `${percent}%` }} /></div>
            </div>
          )
        })}
        <div className="population-count">
          <span>Population</span>
          <strong>{colony.colonists.length}</strong>
          <small>{colony.colonists.filter((colonist) => colonist.status === 'idle').length} idle</small>
        </div>
      </section>

      <main className="command-grid">
        <div className="left-column">
          <section className="panel alerts-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Needs attention</span>
                <h2>Colony alerts</h2>
              </div>
              <span className="count-badge">{colony.alerts.length}</span>
            </div>
            <div className="alert-list">
              {colony.alerts.map((alert) => (
                <article className={`alert ${alert.severity}`} key={alert.id}>
                  <span className="alert-rune">{alert.severity === 'critical' ? '!' : alert.severity === 'warning' ? '▲' : 'i'}</span>
                  <div>
                    <h3>{alert.title}</h3>
                    <p>{alert.detail}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="panel orders-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Shared queue</span>
                <h2>Work orders</h2>
              </div>
              <span className="count-badge">{openOrders.length}</span>
            </div>
            <div className="order-list">
              {openOrders.map((order) => (
                <article className="work-order" key={order.id}>
                  <div className="order-line">
                    <div>
                      <span className={`status-dot ${order.status}`} />
                      <strong>{order.label}</strong>
                    </div>
                    <span className="priority">P{order.priority}</span>
                  </div>
                  <div className="progress-track">
                    <span style={{ width: `${Math.min(100, (order.progress / order.target) * 100)}%` }} />
                  </div>
                  <div className="order-meta">
                    <span>{order.requiredSkill}</span>
                    <span>{order.workers.length}/4 workers</span>
                    <span>{Math.round((order.progress / order.target) * 100)}%</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>

        <div className="center-column">
          <section className="panel map-panel">
            <div className="panel-heading map-heading">
              <div>
                <span className="eyebrow">Live shared state</span>
                <h2>{colony.colonyName} overview</h2>
              </div>
              <div className="map-legend">
                <span><i className="legend-worker" /> worker</span>
                <span><i className="legend-injured" /> injured</span>
              </div>
            </div>
            <FortressMap colonists={colony.colonists} />
          </section>

          <section className="panel chronicle-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">What changed</span>
                <h2>Colony chronicle</h2>
              </div>
            </div>
            <div className="event-list">
              {colony.events.slice(0, 6).map((event) => (
                <div className={`event ${event.tone}`} key={event.id}>
                  <span>{event.tone === 'agent' ? 'AI' : `D${colony.day}`}</span>
                  <p>{event.message}</p>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="right-column">
          <PromptCoach learning={colony.learning} />

          <section className="panel roster-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">20 lives, many variables</span>
                <h2>Colonist roster</h2>
              </div>
            </div>
            <div className="roster-list">
              {colony.colonists.map((colonist) => {
                const strongestSkill = Object.entries(colonist.skills).sort(([, a], [, b]) => b - a)[0]
                return (
                  <article className="colonist-row" key={colonist.id}>
                    <div className={`portrait ${colonist.status}`}>{colonist.name.charAt(0)}</div>
                    <div className="colonist-name">
                      <strong>{colonist.name}</strong>
                      <span>{colonist.title} · {strongestSkill[0]} {strongestSkill[1]}</span>
                    </div>
                    <div className="mini-stat">
                      <span>FAT</span>
                      <strong className={colonist.fatigue > 70 ? 'danger-text' : ''}>{Math.round(colonist.fatigue)}</strong>
                    </div>
                    <span className={`status-label ${colonist.status}`}>{colonist.status}</span>
                  </article>
                )
              })}
            </div>
          </section>
        </div>
      </main>

      <footer>
        <p><strong>Human + agent, one colony.</strong> The page exposes eight structured WebMCP tools; every agent action updates the same state you see here.</p>
        <span>OpenAI WebMCP Challenge · 2026</span>
      </footer>
    </div>
  )
}
