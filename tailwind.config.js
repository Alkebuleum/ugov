// tailwind.config.js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: '#0F172A',
        slate: '#475569',
        brand: {
          bg: '#F6F7FB',
          card: '#FFFFFF',
          line: '#E9EDF3',
          primary: '#1F3A6B',
          primarySoft: '#27467F',
          primaryDeep: '#132748',
          accent: '#D9CBB5',
          accentSoft: '#E6DDCC',
          accentDeep: '#CBB898',
          gray: '#6B7280',
        },
      },
      boxShadow: {
        card: '0 10px 30px rgba(15,23,42,0.08)',
        hover: '0 12px 32px rgba(15,23,42,0.12)',
        focus: '0 0 0 3px rgba(31,58,107,0.25)',
      },
      borderRadius: { '2xl': '1rem' },
      ringWidth: { 3: '3px' },
      transitionDuration: { 250: '250ms' },
      transitionTimingFunction: { soft: 'cubic-bezier(.2,.8,.2,1)' },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
  ],
}
