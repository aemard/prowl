import { useEffect, useState } from 'preact/hooks';
import type { PollState, Snapshot } from '../../lib/model';
import { type ActivityKind, pullRequestActivity } from './prActivity';

// Every card animation (arrive, merge, close, fade) lasts 1100ms; see PullRequestCardMotion.css.
export const CARD_TRANSITION_MS = 1100;
export const CARD_ENTER_MS = CARD_TRANSITION_MS;
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

/** Unknown departures retain the open baseline across progressive publications. */
export const DEPARTURE_TIMEOUT_MS = 10_000;
interface Transition {
  section: string;
  id: string;
  kind?: ActivityKind;
  deadline: number;
}
interface TransitionState {
  source: Snapshot | undefined;
  visible: Snapshot | undefined;
  scope: string;
  poll: PollState | undefined;
  transitions: Record<string, Transition>;
}

function renderTransitions(state: TransitionState): Snapshot | undefined {
  if (!state.source || !state.visible) return state.source;
  let visible = state.source;
  for (const section of Object.keys(state.source.sections)) {
    const retained: CardActivities = {};
    for (const transition of Object.values(state.transitions)) {
      if (transition.section === section) retained[transition.id] = transition.kind ?? 'fade';
    }
    visible = retainDepartingCards(
      { ...state.visible, sections: { [section]: state.visible.sections[section] ?? [] } },
      visible,
      retained,
    );
  }
  return visible;
}

function reconcile(
  previous: Snapshot,
  source: Snapshot,
  poll: PollState | undefined,
  transitions: Record<string, Transition>,
) {
  const now = Date.now();
  const changes = pullRequestActivity(previous, source);
  for (const [section, ids] of Object.entries(previous.sections)) {
    if (!(section in source.sections)) continue;
    for (const id of ids) {
      const key = JSON.stringify([section, id]);
      const before = previous.pullRequests[id];
      const after = source.pullRequests[id];
      const present = source.sections[section]?.includes(id);
      const current = transitions[key];
      if (after?.state === 'open' && present) {
        if (current?.kind !== 'new') delete transitions[key];
      } else if (before?.state === 'open' && !present && !current) {
        transitions[key] = { section, id, deadline: now + DEPARTURE_TIMEOUT_MS };
      }
      const pending = transitions[key];
      if (pending && !pending.kind) {
        if (after?.state === 'merged' || after?.state === 'closed') {
          transitions[key] = {
            ...pending,
            kind: after.state,
            deadline: now + CARD_TRANSITION_MS,
          };
        } else if (poll?.inFlight === false) {
          transitions[key] = { ...pending, kind: 'fade', deadline: now + CARD_TRANSITION_MS };
        }
      }
    }
    for (const change of changes) {
      const id = change.pr.id;
      if (!ids.includes(id) && !source.sections[section]?.includes(id)) continue;
      const key = JSON.stringify([section, id]);
      if (transitions[key]?.kind === change.kind) continue;
      transitions[key] = {
        section,
        id,
        kind: change.kind,
        deadline: now + (change.kind === 'new' ? CARD_ENTER_MS : CARD_TRANSITION_MS),
      };
    }
  }
  for (const [key, transition] of Object.entries(transitions)) {
    if (!(transition.section in source.sections)) delete transitions[key];
  }
}

export function useCardTransitions(source: Snapshot | undefined, poll?: PollState, scope = '') {
  const [state, setState] = useState<TransitionState>(() => ({
    source,
    scope,
    poll,
    visible: source,
    transitions: {},
  }));
  if (state.source !== source || state.poll !== poll || state.scope !== scope) {
    const sameViewer =
      source &&
      state.source &&
      state.scope === scope &&
      state.source.viewer.login.toLowerCase() === source.viewer.login.toLowerCase();
    const transitions = sameViewer ? { ...state.transitions } : {};
    if (source && sameViewer && state.visible && state.source) {
      reconcile(state.visible, source, poll, transitions);
    }
    const next = { source, scope, poll, transitions, visible: sameViewer ? state.visible : source };
    setState({ ...next, visible: renderTransitions(next) });
  }
  useEffect(() => {
    const times = Object.values(state.transitions).map((transition) => transition.deadline);
    if (!times.length) return;
    const timer = setTimeout(
      () =>
        setState((current) => {
          const transitions = { ...current.transitions };
          const now = Date.now();
          for (const [key, transition] of Object.entries(transitions)) {
            if (transition.deadline > now) continue;
            if (transition.kind) delete transitions[key];
            else
              transitions[key] = {
                ...transition,
                kind: 'fade',
                deadline: now + CARD_TRANSITION_MS,
              };
          }
          const next = { ...current, transitions };
          return { ...next, visible: renderTransitions(next) };
        }),
      Math.max(0, Math.min(...times) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [state]);
  const activity: CardActivities = {};
  const activityBySection: Record<string, CardActivities> = {};
  for (const { section, id, kind } of Object.values(state.transitions)) {
    if (!kind) continue;
    activity[id] = kind;
    activityBySection[section] ??= {};
    activityBySection[section][id] = kind;
  }
  return { snap: state.visible, activity, activityBySection };
}
