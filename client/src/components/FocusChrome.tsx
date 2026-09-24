export interface FocusChromeProps {
  label: string;
  onExit: () => void;
}

export function FocusChrome({ label, onExit }: FocusChromeProps) {
  return (
    <div className="focus-chrome" data-testid="focus-chrome" role="region" aria-label="Focused passage">
      <span className="focus-chrome-label" title={label}>
        {label}
      </span>
      <button type="button" className="focus-chrome-exit" data-testid="focus-exit" onClick={onExit}>
        Exit focus
      </button>
    </div>
  );
}
