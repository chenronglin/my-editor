import type {JSX, ReactNode} from 'react';

import {createContext, useContext, useMemo, useState} from 'react';

export type MockRole = 'editor' | 'author';
export type MockDisplayMode = 'review' | 'final';

type MockUser = {
  id: string;
  name: string;
  role: MockRole;
};

type MockReviewSession = {
  baseVersion: number;
  enabled: boolean;
  expiresAt: string;
  id: string;
  lockScope: 'content';
  ownerRole: MockRole;
  ownerUserId: string;
  startedAt: string;
  status: 'ACTIVE';
};

type MockPermissions = {
  canCreateComment: boolean;
  canEditContent: boolean;
  canReplyComment: boolean;
  canStartReview: boolean;
  canStopReview: boolean;
};

type MockWorkflow = {
  chapterStatus: 'DRAFT' | 'IN_REVIEW' | 'REVISION_READY';
  currentUser: MockUser;
  displayMode: MockDisplayMode;
  permissions: MockPermissions;
  reviewSession: MockReviewSession | null;
  setDisplayMode: (mode: MockDisplayMode) => void;
  setRole: (role: MockRole) => void;
  startReview: () => void;
  stopReview: () => void;
  users: Record<MockRole, MockUser>;
  version: number;
};

const USERS: Record<MockRole, MockUser> = {
  author: {
    id: 'user_author_1',
    name: '作者B',
    role: 'author',
  },
  editor: {
    id: 'user_editor_1',
    name: '编辑A',
    role: 'editor',
  },
};

const MockWorkflowContext = createContext<MockWorkflow | null>(null);

function createReviewSession(owner: MockUser, version: number): MockReviewSession {
  const startedAt = new Date();
  const expiresAt = new Date(startedAt.getTime() + 5 * 60 * 1000);

  return {
    baseVersion: version,
    enabled: true,
    expiresAt: expiresAt.toISOString(),
    id: `mock_review_${startedAt.getTime()}`,
    lockScope: 'content',
    ownerRole: owner.role,
    ownerUserId: owner.id,
    startedAt: startedAt.toISOString(),
    status: 'ACTIVE',
  };
}

function getPermissions(
  currentUser: MockUser,
  displayMode: MockDisplayMode,
  reviewSession: MockReviewSession | null,
): MockPermissions {
  const isEditor = currentUser.role === 'editor';
  const isReviewActive = reviewSession !== null;
  const isFinalMode = displayMode === 'final';
  const ownsReview =
    reviewSession !== null && reviewSession.ownerUserId === currentUser.id;

  return {
    canCreateComment: true,
    canEditContent: !isFinalMode && (isEditor ? ownsReview : !isReviewActive),
    canReplyComment: true,
    canStartReview: !isFinalMode && isEditor && !isReviewActive,
    canStopReview: !isFinalMode && isEditor && ownsReview,
  };
}

export function MockWorkflowProvider({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  const [role, setRole] = useState<MockRole>('editor');
  const [displayMode, setDisplayMode] = useState<MockDisplayMode>('review');
  const [reviewSession, setReviewSession] =
    useState<MockReviewSession | null>(null);
  const [version, setVersion] = useState(17);
  const currentUser = USERS[role];

  const value = useMemo<MockWorkflow>(() => {
    const permissions = getPermissions(currentUser, displayMode, reviewSession);

    return {
      chapterStatus: reviewSession === null ? 'REVISION_READY' : 'IN_REVIEW',
      currentUser,
      displayMode,
      permissions,
      reviewSession,
      setDisplayMode,
      setRole,
      startReview: () => {
        if (!permissions.canStartReview) {
          return;
        }
        setReviewSession(createReviewSession(currentUser, version));
      },
      stopReview: () => {
        if (!permissions.canStopReview) {
          return;
        }
        setReviewSession(null);
        setVersion(currentVersion => currentVersion + 1);
      },
      users: USERS,
      version,
    };
  }, [currentUser, displayMode, reviewSession, version]);

  return (
    <MockWorkflowContext.Provider value={value}>
      {children}
    </MockWorkflowContext.Provider>
  );
}

export function useMockWorkflow(): MockWorkflow {
  const workflow = useContext(MockWorkflowContext);
  if (workflow === null) {
    throw new Error('useMockWorkflow must be used inside MockWorkflowProvider');
  }
  return workflow;
}
