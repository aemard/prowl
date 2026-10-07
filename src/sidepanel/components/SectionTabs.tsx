import type { ComponentChildren, TargetedKeyboardEvent } from 'preact';
import { AlertIcon, KebabHorizontalIcon } from './icons';
import { Badge } from './ui/Badge';
import { Menu } from './ui/Menu';
import './SectionTabs.css';

export interface SectionTab {
  id: string;
  /** What the bar shows under the icon: a short word, or a custom section's own (truncated) label. */
  label: string;
  /** The section's full name: tooltip, and the item's text in the "More" menu. */
  fullLabel: string;
  /** Decorative 16 px icon. */
  icon: ComponentChildren;
  count: number;
  /** The section could not be loaded: the item shows a warning instead of a count. */
  failed?: boolean;
}

export interface SectionTabsProps {
  tabs: SectionTab[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** Prefix for the ids the tabs and the panel use to point at each other. */
  idPrefix: string;
}

const tabId = (prefix: string, id: string) => `${prefix}-tab-${id}`;
export const panelId = (prefix: string) => `${prefix}-panel`;

/** Items that fit a 320 px panel. With more sections, the first ones and a "More" menu. */
const MAX_ITEMS = 5;

/**
 * The section bar, fixed at the bottom of the panel (APG tabs pattern, automatic activation):
 * one tab stop, arrows / Home / End move and select. Each item is an icon with its count over a
 * short label. Past `MAX_ITEMS` sections, the last slot is a "More" menu button with the rest
 * (outside the tab list, which may only hold tabs), marked selected when the section shown is in
 * it. `data-bottom-bar` tells menus and the seen observer that the bar covers the page under it.
 */
export function SectionTabs({ tabs, selectedId, onSelect, idPrefix }: SectionTabsProps) {
  const overflow = tabs.length > MAX_ITEMS ? tabs.slice(MAX_ITEMS - 1) : [];
  const shown = overflow.length > 0 ? tabs.slice(0, MAX_ITEMS - 1) : tabs;
  const inMore = overflow.find((tab) => tab.id === selectedId);
  // The tab stop: the selected tab, or the first one while the selection is under "More".
  const stopId = inMore ? shown[0]?.id : selectedId;

  function onKeyDown(event: TargetedKeyboardEvent<HTMLDivElement>) {
    const at = shown.findIndex((tab) => tabId(idPrefix, tab.id) === (event.target as Element).id);
    const target = {
      ArrowRight: (at + 1) % shown.length,
      ArrowLeft: (at - 1 + shown.length) % shown.length,
      Home: 0,
      End: shown.length - 1,
    }[event.key];
    const next = target === undefined ? undefined : shown[target];
    if (!next) return;
    event.preventDefault();
    onSelect(next.id);
    document.getElementById(tabId(idPrefix, next.id))?.focus();
  }

  return (
    <div class="section-tabs" data-bottom-bar="">
      <div class="section-tabs__list" role="tablist" aria-label="Sections" onKeyDown={onKeyDown}>
        {shown.map((tab) => {
          const selected = tab.id === selectedId;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              class="section-tabs__item"
              id={tabId(idPrefix, tab.id)}
              aria-selected={selected}
              aria-controls={panelId(idPrefix)}
              tabIndex={tab.id === stopId ? 0 : -1}
              title={tab.fullLabel}
              onClick={() => onSelect(tab.id)}
            >
              {/* First in the DOM so the name reads "Mine 7"; the column is reversed on screen. */}
              <span class="section-tabs__label">{tab.label}</span>
              <span class="section-tabs__top">
                {tab.icon}
                {tab.failed ? (
                  <span class="section-tabs__failed" title="Could not load this section">
                    <AlertIcon size={12} />
                    <span class="sr-only">Could not load</span>
                  </span>
                ) : (
                  <Badge size="sm" tone={selected ? 'accent' : 'neutral'}>
                    {tab.count}
                  </Badge>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {overflow.length > 0 && (
        <Menu
          align="end"
          label="More sections"
          items={overflow.map((tab) => ({
            id: tab.id,
            label: tab.fullLabel,
            icon: tab.icon,
            hint: tab.failed ? 'Could not load' : String(tab.count),
            checked: tab.id === selectedId,
            onSelect: () => onSelect(tab.id),
          }))}
          trigger={(props) => (
            <button
              {...props}
              type="button"
              class="section-tabs__item section-tabs__more"
              data-selected={inMore !== undefined}
            >
              <span class="section-tabs__label">
                More
                <span class="sr-only">
                  {' sections'}
                  {inMore && `, ${inMore.fullLabel} selected`}
                </span>
              </span>
              <span class="section-tabs__top">
                <KebabHorizontalIcon />
              </span>
            </button>
          )}
        />
      )}
    </div>
  );
}
