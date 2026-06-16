import type { AppProviders } from '../../../lib/providers';
import { createDidSlotPrivateState, isValidDidSlotState } from './private-state';
import { SLOT_PRIVATE_STATE_ID, type DidSlotPrivateState } from './types';
import type { OwnerVaultStatus } from '../../types/did';

export async function createDeploymentPrivateState(
  providers: AppProviders,
): Promise<DidSlotPrivateState> {
  return createDidSlotPrivateState({
    networkId: providers.networkId,
    contractAddress: '',
  });
}

export async function persistSlotPrivateState(
  providers: AppProviders,
  contractAddress: string,
  state: DidSlotPrivateState,
): Promise<void> {
  providers.privateStateProvider.setContractAddress(contractAddress as never);
  await providers.privateStateProvider.set(SLOT_PRIVATE_STATE_ID, state);
}

export async function getSlotPrivateState(
  providers: AppProviders,
  contractAddress: string,
): Promise<DidSlotPrivateState | null> {
  providers.privateStateProvider.setContractAddress(contractAddress as never);
  const existing = await providers.privateStateProvider.get(SLOT_PRIVATE_STATE_ID);
  return isValidDidSlotState(existing) ? existing : null;
}

export async function getOwnerVaultStatus(
  _providers: AppProviders,
  contractAddress: string,
): Promise<OwnerVaultStatus> {
  return { hasLocalVault: false, contractAddress, matchesOnChain: null };
}

export async function exportOwnerVaultBackup(): Promise<string> {
  throw new Error(
    'Owner vault backups are not used by the DID registry v2 controller model.',
  );
}

export async function restoreOwnerVaultBackup(
  _providers: AppProviders,
  contractAddress: string,
): Promise<OwnerVaultStatus> {
  return { hasLocalVault: false, contractAddress, matchesOnChain: null };
}
