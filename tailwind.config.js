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
        },
        lexa: {
          accent: '#5FD3FF',
          cyan: '#3EC7F4',
          'blue-mid': '#3A7BFF',
          'blue-deep': '#1F4BFF',
          glass: 'rgba(58, 123, 255, 0.08)',
          border: 'rgba(95, 211, 255, 0.25)',
        },
        neon: {
          green: '#00ff88',
          red: '#ff3366',
        },
      },
      backgroundColor: {
        'lexa-glass': 'rgba(58, 123, 255, 0.08)',
      },
      borderColor: {
        'lexa-border': 'rgba(95, 211, 255, 0.25)',
      },
      backgroundImage: {
        'lexa-gradient': 'linear-gradient(135deg, #3EC7F4 0%, #3A7BFF 50%, #1F4BFF 100%)',
      },
      boxShadow: {
        'glow-lexa': '0 0 20px rgba(95, 211, 255, 0.3), 0 0 40px rgba(95, 211, 255, 0.15)',
        'glow-green': '0 0 16px rgba(0, 255, 136, 0.3)',
        'glow-red': '0 0 16px rgba(255, 51, 102, 0.3)',
      },
    },
  },
  plugins: [],
}
