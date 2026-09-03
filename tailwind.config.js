/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', '"Public Sans"', '"Noto Sans Khmer"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', '"Noto Sans Khmer"', 'monospace'],
        // Khmer-primary text (headings, degree/institution names) — heavier
        // weight + looser line-height reads better for the script than the
        // default sans stack tuned for Latin text.
        khmer: ['"Noto Sans Khmer"', '"IBM Plex Sans"', 'sans-serif'],
      },
      colors: {
        indigo: {
          50: '#eef8fc',
          100: '#d5edf7',
          200: '#b1dff0',
          300: '#7dc9e5',
          400: '#42aed5',
          500: '#2393be',
          600: '#097bb7', // Deep Blue Pantone 7461C
          650: '#116fa0', // Slight shade for hovers
          700: '#166395',
          800: '#16537b',
          900: '#174566',
          950: '#102d45',
        },
        teal: {
          50: '#edfafa',
          100: '#d1f1f4',
          200: '#aae4eb',
          300: '#71d0db',
          400: '#4cc4d3', // Cyan Pantone 2226C
          500: '#23a0b0',
          600: '#1f8191',
          700: '#1d6876',
          800: '#1e5562',
          900: '#1c4753',
          950: '#0f2f38',
        }
      }
    },
  },
  plugins: [],
}
