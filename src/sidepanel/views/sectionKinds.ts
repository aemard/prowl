import { t } from '../../lib/i18n';
import type { SectionKind } from '../../lib/model';
import {
  BellIcon,
  EyeIcon,
  FilterIcon,
  GitPullRequestIcon,
  MentionIcon,
  PeopleIcon,
  PersonIcon,
} from '../components/icons';
import type { IconComponent } from '../components/icons/Icon';

/**
 * Per section kind: its icon and short name in the section bar (a custom section shows its own
 * label) and the hint of its empty list. A new kind is one entry here.
 */
export const KINDS: Record<SectionKind, { icon: IconComponent; short?: string; empty: string }> = {
  your_turn: {
    icon: BellIcon,
    get short() {
      return t('yourTurnSection');
    },
    get empty() {
      return t('yourTurnEmpty');
    },
  },
  authored: {
    icon: GitPullRequestIcon,
    get short() {
      return t('mine');
    },
    get empty() {
      return t('pullRequestsYouOpenWillShowUpHere');
    },
  },
  review_requested: {
    icon: EyeIcon,
    get short() {
      return t('review');
    },
    get empty() {
      return t('whenSomeoneAsksYouForAReviewItWill');
    },
  },
  team_review_requested: {
    icon: PeopleIcon,
    get short() {
      return t('teams');
    },
    get empty() {
      return t('noReviewRequestsForYourTeams');
    },
  },
  mentioned: {
    icon: MentionIcon,
    get short() {
      return t('mentions');
    },
    get empty() {
      return t('pullRequestsThatMentionYouWillShowUpHere');
    },
  },
  assigned: {
    icon: PersonIcon,
    get short() {
      return t('assigned');
    },
    get empty() {
      return t('pullRequestsAssignedToYouWillShowUpHere');
    },
  },
  custom: {
    icon: FilterIcon,
    get empty() {
      return t('noOpenPullRequestsMatchThisSearch');
    },
  },
};
