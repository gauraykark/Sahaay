// A face on a My People card — or, failing that, a letter.
//
// There are three things a stored photo can be, and this is the one place
// that knows it:
//
//   * a Blob, which is what new cards store. IndexedDB holds blobs natively;
//     the base64 data URLs the old code wrote cost a third more bytes and had
//     to be decoded on every single render.
//   * a data-URL string, on any card added before the switch. Still readable,
//     so nobody loses a photo.
//   * nothing at all, because the photo is optional.
//
// The no-photo case renders a large initial. It must NEVER fall through to a
// broken-image icon: a grey torn-page glyph where a family member's face
// should be reads, to the person this app is for, as something being wrong.
// `onError` covers the same ground for a stored photo that will not decode.

import { useLayoutEffect, useState } from "react";

import { initialFor } from "@shared/people";

/**
 * Resolves whatever is stored on `person.photo` into a `src`, or null.
 *
 * An object URL is a resource, not a derived value, so it is created and
 * revoked in the SAME effect run. The tidier-looking version -- useMemo to
 * create, a separate effect to revoke -- is broken, and quietly: React runs
 * effects twice on mount in development, the first cleanup revokes the url,
 * useMemo does not re-run because its dependency did not change, and the
 * <img> is left pointing at a revoked blob. Every family photo falls back to
 * its initial, which looks exactly like "no photo was ever added".
 *
 * Revoking matters. Skipping it leaks the whole decoded image for the life of
 * the document, which on a page showing seven faces is the difference between
 * a few hundred KB and a few tens of MB.
 *
 * useLayoutEffect, not useEffect, so the url exists before the browser paints.
 * With useEffect the first painted frame shows the fallback initial and then
 * swaps to the face.
 */
function usePhotoUrl(photo) {
  const [blobUrl, setBlobUrl] = useState(null);

  useLayoutEffect(() => {
    // Nothing to build for a missing photo or a legacy data URL. `blobUrl` is
    // left as it is rather than cleared, because the two lines below return
    // before ever reading it in those cases -- and the cleanup from the
    // previous run has already revoked whatever it held.
    if (!photo || typeof photo === "string") return undefined;

    const objectUrl = URL.createObjectURL(photo);
    // The url and its revoke have to live in one effect run, so this write
    // cannot move out. See the note above for what breaks when it does.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBlobUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [photo]);

  if (!photo) return null;
  if (typeof photo === "string") return photo; // legacy data URL
  return blobUrl;
}

/**
 * The initial, drawn as SVG text rather than set in pixels.
 *
 * In fill mode there is no pixel size to set a font from -- the box is however
 * wide the grid column happens to be that frame. A viewBox does the scaling
 * instead: the letter is always the same fraction of the box, at 40px or at
 * 400px, with no measuring and no container queries.
 *
 * `meet` (the default) fits the square viewBox inside a wider box, so on a 4:3
 * tile the letter is sized off the height and centred across the width, which
 * is what keeps it from growing into a banner.
 *
 * Absolutely positioned, because a plain `w-full h-full` svg still MEASURES as
 * its viewBox: a square. Inside a 4:3 tile that square becomes the flex item's
 * min-content height and stretches the tile back into a square -- one card in
 * a row of six, the one with no photo, silently taller than its neighbours.
 * Taking it out of flow means the aspect ratio is the only thing setting the
 * height, which is what it is there to do.
 */
function Initial({ person }) {
  return (
    <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full">
      <text
        x="50"
        y="50"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="46"
        fontWeight="600"
        fill="currentColor"
      >
        {initialFor(person)}
      </text>
    </svg>
  );
}

/**
 * @param {object}  person   the card
 * @param {number}  size     rendered square, in px. Ignored when `fill`.
 * @param {boolean} fill     fill the parent box instead of measuring in px.
 *                           A card tile's photo is as wide as the card and as
 *                           tall as the card's aspect ratio says, and neither
 *                           of those is a number this component can know --
 *                           the parent sets both and this fills what it gets.
 * @param {boolean} rounded  true for a circle, false for a rounded square
 */
export default function PersonPhoto({
  person,
  size = 56,
  fill = false,
  rounded = true,
  className = "",
}) {
  const url = usePhotoUrl(person?.photo);
  // Which url failed, not whether one did. Storing the url means a new photo
  // gets a fresh chance to load without an effect resetting a flag.
  const [failedUrl, setFailedUrl] = useState(null);

  // A filled tile carries no radius of its own: it is already clipped by the
  // card's `overflow-hidden`, and rounding it again leaves four pale slivers
  // in the corners where the two curves disagree.
  const shape = rounded ? "rounded-full" : fill ? "" : "rounded-2xl";
  const layout = fill ? "w-full h-full" : "shrink-0";
  const box = fill ? undefined : { width: size, height: size };

  if (url && url !== failedUrl) {
    return (
      <img
        src={url}
        alt=""
        style={box}
        onError={() => setFailedUrl(url)}
        className={`${shape} ${layout} object-cover bg-neutral-100 ${className}`}
      />
    );
  }

  return (
    <div
      style={box}
      aria-hidden="true"
      className={`${shape} ${layout} relative overflow-hidden
        bg-primary-500 text-white ${className}`}
    >
      <Initial person={person} />
    </div>
  );
}
