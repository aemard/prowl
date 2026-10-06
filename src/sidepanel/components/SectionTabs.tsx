import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { AlertIcon } from './icons';
import { Badge } from './ui/Badge';
import './SectionTabs.css';

export interface SectionTab {
  id: string;
  label: string;
  count: number;
  /** The section could not be loaded: the tab shows a warning instead of a count. */
  failed?: boolean;
}

export interface SectionTabsProps {
  tabs: SectionTab[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** Prefix for the ids the tabs and the panel use to point at each other. */
  idPrefix: string;
}

export const tabId = (prefix: string, id: string) => `${prefix}-tab-${id}`;
export const panelId = (prefix: string) => `${prefix}-panel`;

/**
 * Section tabs (APG tabs pattern, automatic activation): one tab stop on the selected tab,
 * arrows / Home / End move and select. The tab list scrolls sideways when it is too wide.
 */
export function SectionTabs({ tabs, selectedId, onSelect, idPrefix }: SectionTabsProps) {
  const list = useRef<HTMLDivElement>(null);

  // Keep the selected tab in view in a tab list that scrolls sideways.
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [selectedId]);

  // A mouse wheel only scrolls vertically: let it scroll a tab list that overflows sideways.
  function onWheel(event: JSX.TargetedWheelEvent<HTMLDivElement>) {
    const el = event.currentTarget;
    if (event.deltaX !== 0 || el.scrollWidth <= el.clientWidth) return;
    event.preventDefault();
    el.scrollLeft += event.deltaY;
  }

  function onKeyDown(event: JSX.TargetedKeyboardEvent<HTMLDivElement>) {
    const at = tabs.findIndex((tab) => tab.id === selectedId);
    const target = {
      ArrowRight: (at + 1) % tabs.length,
      ArrowLeft: (at - 1 + tabs.length) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    }[event.key];
    const next = target === undefined ? undefined : tabs[target];
    if (!next) return;
    event.preventDefault();
    onSelect(next.id);
    document.getElementById(tabId(idPrefix, next.id))?.focus();
  }

  return (
    <div
      class="section-tabs"
      role="tablist"
      aria-label="Sections"
      ref={list}
      onKeyDown={onKeyDown}
      onWheel={onWheel}
    >
      {tabs.map((tab) => {
        const selected = tab.id === selectedId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            class="section-tabs__tab"
            id={tabId(idPrefix, tab.id)}
            aria-selected={selected}
            aria-controls={panelId(idPrefix)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(tab.id)}
          >
            <span class="section-tabs__label">{tab.label}</span>
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
          </button>
        );
      })}
    </div>
  );
}
