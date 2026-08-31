// One item, rendered and answered.
//
// The errorless behaviour that used to live in GameShell lives here now, so
// the session runner can drive twelve items in a row without twelve shells.
// GameShell is gone; this is what replaced its inner half.

import { useCallback, useEffect, useRef, useState } from "react";

import { useSpeak, useT } from "../../lib/i18n";
import RENDERERS from "./renderers";

// How long the gentle correction stays up. Long enough to read, short enough
// not to dwell on it.
const CORRECTION_MS = 2200;

export default function ItemStage({ item, onDone }) {
  const t = useT();
  const say = useSpeak();
  const [correcting, setCorrecting] = useState(false);
  // Set in an effect, not during render: reading the clock while rendering is
  // impure, and the timing we want is "when the patient first saw this item"
  // anyway, which is mount.
  const startedRef = useRef(0);
  const doneRef = useRef(false);

  useEffect(() => {
    startedRef.current = Date.now();
    doneRef.current = false;
  }, [item]);

  const answer = useCallback(
    (wasCorrect) => {
      if (doneRef.current || correcting) return;

      const finish = () => {
        doneRef.current = true;
        setCorrecting(false);
        onDone({
          item,
          correct: wasCorrect,
          attempted: true,
          latencyMs: Date.now() - startedRef.current,
          status: "completed",
        });
      };

      if (wasCorrect) {
        finish();
        return;
      }

      // Errorless: no failure signal at all. The right answer appears warmly,
      // the patient's pick is left alone, and we move on. They should not be
      // able to tell they got it wrong.
      setCorrecting(true);
      // useSpeak keys on the item, so the correction speaks once per item
      // and in the patient's own language -- speak(text, langToLocale()) was
      // passing a string where an options object goes, so every utterance in
      // the games came out as en-IN regardless of the setting.
      say(t("lets_look_together"), `correct-${item.id}`);
      setTimeout(finish, CORRECTION_MS);
    },
    [correcting, item, onDone, t]
  );

  const Renderer = RENDERERS[item.template];
  if (!Renderer) return null;

  return <Renderer item={item} t={t} correcting={correcting} onAnswer={answer} />;
}
