import { useNavigate } from 'react-router-dom'

const STATUS_MAP = {
  OL:    { label: 'Online',     color: 'var(--flux-healthy)' },
  OB:    { label: 'On Battery', color: 'var(--flux-warning)' },
  LB:    { label: 'Low Battery',color: 'var(--flux-critical)' },
  RB:    { label: 'Replace Batt',color: 'var(--flux-critical)' },
  CHRG:  { label: 'Charging',   color: 'var(--flux-warning)' },
  DISCHRG:{ label: 'Discharging',color: 'var(--flux-warning)' },
}

function getStatus(raw) {
  if (!raw) return { label: 'Unknown', color: 'var(--flux-muted)' }
  for (const key of Object.keys(STATUS_MAP)) {
    if (raw.includes(key)) return STATUS_MAP[key]
  }
  return { label: raw, color: 'var(--flux-muted)' }
}

function fmt(val, suffix = '') {
  return val !== undefined && val !== null ? `${val}${suffix}` : '—'
}

export default function DeviceCard({ device, onEdit, onDelete }) {
  const navigate = useNavigate()
  const v = device.lastStatus || {}
  const status = getStatus(v['ups.status'])
  const charge  = v['battery.charge']
  const load    = v['ups.load']
  const runtime = v['battery.runtime']
  const voltage = v['input.voltage']

  const runtimeMin = runtime ? Math.floor(runtime / 60) : null
  const beeper     = v['ups.beeper.status']
  const pollAge    = device.lastSeen ? Math.floor((Date.now() - new Date(device.lastSeen)) / 1000) : null
  const pollStale  = pollAge !== null && pollAge > (device.pollInterval || 60) * 2

  return (
    <div
      style={{ background: 'var(--flux-panel)', border: '1px solid var(--flux-border)' }}
      className="rounded-lg overflow-hidden group"
    >
      {/* Header — clickable to detail */}
      <div
        onClick={() => navigate(`/devices/${device.id}`)}
        className="p-4 cursor-pointer transition-colors"
        style={{ '--tw-ring-color': 'var(--flux-accent)' }}
        onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--flux-accent)'}
        onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-display font-semibold text-sm" style={{ color: 'var(--flux-text)' }}>
              {device.name}
            </h3>
            <p className="font-mono text-xs mt-0.5" style={{ color: 'var(--flux-muted)' }}>
              {device.host}:{device.port} · {device.upsName}
            </p>
          </div>
          <span className="flex items-center gap-1.5 text-xs font-sans px-2 py-0.5 rounded-full"
            style={{ background: `${status.color}18`, color: status.color }}>
            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: status.color }} />
            {status.label}
          </span>
        </div>

        {/* Battery charge bar */}
        {charge !== undefined && (
          <div className="mb-3 rounded-full overflow-hidden" style={{ height: '3px', background: 'rgba(255,255,255,0.06)' }}>
            <div style={{
              width: `${Math.min(100, charge)}%`,
              height: '100%',
              background: charge < 25 ? 'var(--flux-critical)' : charge < 50 ? 'var(--flux-warning)' : 'var(--flux-healthy)',
              transition: 'width 0.4s ease',
            }} />
          </div>
        )}

        {/* Priority metrics */}
        <div className="grid grid-cols-2 gap-2">
          <Metric label="Battery" value={fmt(charge, '%')} alert={charge !== undefined && charge < 25} />
          <Metric label="Load" value={fmt(load, '%')} alert={load !== undefined && load > 80} />
          <Metric
            label="Runtime"
            value={runtimeMin !== null ? `${runtimeMin}m` : '—'}
            alert={runtimeMin !== null && runtimeMin < 5}
            critical={runtimeMin !== null && runtimeMin < 2}
          />
          <Metric label="Input V" value={fmt(voltage, 'V')} />
        </div>

        <div className="flex items-center justify-between mt-3">
          {beeper !== undefined && (
            <span className="font-mono text-xs px-2 py-0.5 rounded-full"
              style={{
                background: beeper === 'disabled' ? 'rgba(100,116,139,0.15)' : 'rgba(249,115,22,0.12)',
                color: beeper === 'disabled' ? 'var(--flux-dim)' : 'var(--flux-accent)',
                border: `1px solid ${beeper === 'disabled' ? 'var(--flux-border)' : 'rgba(249,115,22,0.3)'}`,
              }}>
              🔔 {beeper}
            </span>
          )}
          {device.lastSeen && (
            <p className="font-mono text-xs ml-auto" style={{ color: pollStale ? 'var(--flux-warning)' : 'var(--flux-dim)' }}>
              {pollStale ? '⚠ ' : ''}Polled {new Date(device.lastSeen).toLocaleTimeString()}
            </p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div style={{ borderTop: '1px solid var(--flux-border)' }}
        className="px-4 py-2 flex gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={e => { e.stopPropagation(); navigate(`/devices/${device.id}`) }}
          className="font-sans text-xs transition-colors"
          style={{ color: 'var(--flux-muted)' }}
          onMouseEnter={e => e.target.style.color = 'var(--flux-text)'}
          onMouseLeave={e => e.target.style.color = 'var(--flux-muted)'}>
          View
        </button>
        <button
          onClick={e => { e.stopPropagation(); onEdit(device) }}
          className="font-sans text-xs transition-colors"
          style={{ color: 'var(--flux-muted)' }}
          onMouseEnter={e => e.target.style.color = 'var(--flux-accent)'}
          onMouseLeave={e => e.target.style.color = 'var(--flux-muted)'}>
          Edit
        </button>
        <button
          onClick={e => { e.stopPropagation(); onDelete(device) }}
          className="font-sans text-xs transition-colors ml-auto"
          style={{ color: 'var(--flux-muted)' }}
          onMouseEnter={e => e.target.style.color = 'var(--flux-critical)'}
          onMouseLeave={e => e.target.style.color = 'var(--flux-muted)'}>
          Delete
        </button>
      </div>
    </div>
  )
}

function Metric({ label, value, alert, critical }) {
  const color = critical ? 'var(--flux-critical)' : alert ? 'var(--flux-warning)' : 'var(--flux-text)'
  return (
    <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '6px' }} className="px-3 py-2">
      <p className="font-sans text-xs mb-0.5" style={{ color: 'var(--flux-dim)' }}>{label}</p>
      <p className="font-mono text-sm font-semibold" style={{ color }}>{value}</p>
    </div>
  )
}
