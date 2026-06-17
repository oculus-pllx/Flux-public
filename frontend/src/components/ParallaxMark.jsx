export function ParallaxMark({ size = 24, color = '#f97316' }) {
  const s = size / 64
  const sw = (base) => base * s
  const dash = `${sw(2.8)} ${sw(2.8)}`

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-label="Flux by Parallax Group">
      <line x1="11.2" y1="16.8" x2="20.8" y2="13.6"
        stroke={color} strokeOpacity="0.15" strokeWidth={sw(1.44)} strokeDasharray={dash} />
      <line x1="11.2" y1="47.2" x2="20.8" y2="50.4"
        stroke={color} strokeOpacity="0.15" strokeWidth={sw(1.44)} strokeDasharray={dash} />
      <line x1="32" y1="32" x2="44.8" y2="32"
        stroke={color} strokeOpacity="0.15" strokeWidth={sw(1.44)} strokeDasharray={dash} />
      <polyline points="11.2,16.8 32,32 11.2,47.2"
        stroke={color} strokeOpacity="0.30" strokeWidth={sw(3.2)}
        strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="20.8,13.6 44.8,32 20.8,50.4"
        stroke={color} strokeOpacity="0.90" strokeWidth={sw(4.0)}
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
