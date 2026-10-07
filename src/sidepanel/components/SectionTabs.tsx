import type { TargetedKeyboardEvent, TargetedWheelEvent } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { AlertIcon, ChevronRightIcon } from './icons';
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
 * arrows / Home / End move and select. The tab list scrolls sideways when it is too wide, and
 * a fade with a chevron at an edge says there are more tabs that way.
 */
export function SectionTabs({ tabs, selectedId, onSelect, idPrefix }: SectionTabsProps) {
  const list = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ start: false, end: false });

  function measure() {
    const el = list.current;
    if (!el) return;
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setMore((was) => (was.start === start && was.end === end ? was : { start, end }));
  }

  // What fits changes with the tabs (names, counts, a warning instead of a count) and with the
  // panel's width.
  const shape = tabs.map(({ label, count, failed }) => `${label}:${count}:${failed}`).join('\n');
  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [shape]);

  // Keep the selected tab in view in a tab list that scrolls sideways.
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [selectedId]);

  // A mouse wheel only scrolls vertically: let it scroll a tab list that overflows sideways.
  function onWheel(event: TargetedWheelEvent<HTMLDivElement>) {
    const el = event.currentTarget;
    if (event.deltaX !== 0 || el.scrollWidth <= el.clientWidth) return;
    event.preventDefault();
    el.scrollLeft += event.deltaY;
  }

  function onKeyDown(event: TargetedKeyboardEvent<HTMLDivElement>) {
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
    <div class="section-tabs-frame">
      <div
        class="section-tabs"
        role="tablist"
        aria-label="Sections"
        ref={list}
        onKeyDown={onKeyDown}
        onWheel={onWheel}
        onScroll={measure}
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
      {more.start && (
        <span class="section-tabs__more" data-side="start" aria-hidden="true">
          <ChevronRightIcon />
        </span>
      )}
      {more.end && (
        <span class="section-tabs__more" data-side="end" aria-hidden="true">
          <ChevronRightIcon />
        </span>
      )}
    </div>
  );
}
