import { useEffect } from 'react';
import type { Theme } from '@/lib/types';

export function applyTheme(theme: Theme) {
  try {
    localStorage.setItem('theme', theme);
  } catch {
    /* armazenamento indisponível: apenas aplica */
  }
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#100c0a' : '#fcf7f1');
}

export function useApplyTheme(theme: Theme | undefined) {
  useEffect(() => {
    if (theme) applyTheme(theme);
  }, [theme]);
}
