import { useId, useRef, useState } from 'preact/hooks';
import { normalizeRepoPattern } from '../../lib/storage/settings';
import { PlusIcon, XIcon } from './icons';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import { TextField } from './ui/TextField';
import './RepoFilter.css';

export interface RepoFilterProps {
  /** Names the list: "Include" or "Exclude". */
  name: string;
  hint: string;
  /** `owner` or `owner/name` patterns, already valid. */
  patterns: readonly string[];
  onChange: (patterns: string[]) => void;
}

/** A list of repository patterns shown as removable chips, with a field that validates new ones. */
export function RepoFilter({ name, hint, patterns, onChange }: RepoFilterProps) {
  const hintId = useId();
  const input = useRef<HTMLElement>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState('');
  const list = name.toLowerCase();

  function add(event: Event) {
    event.preventDefault();
    const pattern = normalizeRepoPattern(text);
    if (pattern === null) {
      setError('Enter an owner or owner/name, for example acme or acme/widgets.');
    } else if (patterns.some((known) => known.toLowerCase() === pattern.toLowerCase())) {
      setError(`${pattern} is already in the ${list} list.`);
    } else {
      onChange([...patterns, pattern]);
      setText('');
      setError(undefined);
      setStatus(`Added ${pattern} to the ${list} list.`);
    }
    input.current?.focus();
  }

  function remove(pattern: string) {
    onChange(patterns.filter((known) => known !== pattern));
    setStatus(`Removed ${pattern} from the ${list} list.`);
    // The button that had focus is gone: keep the keyboard where the user is working.
    input.current?.focus();
  }

  return (
    <fieldset class="repo-filter" aria-describedby={hintId}>
      <legend class="repo-filter__name">{name}</legend>
      <p id={hintId} class="repo-filter__hint">
        {hint}
      </p>
      {patterns.length > 0 && (
        <ul class="repo-filter__chips">
          {patterns.map((pattern) => (
            <li class="repo-chip" key={pattern}>
              <span class="repo-chip__name" title={pattern}>
                {pattern}
              </span>
              <IconButton
                label={`Remove ${pattern}`}
                size="sm"
                class="repo-chip__remove"
                onClick={() => remove(pattern)}
              >
                <XIcon size={12} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <form class="repo-filter__add" onSubmit={add} noValidate>
        <TextField
          class="repo-filter__field"
          label={`${name} repository`}
          hideLabel
          value={text}
          onValueChange={(value) => {
            setText(value);
            setError(undefined);
          }}
          placeholder="owner or owner/name"
          error={error}
          autoComplete="off"
          spellcheck={false}
          inputRef={input}
        />
        <Button type="submit" icon={<PlusIcon />} aria-label={`Add to ${list} list`}>
          Add
        </Button>
      </form>
      <p class="sr-only" role="status">
        {status}
      </p>
    </fieldset>
  );
}
