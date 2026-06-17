/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Syne', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
        sans: ['IBM Plex Sans', 'sans-serif'],
      },
      colors: {
        flux: {
          bg:       '#08090b',
          panel:    '#101216',
          accent:   '#f97316',
          healthy:  '#10b981',
          warning:  '#f59e0b',
          critical: '#f43f5e',
          text:     '#e2e8f0',
          muted:    '#64748b',
          dim:      '#3e4555',
        },
      },
    },
  },
  plugins: [],
}
