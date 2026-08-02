import type { ComposeDraft } from "../shared/contracts.js";
import {
  IDENTITY_NAME_LIMIT,
  MailIdentityError,
  buildIdentity,
  identitiesForAccount,
  normalizeIdentityLine,
  removeIdentity,
  resolveIdentity,
  sortIdentities,
  type MailIdentity,
  type MailIdentityInput,
} from "../shared/identities.js";
import type { PersistedState, StoredAccount } from "./persisted-state.js";

/** Older state files predate the field, so every read goes through here rather than touching it raw. */
export const identitiesOf = (state: PersistedState): MailIdentity[] => state.identities ?? [];

export const listIdentities = (state: PersistedState): MailIdentity[] => sortIdentities(identitiesOf(state));

export const listAccountIdentities = (state: PersistedState, accountId: string): MailIdentity[] =>
  identitiesForAccount(identitiesOf(state), accountId);

export const upsertIdentity = (state: PersistedState, input: MailIdentityInput, newId: () => string): MailIdentity[] => {
  state.identities = buildIdentity(identitiesOf(state), input, newId);
  return listIdentities(state);
};

export const deleteIdentity = (state: PersistedState, id: string): MailIdentity[] => {
  state.identities = removeIdentity(identitiesOf(state), id);
  return listIdentities(state);
};

export const promoteIdentityToDefault = (state: PersistedState, id: string): MailIdentity[] => {
  const identity = identitiesOf(state).find(candidate => candidate.id === id);
  if (!identity) throw new MailIdentityError("IDENTITY_NOT_FOUND", "That identity no longer exists.");
  state.identities = identitiesOf(state).map(candidate =>
    candidate.accountId === identity.accountId ? { ...candidate, isDefault: candidate.id === id } : candidate,
  );
  return listIdentities(state);
};

/**
 * Every account gets one identity the moment it exists, so the composer always has a From address
 * and "an account keeps at least one identity" is true from the start rather than after a first edit.
 */
export const seedAccountIdentity = (state: PersistedState, account: StoredAccount, newId: () => string): MailIdentity | null => {
  if (identitiesOf(state).some(identity => identity.accountId === account.id)) return null;
  state.identities = buildIdentity(identitiesOf(state), {
    accountId: account.id,
    displayName: normalizeIdentityLine(account.displayName, IDENTITY_NAME_LIMIT) || account.email,
    email: account.email,
    isDefault: true,
  }, newId);
  return listAccountIdentities(state, account.id)[0] ?? null;
};

export const forgetAccountIdentities = (state: PersistedState, accountId: string): void => {
  state.identities = identitiesOf(state).filter(identity => identity.accountId !== accountId);
};

/** Resolves the identity a draft sends from, ignoring an id that belongs to a different account. */
export const identityForDraft = (state: PersistedState, draft: ComposeDraft): MailIdentity | null =>
  resolveIdentity(identitiesOf(state), draft.accountId, draft.identityId);
