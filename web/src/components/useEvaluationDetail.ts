/**
 * Impure hook: tracks whether the URL hash is the evaluation detail route (Req 8.3).
 * Subscribes to `hashchange`; the pure matching lives in `../routing/evaluationDetail`.
 */

import { useEffect, useState } from "react";
import { isEvaluationDetailHash } from "../routing/evaluationDetail";

function currentHash(): string {
  if (typeof window === "undefined" || !window.location) {
    return "";
  }
  return window.location.hash;
}

/** `true` while the evaluation detail view is the explicitly opened route. */
export function useEvaluationDetail(): boolean {
  const [open, setOpen] = useState<boolean>(() => isEvaluationDetailHash(currentHash()));

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const onHashChange = (): void => {
      setOpen(isEvaluationDetailHash(currentHash()));
    };
    window.addEventListener("hashchange", onHashChange);
    onHashChange();
    return () => {
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  return open;
}
