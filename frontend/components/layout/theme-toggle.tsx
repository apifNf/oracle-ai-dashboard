"use client";

import { useState, useEffect } from 'react';
import { useTheme } from 'next-themes';

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const isDark = theme === 'dark';

  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      // Mengubah w-32 h-10 menjadi w-20 h-7
      className={`relative flex items-center w-20 h-7 rounded-full transition-colors duration-500 ease-in-out shadow-inner ${
        isDark ? 'bg-zinc-800' : 'bg-gray-300'
      }`}
      aria-label="Toggle Theme"
    >
      <span className={`absolute left-2.5 text-[9px] font-bold tracking-wider transition-opacity duration-500 ${isDark ? 'opacity-0' : 'opacity-100 text-gray-600'}`}>LGT</span>
      <span className={`absolute right-2.5 text-[9px] font-bold tracking-wider transition-opacity duration-500 ${isDark ? 'opacity-100 text-gray-400' : 'opacity-0'}`}>DRK</span>

      {/* Mengubah knob w-14 h-14 menjadi w-9 h-9, dan menyesuaikan jarak geser (translate) */}
      <div
        className={`absolute flex items-center justify-center w-9 h-9 rounded-full transition-transform duration-500 ease-in-out ${
          isDark
            ? 'translate-x-12 bg-black/40 border-gray-600/50'
            : '-translate-x-1 bg-white/60 border-white/80'
        } backdrop-blur-md border shadow-[0_4px_16px_0_rgba(0,0,0,0.2)]`}
        style={{ boxShadow: 'inset 0 2px 8px rgba(255, 255, 255, 0.4)' }}
      >
        {isDark ? (
          <svg className="w-4 h-4 text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.8)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
          </svg>
        ) : (
          <svg className="w-4 h-4 text-yellow-600 drop-shadow-[0_0_8px_rgba(255,255,255,0.8)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
        )}
      </div>
    </button>
  );
}