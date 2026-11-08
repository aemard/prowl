import { useEffect, useState } from 'preact/hooks';
import type { Snapshot } from '../../lib/model';
import { type ActivityKind, pullRequestActivity } from './prActivity';

export const CARD_TRANSITION_MS = 1100;
export type CardActivities = Record<string, ActivityKind>;

/** Keep departing cards in their original sections until their exit animation finishes. */
export function retainDepartingCards(
  previous: Snapshot,
  next: Snapshot,
  activity: CardActivities,
): Snapshot {
  const result = {
    ...next,
    pullRequests: { ...next.pullRequests },
    sections: { ...next.sections },
  };
  for (const [id, kind] of Object.entries(activity)) {
    if (kind === 'new' || !previous.pullRequests[id]) continue;
    const before = previous.pullRequests[id];
    const after = next.pullRequests[id] ?? before;
    // Keep the sort position while the card departs; GitHub's closure updates updatedAt.
    result.pullRequests[id] = { ...after, updatedAt: before.updatedAt };
    for (const [section, ids] of Object.entries(previous.sections)) {
      const index = ids.indexOf(id);
      if (index < 0 || !(section in next.sections)) continue;
      const visible = [...(result.sections[section] ?? [])];
      if (!visible.includes(id)) visible.splice(index, 0, id);
      result.sections[section] = visible;
    }
  }
  return result;
}

/** Transitions belong to the visible list, so first mount and changing accounts stay quiet. */
export function useCardTransitions(source: Snapshot | undefined) {
  const [state, setState] = useState(() => ({
    source,
    visible: source,
    activity: {} as CardActivities,
  }));
  if (state.source !== source) {
    const sameViewer =
      source && state.source?.viewer.login.toLowerCase() === source.viewer.login.toLowerCase();
    const activity: CardActivities = sameViewer ? { ...state.activity } : {};
    if (source && sameViewer) {
      for (const change of pullRequestActivity(state.source, source))
        activity[change.pr.id] = change.kind;
      for (const [id, kind] of Object.entries(activity)) {
        if (kind !== 'new' && source.pullRequests[id]?.state === 'open') delete activity[id];
      }
    }
    setState({
      source,
      activity,
      visible:
        source && sameViewer && state.visible
          ? retainDepartingCards(state.visible, source, activity)
          : source,
    });
  }
  useEffect(() => {
    if (Object.keys(state.activity).length === 0) return;
    const timer = setTimeout(
      () =>
        setState((current) => ({
          source: current.source,
          visible: current.source,
          activity: {},
        })),
      CARD_TRANSITION_MS,
    );
    return () => clearTimeout(timer);
  }, [state.source]);
  return { snap: state.visible, activity: state.activity };
}
