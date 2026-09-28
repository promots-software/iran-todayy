'use client';
/** Shared icon-only control; the shell owns the existing persisted theme state. */
export function ThemeToggle({dark,onToggle}:{dark:boolean;onToggle:()=>void}) {
 const label=dark?'تفعيل المظهر الفاتح':'تفعيل المظهر الداكن';
 return <button type="button" className="secondary theme-toggle" onClick={onToggle} aria-label={label} title={label}>
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
   {dark?<><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></>:<path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/>}
  </svg>
 </button>;
}
