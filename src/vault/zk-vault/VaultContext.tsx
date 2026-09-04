// src/zk-vault/VaultContext.tsx

import React, {
  createContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import { IVaultStorageAdapter, VaultStatus } from './types';
import {
  generateDEK,
  deriveKeyFromPin,
  wrapKey,
  unwrapKey,
  authenticatePasskey,
  registerPasskey,
  encryptData,
  decryptData,
  EncryptedPayload,
  bufToHex,
  hexToBuf,
} from './crypto';

interface VaultContextType {
  isUnlocked: boolean;
  sessionKey: CryptoKey | null;
  setupVault: (pin: string, userId: string, email: string, options?: { skipPasskey?: boolean; authenticatorAttachment?: AuthenticatorAttachment }) => Promise<boolean>;
  unlockWithPin: (pin: string, userId: string) => Promise<boolean>;
  unlockWithPasskey: (userId: string) => Promise<boolean>;
  resetPin: (newPin: string, userId: string) => Promise<boolean>;
  /** Adds or replaces the passkey envelope. Works whether or not one exists. */
  setPasskey: (userId: string, email: string) => Promise<boolean>;
  /** Reports which unlock methods are provisioned (reads the storage adapter). */
  checkVaultStatus: (userId: string) => Promise<VaultStatus>;
  encryptPayload: (data: unknown) => Promise<EncryptedPayload>;
  decryptPayload: (payload: EncryptedPayload) => Promise<unknown>;
  lock: () => void;
  /** Epoch ms the idle auto-lock timer will fire at, or null when unlocked
   *  with no timeout configured / not yet unlocked. A plain getter (not
   *  reactive state) so UI that wants a live countdown polls it on its own
   *  interval instead of forcing every vault consumer to re-render each
   *  second the activity listeners reset it. */
  getAutoLockDeadline: () => number | null;
}

export const VaultContext = createContext<VaultContextType | undefined>(
  undefined
);

interface VaultProviderProps {
  storageAdapter: IVaultStorageAdapter;
  /** Lock immediately when the tab is hidden/backgrounded. Default true. */
  lockOnWindowBlur?: boolean;
  /** Idle auto-lock timeout in ms. 0 disables. Default 5 minutes. */
  autoLockTimeoutMs?: number;
  /** Surface internal errors. Defaults to console. */
  onError?: (err: Error) => void;
  children: React.ReactNode;
}

export function VaultProvider({
  storageAdapter,
  lockOnWindowBlur = true,
  autoLockTimeoutMs = 300000,
  onError,
  children,
}: VaultProviderProps) {
  // The DEK handle never leaves this closure — it is not exposed on the
  // context value. Consumers encrypt/decrypt through the provided functions.
  const sessionKeyRef = useRef<CryptoKey | null>(null);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Epoch ms the idle timer will fire at. A ref, not state — it's rewritten
  // on every mousemove/keydown/scroll/touchstart, and turning that into a
  // state update would re-render every VaultContext consumer in the app
  // (the Provider wraps the whole /app tree) on every mouse jiggle. UI that
  // wants a live countdown reads it via getAutoLockDeadline() on its own tick.
  const autoLockAtRef = useRef<number | null>(null);

  const handleError = useCallback(
    (err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      if (onError) onError(error);
      else console.error('[zk-vault]', error);
    },
    [onError]
  );

  const lock = useCallback(() => {
    sessionKeyRef.current = null;
    setIsUnlocked(false);
    autoLockAtRef.current = null;
  }, []);

  const getAutoLockDeadline = useCallback(() => autoLockAtRef.current, []);

  // --- Auto-locking ---
  useEffect(() => {
    if (!isUnlocked) return;

    const handleVisibilityChange = () => {
      if (lockOnWindowBlur && document.visibilityState === 'hidden') lock();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    if (autoLockTimeoutMs > 0) {
      const activityEvents = ['mousemove', 'keydown', 'scroll', 'touchstart'];
      const resetTimer = () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        autoLockAtRef.current = Date.now() + autoLockTimeoutMs;
        timeoutRef.current = setTimeout(lock, autoLockTimeoutMs);
      };

      activityEvents.forEach((e) => window.addEventListener(e, resetTimer));
      resetTimer();

      return () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        autoLockAtRef.current = null;
        activityEvents.forEach((e) =>
          window.removeEventListener(e, resetTimer)
        );
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isUnlocked, autoLockTimeoutMs, lockOnWindowBlur, lock]);

  // --- Status ---
  const checkVaultStatus = useCallback(
    async (userId: string): Promise<VaultStatus> => {
      try {
        const data = await storageAdapter.loadEnvelopes(userId);
        const hasPin = !!data.pinEnvelope && !!data.pinSalt;
        const hasPasskey = !!data.passkeyEnvelope && !!data.passkeyId;
        return {
          status: 'ok',
          exists: hasPin || hasPasskey,
          hasPin,
          hasPasskey,
        };
      } catch (err) {
        // Report the failure distinctly so callers don't mistake a transient
        // load error for an empty vault and route the user into setup.
        const error = err instanceof Error ? err : new Error(String(err));
        handleError(error);
        return {
          status: 'error',
          exists: false,
          hasPin: false,
          hasPasskey: false,
          error,
        };
      }
    },
    [storageAdapter, handleError]
  );

  // --- Setup ---
  const setupVault = useCallback(
    async (pin: string, userId: string, email: string, options?: { skipPasskey?: boolean; authenticatorAttachment?: AuthenticatorAttachment }) => {
      try {
        const dek = await generateDEK();
        const salt = crypto.getRandomValues(new Uint8Array(32));
        const hexSalt = bufToHex(salt.buffer);
        const pinWrappingKey = await deriveKeyFromPin(pin, salt.buffer);
        const pinEnvelope = await wrapKey(dek, pinWrappingKey);

        let passkeyId: string | null = null;
        let passkeyEnvelope: string | null = null;
        if (!options?.skipPasskey) {
          try {
            const { id, key } = await registerPasskey(userId, email, { authenticatorAttachment: options?.authenticatorAttachment });
            passkeyId = id;
            passkeyEnvelope = JSON.stringify(await wrapKey(dek, key));
          } catch (err) {
            // Passkey is optional at setup; user can add it later via setPasskey.
            handleError(
              new Error('Passkey skipped or unsupported during setup: ' + String(err))
            );
          }
        }

        await storageAdapter.saveEnvelopes(userId, {
          pinEnvelope: JSON.stringify(pinEnvelope),
          pinSalt: hexSalt,
          passkeyEnvelope,
          passkeyId,
        });

        sessionKeyRef.current = dek;
        setIsUnlocked(true);
        return true;
      } catch (err) {
        handleError(err);
        return false;
      }
    },
    [storageAdapter, handleError]
  );

  // --- Unlock ---
  const unlockWithPin = useCallback(
    async (pin: string, userId: string) => {
      try {
        const data = await storageAdapter.loadEnvelopes(userId);
        if (!data.pinEnvelope || !data.pinSalt) return false;

        const saltBuf = hexToBuf(data.pinSalt);
        const kek = await deriveKeyFromPin(pin, saltBuf);
        const envelope = JSON.parse(data.pinEnvelope) as EncryptedPayload;
        const dek = await unwrapKey(envelope, kek);

        sessionKeyRef.current = dek;
        setIsUnlocked(true);
        return true;
      } catch (err) {
        handleError(err);
        return false;
      }
    },
    [storageAdapter, handleError]
  );

  const unlockWithPasskey = useCallback(
    async (userId: string) => {
      try {
        const data = await storageAdapter.loadEnvelopes(userId);
        if (!data.passkeyEnvelope || !data.passkeyId) return false;

        const passkeyWrappingKey = await authenticatePasskey(data.passkeyId);
        const envelope = JSON.parse(data.passkeyEnvelope) as EncryptedPayload;
        const dek = await unwrapKey(envelope, passkeyWrappingKey);

        sessionKeyRef.current = dek;
        setIsUnlocked(true);
        return true;
      } catch (err) {
        handleError(err);
        return false;
      }
    },
    [storageAdapter, handleError]
  );

  // --- Resets (require an unlocked vault) ---
  const resetPin = useCallback(
    async (newPin: string, userId: string) => {
      try {
        if (!sessionKeyRef.current) throw new Error('Vault must be unlocked.');

        // Snapshot only the fields this operation owns, so a rollback cannot
        // clobber a passkey envelope changed by a concurrent session.
        const current = await storageAdapter.loadEnvelopes(userId);
        const priorPin = {
          pinEnvelope: current.pinEnvelope,
          pinSalt: current.pinSalt,
        };

        const salt = crypto.getRandomValues(new Uint8Array(32));
        const hexSalt = bufToHex(salt.buffer);
        const newPinWrappingKey = await deriveKeyFromPin(newPin, salt.buffer);
        const newPinEnvelope = await wrapKey(sessionKeyRef.current, newPinWrappingKey);

        try {
          await storageAdapter.saveEnvelopes(userId, {
            pinEnvelope: JSON.stringify(newPinEnvelope),
            pinSalt: hexSalt,
          });
          return true;
        } catch (saveError) {
          try {
            await storageAdapter.saveEnvelopes(userId, priorPin);
          } catch (rollbackError) {
            handleError(
              new Error(
                `CRITICAL: PIN reset failed and rollback also failed. The PIN envelope may be corrupt; the passkey may still unlock the vault. Original: ${String(
                  saveError
                )}. Rollback: ${String(rollbackError)}`
              )
            );
          }
          throw saveError;
        }
      } catch (err) {
        handleError(err);
        return false;
      }
    },
    [storageAdapter, handleError]
  );

  // Add or replace the passkey envelope. Replaces resetPasskey and also serves
  // as the "add a passkey to a PIN-only vault" pathway.
  const setPasskey = useCallback(
    async (userId: string, email: string) => {
      try {
        if (!sessionKeyRef.current) throw new Error('Vault must be unlocked.');

        const current = await storageAdapter.loadEnvelopes(userId);
        const priorPasskey = {
          passkeyEnvelope: current.passkeyEnvelope,
          passkeyId: current.passkeyId,
        };

        const { id: passkeyId, key } = await registerPasskey(userId, email);
        const newPasskeyEnvelope = await wrapKey(sessionKeyRef.current, key);

        try {
          await storageAdapter.saveEnvelopes(userId, {
            passkeyEnvelope: JSON.stringify(newPasskeyEnvelope),
            passkeyId,
          });
          return true;
        } catch (saveError) {
          try {
            await storageAdapter.saveEnvelopes(userId, priorPasskey);
          } catch (rollbackError) {
            handleError(
              new Error(
                `CRITICAL: Passkey update failed and rollback also failed. The PIN may still unlock the vault. Original: ${String(
                  saveError
                )}. Rollback: ${String(rollbackError)}`
              )
            );
          }
          throw saveError;
        }
      } catch (err) {
        handleError(err);
        return false;
      }
    },
    [storageAdapter, handleError]
  );

  // --- Data helpers ---
  const encryptPayload = useCallback(
    async (data: unknown) => {
      if (!sessionKeyRef.current) throw new Error('Vault is locked');
      return await encryptData(data, sessionKeyRef.current);
    },
    []
  );

  const decryptPayload = useCallback(
    async (payload: EncryptedPayload) => {
      if (!sessionKeyRef.current) throw new Error('Vault is locked');
      return await decryptData(payload, sessionKeyRef.current);
    },
    []
  );

  return (
    <VaultContext.Provider
      value={{
        isUnlocked: isUnlocked,
        sessionKey: sessionKeyRef.current,
        setupVault,
        unlockWithPin,
        unlockWithPasskey,
        resetPin,
        setPasskey,
        checkVaultStatus,
        encryptPayload,
        decryptPayload,
        lock,
        getAutoLockDeadline,
      }}
    >
      {children}
    </VaultContext.Provider>
  );
}
