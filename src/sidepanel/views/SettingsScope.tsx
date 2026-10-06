import { useRef, useState } from 'preact/hooks';
import { validateCustomQuery } from '../../lib/github/search';
import type { Section } from '../../lib/model';
import { MAX_SECTION_LABEL_LENGTH } from '../../lib/storage/settings';
import { PencilIcon, PlusIcon, TrashIcon } from '../components/icons';
import { RepoFilter } from '../components/RepoFilter';
import { Button } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { Switch } from '../components/ui/Switch';
import { TextField } from '../components/ui/TextField';
import { showToast } from '../components/ui/Toast';
import { saveSettings } from '../state/settings';
import { settings } from '../state/store';
import { SettingsGroup } from './SettingsGroup';
import { PRESET_DESCRIPTIONS } from './SettingsModel';

const FORM_ID = 'custom-section-form';

/** Adds (`section` null) or edits a custom section; the query is checked as GitHub would. */
function CustomSectionDialog({
  section,
  onClose,
}: {
  section: Section | null;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(section?.label ?? '');
  const [query, setQuery] = useState(section?.query ?? '');
  const [submitted, setSubmitted] = useState(false);
  const nameInput = useRef<HTMLElement>(null);
  const queryInput = useRef<HTMLElement>(null);

  const queryErrors = validateCustomQuery(query);
  const nameError = label.trim() === '' ? 'Give the section a name.' : undefined;

  async function save(event: Event) {
    event.preventDefault();
    setSubmitted(true);
    if (nameError || queryErrors.length > 0) {
      (nameError ? nameInput : queryInput).current?.focus();
      return;
    }
    const changes = { label: label.trim(), query: query.trim() };
    await saveSettings(
      (current) => ({
        ...current,
        sections: section
          ? current.sections.map((s) => (s.id === section.id ? { ...s, ...changes } : s))
          : [
              ...current.sections,
              {
                id: `custom-${crypto.randomUUID().slice(0, 8)}`,
                kind: 'custom',
                enabled: true,
                ...changes,
              },
            ],
      }),
      { refresh: true },
    );
    onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={section ? 'Edit custom section' : 'Add custom section'}
      description="A tab in the list that follows any GitHub pull request search."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={FORM_ID} variant="primary">
            Save
          </Button>
        </>
      }
    >
      <form id={FORM_ID} class="settings-form" onSubmit={(event) => void save(event)} noValidate>
        <TextField
          label="Name"
          value={label}
          onValueChange={setLabel}
          error={submitted ? nameError : undefined}
          hint="Shown on the tab."
          maxLength={MAX_SECTION_LABEL_LENGTH}
          autoComplete="off"
          inputRef={nameInput}
        />
        <TextField
          label="Search query"
          value={query}
          onValueChange={setQuery}
          multiline
          rows={3}
          error={submitted || query !== '' ? queryErrors.join(' ') || undefined : undefined}
          hint="GitHub's search syntax, for example: label:bug review-requested:@me. Prowl adds is:pr."
          autoComplete="off"
          spellcheck={false}
          inputRef={queryInput}
        />
      </form>
    </Dialog>
  );
}

function CustomActions({ section, onEdit }: { section: Section; onEdit: () => void }) {
  function remove() {
    const index = settings.value.sections.findIndex((s) => s.id === section.id);
    void saveSettings(
      (current) => ({ ...current, sections: current.sections.filter((s) => s.id !== section.id) }),
      { refresh: true },
    );
    showToast({
      message: `Removed “${section.label}”`,
      action: {
        label: 'Undo',
        onClick: () =>
          void saveSettings(
            (current) =>
              current.sections.some((s) => s.id === section.id)
                ? current
                : {
                    ...current,
                    sections: current.sections.toSpliced(index, 0, section),
                  },
            { refresh: true },
          ),
      },
    });
  }

  return (
    <div class="settings-row__actions">
      <Button
        size="sm"
        variant="ghost"
        icon={<PencilIcon />}
        aria-label={`Edit ${section.label}`}
        onClick={onEdit}
      >
        Edit
      </Button>
      <Button
        size="sm"
        variant="ghost"
        icon={<TrashIcon />}
        aria-label={`Remove ${section.label}`}
        onClick={remove}
      >
        Remove
      </Button>
    </div>
  );
}

/** Which pull requests Prowl follows: preset and custom sections, and the repository filters. */
export function ScopeSettings() {
  const { sections, repoInclude, repoExclude } = settings.value;
  // `null` = a new section, a section = editing it, `undefined` = closed.
  const [editing, setEditing] = useState<Section | null>();

  return (
    <SettingsGroup title="Pull requests" description="Choose which pull requests Prowl follows.">
      <h4 class="settings-subtitle">Sections</h4>
      <ul class="settings-list">
        {sections.map((section) => (
          <li class="settings-row" key={section.id}>
            <Switch
              label={section.label}
              description={
                section.kind === 'custom' ? section.query : PRESET_DESCRIPTIONS[section.kind]
              }
              checked={section.enabled}
              onChange={(enabled) =>
                void saveSettings(
                  (current) => ({
                    ...current,
                    sections: current.sections.map((s) =>
                      s.id === section.id ? { ...s, enabled } : s,
                    ),
                  }),
                  { refresh: true },
                )
              }
            />
            {section.kind === 'custom' && (
              <CustomActions section={section} onEdit={() => setEditing(section)} />
            )}
          </li>
        ))}
      </ul>
      <Button class="settings-add" icon={<PlusIcon />} onClick={() => setEditing(null)}>
        Add custom section
      </Button>

      <h4 class="settings-subtitle">Repositories</h4>
      <RepoFilter
        name="Include"
        hint="Only follow pull requests in these. Leave empty to follow every repository."
        patterns={repoInclude}
        onChange={(patterns) => void saveSettings({ repoInclude: patterns }, { refresh: true })}
      />
      <RepoFilter
        name="Exclude"
        hint="Hide pull requests in these, even when they match an include."
        patterns={repoExclude}
        onChange={(patterns) => void saveSettings({ repoExclude: patterns }, { refresh: true })}
      />

      {editing !== undefined && (
        <CustomSectionDialog section={editing} onClose={() => setEditing(undefined)} />
      )}
    </SettingsGroup>
  );
}
