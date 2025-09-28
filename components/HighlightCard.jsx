import clsx from "clsx";

export default function HighlightCard({ children, className = "" }) {
  return (
    <div
      className={clsx(
        "flex h-full flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-lg",
        className
      )}
    >
      {children}
    </div>
  );
}
