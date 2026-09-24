import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { ScanStudio } from './components/ScanStudio';
import { VaultView } from './components/VaultView';
import { PolicyStudio } from './components/PolicyStudio';
import { ChatAssistant } from './components/ChatAssistant';
import { P2PShareModal } from './components/P2PShareModal';
import { AuditDashboard } from './components/AuditDashboard';
import { MasterKeyModal } from './components/MasterKeyModal';
import { EnterpriseKycSimulator } from './components/EnterpriseKycSimulator';
import { WebAuthnManager, MasterKeySession } from './core/crypto/webauthn';
import { vaultDB } from './core/storage/db';

export function App() {
  const [activeTab, setActiveTab] = useState<'scan' | 'vault' | 'policy' | 'assistant' | 'p2p' | 'audit' | 'enterprise'>('scan');
  const [session, setSession] = useState<MasterKeySession>(WebAuthnManager.getSession());
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [vaultFileCount, setVaultFileCount] = useState<number>(0);

  const refreshVaultCount = async () => {
    try {
      const files = await vaultDB.getAllFiles();
      setVaultFileCount(files.length);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    refreshVaultCount();
  }, []);

  const handleAuthSuccess = () => {
    setSession(WebAuthnManager.getSession());
    refreshVaultCount();
  };

  const handleLockVault = () => {
    WebAuthnManager.lock();
    setSession(WebAuthnManager.getSession());
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 selection:bg-indigo-500 selection:text-white">
      
      {/* Top Navigation */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        session={session}
        onOpenAuthModal={() => setIsAuthModalOpen(true)}
        onLockVault={handleLockVault}
        vaultFileCount={vaultFileCount}
      />

      {/* Main Content View */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {activeTab === 'scan' && (
          <ScanStudio
            session={session}
            onOpenAuthModal={() => setIsAuthModalOpen(true)}
            onFileEncrypted={refreshVaultCount}
          />
        )}

        {activeTab === 'enterprise' && <EnterpriseKycSimulator />}

        {activeTab === 'vault' && (
          <VaultView
            session={session}
            onOpenAuthModal={() => setIsAuthModalOpen(true)}
            onRefreshNeeded={refreshVaultCount}
            onFileShared={(_fileId) => setActiveTab('p2p')}
          />
        )}

        {activeTab === 'policy' && <PolicyStudio />}

        {activeTab === 'assistant' && <ChatAssistant />}

        {activeTab === 'p2p' && (
          <P2PShareModal
            session={session}
            onOpenAuthModal={() => setIsAuthModalOpen(true)}
            onRefreshNeeded={refreshVaultCount}
          />
        )}

        {activeTab === 'audit' && <AuditDashboard />}
      </main>

      {/* Modern Light Footer */}
      <footer className="border-t border-slate-200/80 py-5 px-6 text-center text-xs text-slate-500 bg-white/70 backdrop-blur-md">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-800">Privora v2.2</span>
            <span className="text-slate-300">·</span>
            <span className="text-slate-500">100% On-Device AI Privacy & Cryptography</span>
          </div>
          <div className="flex items-center gap-3 font-mono text-[11px] text-slate-400">
            <span className="bg-slate-100 px-2 py-0.5 rounded border border-slate-200 text-slate-600">WebAssembly (WASM)</span>
            <span className="bg-slate-100 px-2 py-0.5 rounded border border-slate-200 text-slate-600">Web Crypto AES-256</span>
            <span className="bg-slate-100 px-2 py-0.5 rounded border border-slate-200 text-slate-600">WebAuthn PRF</span>
          </div>
        </div>
      </footer>

      {/* Master Key WebAuthn / Passphrase Modal */}
      <MasterKeyModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onSuccess={handleAuthSuccess}
      />

    </div>
  );
}

export default App;