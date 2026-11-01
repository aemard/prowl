import { useState } from 'preact/hooks';
import { TextField } from './ui/TextField';

export interface NumberFieldProps {
  id?: string;
  label: string;
  /** The saved value. */
  value: number;
  min: number;
  max: number;
  /** Called with every whole number in range as it is typed; other text is not saved. */
  onCommit: (value: number) => void;
  hint?: string;
  class?: string;
}

/**
 * A whole number that saves as you type. What is typed stays on screen, with an error while it
 * is not valid; leaving the field shows the saved value again.
 */
export function NumberField({
  id,
  label,
  value,
  min,
  max,
  onCommit,
  hint,
  class: className,
}: NumberFieldProps) {
  const [draft, setDraft] = useState<string>();
  const parse = (text: string) => {
    const number = Number(text);
    return text.trim() !== '' && Number.isInteger(number) && number >= min && number <= max
      ? number
      : undefined;
  };

  return (
    <TextField
      id={id}
      class={className}
      label={label}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={draft ?? String(value)}
      hint={hint}
      error={
        draft !== undefined && parse(draft) === undefined
          ? `Enter a whole number from ${min} to ${max}.`
          : undefined
      }
      onValueChange={(text) => {
        setDraft(text);
        const number = parse(text);
        if (number !== undefined) onCommit(number);
      }}
      onBlur={() => setDraft(undefined)}
    />
  );
}
