// Patient avatar.
//
// No stock photography, no illustration, no generated faces. Either the real
// photo a caregiver uploaded, or a plain initial on a flat colour from the
// app's own palette. Anything else on a clinical screen reads as decoration.
//
// Colour is derived from the id, so a patient keeps the same one everywhere.

const AVATAR_COLORS = ["#2f968c", "#4bb3a8", "#78716c", "#a8a29e", "#1f625c"];

const SIZES = {
  sm: "w-9 h-9 text-sm",
  md: "w-11 h-11 text-lg",
  lg: "w-14 h-14 text-xl",
};

export default function Avatar({ name, photo, id = 0, size = "md" }) {
  const dimensions = SIZES[size] ?? SIZES.md;

  if (photo) {
    return (
      <img
        src={photo}
        alt=""
        className={`${dimensions} rounded-full object-cover shrink-0 border border-neutral-200`}
      />
    );
  }

  const initial = name?.trim()?.[0]?.toUpperCase() || "?";

  return (
    <div
      className={`${dimensions} rounded-full flex items-center justify-center text-white font-medium shrink-0`}
      style={{ backgroundColor: AVATAR_COLORS[id % AVATAR_COLORS.length] }}
      aria-hidden="true"
    >
      {initial}
    </div>
  );
}
