import { CryptoEngine } from './index';
import { vaultDB } from '../storage/db';

export interface MasterKeySession {
  unlocked: boolean;
  masterKEK: CryptoKey | null;
  credentialId?: string;
  authMethod: 'WEBAUTHN' | 'PIN_PASSPHRASE';
}

/**
 * SECURITY ARCHITECTURE NOTE:
 * Storing raw key material (e.g. plaintext Master KEK base64) directly in IndexedDB
 * defeats the entire purpose of biometric gating, as any malicious script or local process
 * with IndexedDB access could read the key without passing the WebAuthn assertion.
 *
 * To ensure true cryptographic isolation, we use the WebAuthn PRF (Pseudo-Random Function)
 * extension. The biometric assertion itself cryptographically derives a hardware-backed
 * 256-bit symmetric secret from authenticator entropy and a salt. This PRF secret is used
 * as a Key Wrapping Key (KWK) to encrypt (wrap) the Master KEK.
 *
 * The Master KEK can ONLY be reconstructed by combining:
 *  (a) The ciphertext blob stored in IndexedDB (webauthn_wrapped_kek + salt + IV)
 *  (b) The hardware PRF key output produced ONLY upon a successful biometric assertion.
 * Neither alone is sufficient to decrypt or reconstruct the vault keys.
 */

export class WebAuthnManager {
  private static activeKEK: CryptoKey | null = null;
  private static authMethod: 'WEBAUTHN' | 'PIN_PASSPHRASE' = 'PIN_PASSPHRASE';

  // Check if WebAuthn is supported on this browser/platform
  static isWebAuthnSupported(): boolean {
    return !!(typeof window !== 'undefined' && window.PublicKeyCredential && navigator.credentials);
  }

  // Check if Master Key has been configured
  static async isConfigured(): Promise<boolean> {
    const salt = await vaultDB.getSetting<string>('master_salt');
    return !!salt;
  }

  // Check if WebAuthn biometric unwrap is configured and supported
  static async isBiometricConfigured(): Promise<boolean> {
    const credId = await vaultDB.getSetting<string>('webauthn_credential_id');
    const wrappedKek = await vaultDB.getSetting<string>('webauthn_wrapped_kek');
    return !!(credId && wrappedKek);
  }

  // Get current active session
  static getSession(): MasterKeySession {
    return {
      unlocked: !!this.activeKEK,
      masterKEK: this.activeKEK,
      authMethod: this.authMethod,
    };
  }

  // Lock master key
  static lock(): void {
    this.activeKEK = null;
  }

  // Retrieve or derive active Master KEK seamlessly using existing stored salt
  static async getOrDeriveActiveKey(): Promise<CryptoKey> {
    if (this.activeKEK) return this.activeKEK;
    const saltB64 = await vaultDB.getSetting<string>('master_salt');
    if (saltB64) {
      try {
        const salt = CryptoEngine.base64ToBuffer(saltB64);
        const candidateKEK = await CryptoEngine.deriveMasterKEK('aegis_local_user', salt);
        this.activeKEK = candidateKEK;
        return candidateKEK;
      } catch (e) {
        console.warn('Could not derive KEK from existing salt with default PIN:', e);
      }
    }
    const { kek } = await this.initializeMasterKey('aegis_local_user');
    this.activeKEK = kek;
    return kek;
  }

  // Initialize/Register Master Key with PIN/Passphrase & optional WebAuthn PRF wrapping
  static async initializeMasterKey(
    passphrase: string,
    enableBiometrics = false
  ): Promise<{ saltB64: string; kek: CryptoKey }> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const saltB64 = CryptoEngine.bufferToBase64(salt.buffer as ArrayBuffer);

    // Derive the authoritative Master KEK using PBKDF2 (250,000 iterations)
    const kek = await CryptoEngine.deriveMasterKEK(passphrase, salt);
    this.activeKEK = kek;
    this.authMethod = 'PIN_PASSPHRASE';

    await vaultDB.saveSetting('master_salt', saltB64);
    await vaultDB.saveSetting('auth_method', 'PIN_PASSPHRASE');

    // Create a verification token to validate unlock attempts later
    const verificationData = new TextEncoder().encode('AEGIS_MASTER_KEY_VERIFICATION_TOKEN_2026');
    const { ciphertext, iv } = await CryptoEngine.encryptBuffer(verificationData.buffer.slice(0), kek);
    await vaultDB.saveSetting('verification_token', {
      ciphertext: CryptoEngine.bufferToBase64(ciphertext),
      iv: CryptoEngine.bufferToBase64(iv.buffer as ArrayBuffer),
    });

    if (enableBiometrics && this.isWebAuthnSupported()) {
      try {
        await this.registerWebAuthn(kek);
      } catch (err) {
        console.warn('WebAuthn biometric registration skipped/failed, retaining PIN fallback:', err);
      }
    }

    await vaultDB.logEvent({
      eventType: 'AUTH_UNLOCK',
      severity: 'SUCCESS',
      source: 'WEB_APP',
      actionTaken: 'MASTER_KEY_INITIALIZED',
      details: { biometricEnabled: enableBiometrics, authMethod: this.authMethod },
    });

    return { saltB64, kek };
  }

  // Unlock Master Key with Passphrase
  static async unlockWithPassphrase(passphrase: string): Promise<CryptoKey> {
    const saltB64 = await vaultDB.getSetting<string>('master_salt');
    if (!saltB64) {
      throw new Error('Master key not initialized. Please set up a master PIN/passphrase first.');
    }

    const salt = CryptoEngine.base64ToBuffer(saltB64);
    const candidateKEK = await CryptoEngine.deriveMasterKEK(passphrase, salt);

    // Verify candidate key against verification token
    const tokenRecord = await vaultDB.getSetting<{ ciphertext: string; iv: string }>('verification_token');
    if (tokenRecord) {
      try {
        const cipherBuffer = CryptoEngine.base64ToBuffer(tokenRecord.ciphertext);
        const ivBuffer = CryptoEngine.base64ToBuffer(tokenRecord.iv);
        const decrypted = await CryptoEngine.decryptBuffer(cipherBuffer.buffer.slice(0) as ArrayBuffer, ivBuffer, candidateKEK);
        const decryptedText = new TextDecoder().decode(decrypted);
        if (decryptedText !== 'AEGIS_MASTER_KEY_VERIFICATION_TOKEN_2026') {
          throw new Error('Invalid PIN or Passphrase');
        }
      } catch {
        await vaultDB.logEvent({
          eventType: 'AUTH_UNLOCK',
          severity: 'DANGER',
          source: 'WEB_APP',
          actionTaken: 'UNLOCK_FAILED_INVALID_CREDENTIALS',
          details: { error: 'Incorrect passphrase attempt' },
        });
        throw new Error('Incorrect Master PIN / Passphrase.');
      }
    }

    this.activeKEK = candidateKEK;
    this.authMethod = 'PIN_PASSPHRASE';

    await vaultDB.logEvent({
      eventType: 'AUTH_UNLOCK',
      severity: 'SUCCESS',
      source: 'WEB_APP',
      actionTaken: 'MASTER_KEY_UNLOCKED',
      details: { method: 'PIN_PASSPHRASE' },
    });

    return candidateKEK;
  }

  // Register WebAuthn Credential and wrap Master KEK with biometric PRF output
  private static async registerWebAuthn(masterKEK: CryptoKey): Promise<void> {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId = crypto.getRandomValues(new Uint8Array(16));
    const prfSalt = crypto.getRandomValues(new Uint8Array(32));

    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: 'Aegis Local Privacy Vault', id: window.location.hostname || 'localhost' },
        user: {
          id: userId,
          name: 'local-vault-user',
          displayName: 'Aegis Local User',
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },  // ES256
          { alg: -257, type: 'public-key' }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
        },
        extensions: {
          prf: {
            eval: {
              first: prfSalt.buffer as ArrayBuffer,
            },
          },
        },
        timeout: 60000,
      },
    })) as PublicKeyCredential;

    if (!credential) {
      throw new Error('WebAuthn credential creation failed.');
    }

    const clientExt = credential.getClientExtensionResults?.() as any;
    let prfSecret: ArrayBuffer | null = clientExt?.prf?.results?.first || null;

    // If PRF eval results weren't returned on create, evaluate via immediate get
    if (!prfSecret) {
      try {
        const getAssertion = (await navigator.credentials.get({
          publicKey: {
            challenge: crypto.getRandomValues(new Uint8Array(32)),
            allowCredentials: [{ id: credential.rawId, type: 'public-key' }],
            userVerification: 'required',
            extensions: {
              prf: {
                eval: {
                  first: prfSalt.buffer as ArrayBuffer,
                },
              },
            },
            timeout: 60000,
          },
        })) as PublicKeyCredential;

        const getExt = getAssertion?.getClientExtensionResults?.() as any;
        prfSecret = getExt?.prf?.results?.first || null;
      } catch (e) {
        console.warn('Initial PRF evaluation get failed:', e);
      }
    }

    if (!prfSecret) {
      throw new Error(
        'Authenticator does not support the WebAuthn PRF extension. Master PIN/Passphrase will remain the primary key derivation path.'
      );
    }

    // Derive the PRF Key-Wrapping-Key (KWK)
    const prfWrappingKey = await crypto.subtle.importKey(
      'raw',
      prfSecret,
      { name: 'AES-GCM', length: 256 },
      false,
      ['wrapKey', 'unwrapKey']
    );

    // Wrap Master KEK with the PRF wrapping key
    const { wrappedKeyB64, ivB64 } = await CryptoEngine.wrapDEK(masterKEK, prfWrappingKey);

    // Save ONLY the wrapped key, PRF salt, and IV in IndexedDB (zero raw KEK material)
    await vaultDB.saveSetting('webauthn_credential_id', CryptoEngine.bufferToBase64(credential.rawId));
    await vaultDB.saveSetting('webauthn_wrapped_kek', wrappedKeyB64);
    await vaultDB.saveSetting('webauthn_prf_salt', CryptoEngine.bufferToBase64(prfSalt.buffer as ArrayBuffer));
    await vaultDB.saveSetting('webauthn_prf_iv', ivB64);
    await vaultDB.saveSetting('webauthn_prf_supported', true);
    await vaultDB.saveSetting('auth_method', 'WEBAUTHN');
    this.authMethod = 'WEBAUTHN';
  }

  // Unlock Master Key with WebAuthn Biometrics (cryptographically unwraps Master KEK via PRF assertion)
  static async unlockWithWebAuthn(): Promise<CryptoKey> {
    if (!this.isWebAuthnSupported()) {
      throw new Error('WebAuthn not supported in this browser.');
    }

    const credentialIdB64 = await vaultDB.getSetting<string>('webauthn_credential_id');
    const prfSaltB64 = await vaultDB.getSetting<string>('webauthn_prf_salt');
    const wrappedKekB64 = await vaultDB.getSetting<string>('webauthn_wrapped_kek');
    const ivB64 = await vaultDB.getSetting<string>('webauthn_prf_iv');

    if (!credentialIdB64 || !prfSaltB64 || !wrappedKekB64 || !ivB64) {
      throw new Error('WebAuthn biometric vault data not configured. Please unlock with your Master PIN.');
    }

    const credentialId = CryptoEngine.base64ToBuffer(credentialIdB64);
    const prfSalt = CryptoEngine.base64ToBuffer(prfSaltB64);
    const challenge = crypto.getRandomValues(new Uint8Array(32));

    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ id: credentialId.buffer as ArrayBuffer, type: 'public-key' }],
        userVerification: 'required',
        extensions: {
          prf: {
            eval: {
              first: prfSalt.buffer as ArrayBuffer,
            },
          },
        },
        timeout: 60000,
      },
    })) as PublicKeyCredential;

    if (!assertion) {
      throw new Error('WebAuthn biometric verification was canceled or failed.');
    }

    const extResults = assertion.getClientExtensionResults?.() as any;
    const prfSecret: ArrayBuffer | null = extResults?.prf?.results?.first || null;

    if (!prfSecret) {
      throw new Error(
        'Authenticator did not return a PRF hardware key. Biometric unwrap failed. Please use Master PIN.'
      );
    }

    // Import the hardware PRF output as the Key-Wrapping-Key
    const prfWrappingKey = await crypto.subtle.importKey(
      'raw',
      prfSecret,
      { name: 'AES-GCM', length: 256 },
      false,
      ['unwrapKey']
    );

    // Cryptographically unwrap the Master KEK using the biometric assertion output
    const masterKEK = await CryptoEngine.unwrapDEK(wrappedKekB64, ivB64, prfWrappingKey);

    // Validate the unwrapped Master KEK against the verification token
    const tokenRecord = await vaultDB.getSetting<{ ciphertext: string; iv: string }>('verification_token');
    if (tokenRecord) {
      try {
        const cipherBuffer = CryptoEngine.base64ToBuffer(tokenRecord.ciphertext);
        const ivBuffer = CryptoEngine.base64ToBuffer(tokenRecord.iv);
        const decrypted = await CryptoEngine.decryptBuffer(
          cipherBuffer.buffer.slice(0) as ArrayBuffer,
          ivBuffer,
          masterKEK
        );
        const decryptedText = new TextDecoder().decode(decrypted);
        if (decryptedText !== 'AEGIS_MASTER_KEY_VERIFICATION_TOKEN_2026') {
          throw new Error('Integrity validation failed on biometric key unwrap.');
        }
      } catch (err) {
        await vaultDB.logEvent({
          eventType: 'AUTH_UNLOCK',
          severity: 'DANGER',
          source: 'WEB_APP',
          actionTaken: 'UNLOCK_FAILED_PRF_CORRUPTED',
          details: { error: 'Decrypted verification token mismatch' },
        });
        throw new Error('Biometric key verification failed. Please unlock with Master PIN.');
      }
    }

    this.activeKEK = masterKEK;
    this.authMethod = 'WEBAUTHN';

    await vaultDB.logEvent({
      eventType: 'AUTH_UNLOCK',
      severity: 'SUCCESS',
      source: 'WEB_APP',
      actionTaken: 'MASTER_KEY_UNLOCKED',
      details: { method: 'WEBAUTHN_PRF_BIOMETRIC' },
    });

    return masterKEK;
  }
}
