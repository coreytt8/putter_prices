import clsx from "clsx";

export default function HeroSection({ children, className = "", containerClassName = "max-w-5xl" }) {
  return (
    <section
      className={clsx(
        "relative isolate overflow-hidden px-6 py-20 text-white sm:py-24",
        className
      )}
    >
      <div className={clsx("mx-auto", containerClassName)}>{children}</div>
    </section>
  );
}
