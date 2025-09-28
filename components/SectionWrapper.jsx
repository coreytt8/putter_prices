import clsx from "clsx";

const VARIANT_STYLES = {
  dark: "bg-slate-950 text-white",
  light: "bg-white text-slate-900",
  muted: "bg-slate-100 text-slate-900",
};

export default function SectionWrapper({
  variant = "light",
  className = "",
  containerClassName = "max-w-6xl",
  children,
}) {
  const variantClass = VARIANT_STYLES[variant] || VARIANT_STYLES.light;

  return (
    <section className={clsx("px-6 py-16 sm:py-20", variantClass, className)}>
      <div className={clsx("mx-auto", containerClassName)}>{children}</div>
    </section>
  );
}
