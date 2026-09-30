import { type ClipboardEvent, type KeyboardEvent, useRef } from 'react';

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  labelledBy: string;
  disabled?: boolean;
}

/** One box per digit: typing advances, Backspace steps back, pasting fills them all. */
export function OtpInput({ value, onChange, labelledBy, disabled }: Props) {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const last = value.length - 1;

  const focusBox = (i: number) => boxes.current[Math.max(0, Math.min(i, last))]?.focus();

  const handleChange = (i: number, raw: string) => {
    const digits = raw.replace(/\D/g, '');
    // SMS autofill delivers the whole code into one box.
    if (digits.length === value.length) {
      onChange(digits.split(''));
      focusBox(last);
      return;
    }
    const digit = digits.slice(-1);
    const next = [...value];
    next[i] = digit;
    onChange(next);
    if (digit && i < last) focusBox(i + 1);
  };

  const handleKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !value[i] && i > 0) focusBox(i - 1);
    if (e.key === 'ArrowLeft') focusBox(i - 1);
    if (e.key === 'ArrowRight') focusBox(i + 1);
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, value.length);
    if (!digits) return;
    onChange(value.map((_, i) => digits[i] ?? ''));
    focusBox(digits.length);
  };

  return (
    <div role="group" aria-labelledby={labelledBy} className="flex gap-2">
      {value.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            boxes.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          // Only the first box, so the browser's SMS autofill lands the whole code there.
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${i + 1} of ${value.length}`}
          value={digit}
          disabled={disabled}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          className={`login-otp-box ${digit ? 'login-otp-box--filled' : ''}`}
        />
      ))}
    </div>
  );
}
