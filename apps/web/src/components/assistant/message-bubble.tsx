export function MessageBubble({
  role,
  tone = "info",
  children,
}: Readonly<{ role: "bot" | "user"; tone?: "info" | "error"; children: React.ReactNode }>) {
  return <div className={`asst-bubble asst-bubble-${role}${tone === "error" ? " asst-bubble-error" : ""}`}>{children}</div>;
}

export function TypingBubble() {
  return (
    <div className="asst-bubble asst-bubble-bot asst-typing" role="status" aria-label="در حال بارگذاری">
      <span /><span /><span />
    </div>
  );
}
