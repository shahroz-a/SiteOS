import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { UndoToast } from "@/components/UndoToast";

/** How long a toast stays on screen before it self-dismisses. */
const TOAST_DURATION_MS = 4000;

/** The options for an undoable toast. */
export type UndoToastOptions = {
  /** The message describing the action that just happened. */
  message: string;
  /** Label for the undo action button. Defaults to "Undo". */
  actionLabel?: string;
  /** Called when the reader taps the action button. */
  onAction: () => void;
};

type ToastContextValue = {
  /**
   * Show an undo snackbar from anywhere in the app. Restarts the auto-dismiss
   * timer if a toast is already visible. Returns nothing; tapping the action
   * runs `onAction` and dismisses the toast.
   */
  showUndoToast: (options: UndoToastOptions) => void;
  /** Hide the current toast immediately. */
  hideToast: () => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Wraps the app and renders a single global {@link UndoToast} above all screens.
 * Any descendant can trigger a toast via {@link useToast}, so undoable actions
 * (un-saving, removing from a collection, etc.) no longer need to wire up their
 * own visible/message/timer state.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<UndoToastOptions | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hideToast = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setToast(null);
  }, []);

  const showUndoToast = useCallback((options: UndoToastOptions) => {
    setToast(options);
  }, []);

  // The snackbar self-dismisses after a few seconds. Restart the timer whenever
  // a new toast is shown, and clear it on unmount.
  useEffect(() => {
    if (toast === null) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), TOAST_DURATION_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [toast]);

  const handleAction = useCallback(() => {
    if (toast === null) return;
    toast.onAction();
    hideToast();
  }, [toast, hideToast]);

  const value = useMemo(
    () => ({ showUndoToast, hideToast }),
    [showUndoToast, hideToast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <UndoToast
        visible={toast !== null}
        message={toast?.message ?? ""}
        actionLabel={toast?.actionLabel}
        onAction={handleAction}
      />
    </ToastContext.Provider>
  );
}

/** Access the global toast controls. Must be used within a {@link ToastProvider}. */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (ctx === null) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}
