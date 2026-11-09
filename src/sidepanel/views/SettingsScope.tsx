import { useRef, useState } from 'preact/hooks';
import { validateCustomQuery } from '../../lib/github/search';
import { t } from '../../lib/i18n';
import type { Section } from '../../lib/model';
import { sectionLabel } from '../../lib/sectionLabel';
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
import { TeamPicker } from './SettingsTeams';

const FORM_ID = 'custom-section-form';

function saveSection(section: Section | null, changes: { label: string; query: string }) {
  return saveSettings(
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
}

function useCustomSectionForm(section: Section | null, onClose: () => void) {
  const [label, setLabel] = useState(section?.label ?? '');
  const [query, setQuery] = useState(section?.query ?? '');
  const [submitted, setSubmitted] = useState(false);
  const nameInput = useRef<HTMLElement>(null);
  const queryInput = useRef<HTMLElement>(null);

  const queryErrors = validateCustomQuery(query);
  const nameError = label.trim() === '' ? t('giveTheSectionAName') : undefined;

  async function save(event: Event) {
    event.preventDefault();
    setSubmitted(true);
    if (nameError || queryErrors.length > 0) {
      (nameError ? nameInput : queryInput).current?.focus();
      return;
    }
    await saveSection(section, { label: label.trim(), query: query.trim() });
    onClose();
  }
  return {
    label,
    setLabel,
    query,
    setQuery,
    submitted,
    nameInput,
    queryInput,
    queryErrors,
    nameError,
    save,
  };
}

function CustomSectionFields({ form }: { form: ReturnType<typeof useCustomSectionForm> }) {
  const {
    label,
    setLabel,
    query,
    setQuery,
    submitted,
    nameInput,
    queryInput,
    queryErrors,
    nameError,
  } = form;
  return (
    <>
      <TextField
        label={t('name')}
        value={label}
        onValueChange={setLabel}
        error={submitted ? nameError : undefined}
        hint={t('shownOnTheTab')}
        maxLength={MAX_SECTION_LABEL_LENGTH}
        autoComplete="off"
        inputRef={nameInput}
      />
      <TextField
        label={t('searchQuery')}
        value={query}
        onValueChange={setQuery}
        multiline
        rows={3}
        error={submitted || query !== '' ? queryErrors.join(' ') || undefined : undefined}
        hint={t('githubSSearchSyntaxForExampleLabelBugReview')}
        autoComplete="off"
        spellcheck={false}
        inputRef={queryInput}
      />
    </>
  );
}

/** Adds (`section` null) or edits a custom section; the query is checked as GitHub would. */
function CustomSectionDialog({
  section,
  onClose,
}: {
  section: Section | null;
  onClose: () => void;
}) {
  const form = useCustomSectionForm(section, onClose);
  return (
    <Dialog
      open
      onClose={onClose}
      title={section ? t('editCustomSection') : t('addCustomSection')}
      description={t('aTabInTheListThatFollowsAnyGithub')}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" form={FORM_ID} variant="primary">
            {t('save')}
          </Button>
        </>
      }
    >
      <form
        id={FORM_ID}
        class="settings-form"
        onSubmit={(event) => void form.save(event)}
        noValidate
      >
        <CustomSectionFields form={form} />
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
      message: t('removed', sectionLabel(section)),
      action: {
        label: t('undo'),
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
        aria-label={t('edit', sectionLabel(section))}
        onClick={onEdit}
      >
        {t('edit2')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        icon={<TrashIcon />}
        aria-label={t('remove', sectionLabel(section))}
        onClick={remove}
      >
        {t('remove2')}
      </Button>
    </div>
  );
}

/** Changes a repository list from what is stored, not from the copy on screen (see `RepoFilter`). */
function changeRepos(
  key: 'repoInclude' | 'repoExclude',
  update: (current: readonly string[]) => string[],
) {
  void saveSettings((current) => ({ ...current, [key]: update(current[key]) }), { refresh: true });
}

function SectionSwitch({ section, onEdit }: { section: Section; onEdit: () => void }) {
  return (
    <li class="settings-row">
      <Switch
        label={sectionLabel(section)}
        description={section.kind === 'custom' ? section.query : PRESET_DESCRIPTIONS[section.kind]}
        checked={section.enabled}
        onChange={(enabled) => {
          void saveSettings(
            (current) => ({
              ...current,
              sections: current.sections.map((s) => (s.id === section.id ? { ...s, enabled } : s)),
            }),
            { refresh: true },
          );
        }}
      />
      {section.kind === 'team_review_requested' && section.enabled && <TeamPicker />}
      {section.kind === 'custom' && <CustomActions section={section} onEdit={onEdit} />}
    </li>
  );
}

/** Which pull requests Prowl follows: preset and custom sections, and the repository filters. */
export function ScopeSettings() {
  const { sections, repoInclude, repoExclude } = settings.value;
  // `null` = a new section, a section = editing it, `undefined` = closed.
  const [editing, setEditing] = useState<Section | null>();

  return (
    <SettingsGroup title={t('sections')} description={t('chooseWhichPullRequestsProwlFollows')}>
      <h4 class="settings-subtitle">{t('sections')}</h4>
      <ul class="settings-list">
        {sections.map((section) => (
          <SectionSwitch key={section.id} section={section} onEdit={() => setEditing(section)} />
        ))}
      </ul>
      <Button class="settings-add" icon={<PlusIcon />} onClick={() => setEditing(null)}>
        {t('addCustomSection')}
      </Button>

      <h4 class="settings-subtitle">{t('repositories')}</h4>
      <RepoFilter
        name={t('include')}
        hint={t('onlyFollowPullRequestsInTheseLeaveEmptyTo')}
        patterns={repoInclude}
        onChange={(update) => changeRepos('repoInclude', update)}
      />
      <RepoFilter
        name={t('exclude')}
        hint={t('excludePullRequestsInTheseEvenWhenTheyMatchAn')}
        patterns={repoExclude}
        onChange={(update) => changeRepos('repoExclude', update)}
      />

      {editing !== undefined && (
        <CustomSectionDialog section={editing} onClose={() => setEditing(undefined)} />
      )}
    </SettingsGroup>
  );
}
