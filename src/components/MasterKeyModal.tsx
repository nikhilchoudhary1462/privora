import React, { useState, useEffect } from 'react';
import { Fingerprint, KeyRound, ShieldAlert, CheckCircle2, X } from 'lucide-react';
import { WebAuthnManager } from '../core/crypto/webauthn';

interface MasterKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const MasterKeyModal: React.FC<MasterKeyModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [isConfigured, setIsConfigured] = useState<boolean>(false);
  const [passphrase, setPassphrase] = useState<string>('');
  const [confirmPassphrase, setConfirmPassphrase] = useState<string>('');
  const [enableBiometrics, setEnableBiometrics] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [isBiometricSupported, setIsBiometricSupported] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setPassphrase('');
      setConfirmPassphrase('');
      WebAuthnManager.isConfigured().then(setIsConfigured);
      setIsBiometricSupported(WebAuthnManager.isWebAuthnSupported());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleUnlockPassphrase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passphrase) {
      setError('Please enter your Master PIN or Passphrase.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await WebAuthnManager.unlockWithPassphrase(passphrase);
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to unlock master vault.');
    } finally {
      setLoading(false);
    }
  };

  const handleUnlockBiometric = async () => {
    setLoading(true);
    setError(null);
    try {
      await WebAuthnManager.unlockWithWebAuthn();
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Biometric authentication was cancelled.');
    } finally {
      setLoading(false);
    }
  };

  const handleInitialize = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passphrase.length < 6) {
      setError('Passphrase must be at least 6 characters.');
      return;
    }
    if (passphrase !== confirmPassphrase) {
      setError('Passphrases do not match.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await WebAuthnManager.initializeMasterKey(passphrase, enableBiometrics);
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to initialize master key.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-2xl p-6 overflow-hidden">
        
        {/* Header decoration */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-indigo-500 via-sky-500 to-emerald-500" />
        
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="p-2.5 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-600 shadow-sm">
            <KeyRound className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">
              {isConfigured ? 'Unlock Master Key' : 'Initialize Vault Master Key'}
            </h3>
            <p className="text-xs text-slate-500">
              {isConfigured
                ? 'WebAuthn biometric or master passphrase unlock'
                : 'Sets up PBKDF2 Master KEK & Envelope Encryption'}
            </p>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 mb-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">
            <ShieldAlert className="w-4 h-4 shrink-0 text-rose-600" />
            <span className="font-semibold">{error}</span>
          </div>
        )}

        {isConfigured ? (
          <div className="space-y-4">
            {isBiometricSupported && (
              <button
                type="button"
                onClick={handleUnlockBiometric}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm shadow-md shadow-indigo-500/25 transition-all disabled:opacity-50"
              >
                <Fingerprint className="w-5 h-5" />
                <span>Unlock with Biometrics (Touch ID / Face ID)</span>
              </button>
            )}

            <div className="relative flex items-center justify-center my-2">
              <div className="border-t border-slate-200 w-full" />
              <span className="bg-white px-3 text-[11px] text-slate-400 font-mono font-bold">OR USE PIN</span>
            </div>

            <form onSubmit={handleUnlockPassphrase} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Master PIN / Passphrase
                </label>
                <input
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Enter your master passphrase..."
                  autoFocus
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all font-mono"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-sm border border-slate-200 transition-all disabled:opacity-50"
              >
                {loading ? 'Deriving Key...' : 'Unlock Vault'}
              </button>
            </form>
          </div>
        ) : (
          <form onSubmit={handleInitialize} className="space-y-3.5">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Create Master PIN / Passphrase (min 6 chars)
              </label>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Choose a strong passphrase..."
                autoFocus
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Confirm Master Passphrase
              </label>
              <input
                type="password"
                value={confirmPassphrase}
                onChange={(e) => setConfirmPassphrase(e.target.value)}
                placeholder="Re-enter passphrase..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-mono"
              />
            </div>

            {isBiometricSupported && (
              <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={enableBiometrics}
                  onChange={(e) => setEnableBiometrics(e.target.checked)}
                  className="rounded border-slate-300 bg-white text-indigo-600 focus:ring-indigo-500"
                />
                <span>Enable WebAuthn Platform Biometrics (Fingerprint / Face ID)</span>
              </label>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm shadow-md shadow-indigo-500/25 transition-all disabled:opacity-50"
            >
              {loading ? 'Deriving 250k PBKDF2 Iterations...' : 'Initialize Master KEK Vault'}
            </button>
          </form>
        )}

        <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
          <span>Web Crypto API (AES-256-GCM)</span>
          <span>Zero Server Storage</span>
        </div>

      </div>
    </div>
  );
};
