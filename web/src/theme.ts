import { useEffect, useState } from 'react';
export function useDark() {
  const [dark, setDark] = useState(
    () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches,
  );
  useEffect(() => {
    const m = matchMedia('(prefers-color-scheme: dark)');
    const change = () => setDark(m.matches);
    m.addEventListener('change', change);
    return () => m.removeEventListener('change', change);
  }, []);
  return dark;
}
