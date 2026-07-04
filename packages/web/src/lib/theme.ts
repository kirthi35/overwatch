import { useCallback, useState } from 'react';

export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = useCallback(() => {
    setDark((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle('dark', next);
      localStorage.setItem('ow-theme', next ? 'dark' : 'light');
      return next;
    });
  }, []);
  return { dark, toggle };
}
