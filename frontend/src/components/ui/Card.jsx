// Shared card shell.
//
// Lifted from the caregiver dashboard's existing markup rather than rewritten,
// so the doctor screens are literally the same component and cannot drift.
// Card style is fixed here: white surface, one-pixel neutral border, 14px
// radius, no shadow by default. Depth comes from the border, not a drop
// shadow — that is what keeps the density readable at 12 cards on screen.

export function Card({ as: Tag = "div", className = "", children, ...rest }) {
  return (
    <Tag
      className={`bg-white border border-neutral-200 rounded-xl ${className}`}
      {...rest}
    >
      {children}
    </Tag>
  );
}

// A card with the standard internal padding. Most sections want this.
export function SectionCard({ className = "", children, ...rest }) {
  return (
    <Card className={`px-5 py-5 ${className}`} {...rest}>
      {children}
    </Card>
  );
}

// The small grey label above every section, with an optional 16px icon.
// Matches the caregiver dashboard's h2 exactly.
export function SectionHeading({ icon: Icon, children, action = null }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-3">
      <h2 className="flex items-center gap-1.5 text-sm font-medium text-neutral-500">
        {Icon ? <Icon size={16} weight="regular" /> : null}
        {children}
      </h2>
      {action}
    </div>
  );
}

// Shown wherever there is genuinely nothing yet. Never invents placeholder
// data to fill the space — an empty state that says "no sessions yet" is
// honest; a fake chart is not.
export function EmptyState({ children }) {
  return <p className="text-sm text-neutral-400 py-1">{children}</p>;
}
