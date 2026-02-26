/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-rajdhani)', 'system-ui', 'sans-serif'],
        display: ['var(--font-orbitron)', 'system-ui', 'sans-serif'],
      },
      colors: {
        void: {
          DEFAULT: '#050508',
          card: '#0c0c12',
          border: '#1a1a24',
        },
        neon: {
          cyan: '#00f5ff',
          magenta: '#ff00aa',
          green: '#00ff88',
          red: '#ff3366',
          purple: '#a855f7',
        },
      },
      boxShadow: {
        'glow-cyan': '0 0 20px rgba(0, 245, 255, 0.3), 0 0 40px rgba(0, 245, 255, 0.15)',
        'glow-magenta': '0 0 20px rgba(255, 0, 170, 0.25), 0 0 40px rgba(255, 0, 170, 0.1)',
        'glow-green': '0 0 16px rgba(0, 255, 136, 0.3)',
        'glow-red': '0 0 16px rgba(255, 51, 102, 0.3)',
      },
    },
  },
  plugins: [],
}

