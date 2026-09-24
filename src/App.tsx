import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { LandingPage } from './components/LandingPage';
import { ScanStudio } from './components/ScanStudio';
import { VaultView } from './components/VaultView';
import { PolicyStudio } from './components/PolicyStudio';
import { ChatAssistant } from './components/ChatAssistant';
import { P2PShareModal } from './components/P2PShareModal';
import { AuditDashboard } from './components/AuditDashboard';
import { MasterKeyModal } from './components/MasterKeyModal';
import { WebAuthnManager, MasterKeySession } from './core/crypto/webauthn';
import { vaultDB } from './core/storage/db';

export function App() {
  const [activeTab, setActiveTab] = useState<'landing' | 'scan' | 'vault' | 'policy' | 'assistant' | 'p2p' | 'audit'>('landing');
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
    <div className="min-h-screen flex flex-col bg-[#F1F3F5] text-[#212529] selection:bg-[#9C8DD4] selection:text-white font-sans">
      
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
      {activeTab === 'landing' ? (
        <LandingPage
          onLaunchApp={() => setActiveTab('scan')}
          onNavigateTab={(tab) => setActiveTab(tab)}
        />
      ) : (
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
          {activeTab === 'scan' && (
            <ScanStudio
              session={session}
              onOpenAuthModal={() => setIsAuthModalOpen(true)}
              onFileEncrypted={refreshVaultCount}
            />
          )}

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
      )}

      {/* Master Key Biometric Auth Modal */}
      <MasterKeyModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onSuccess={handleAuthSuccess}
      />
    </div>
  );
}
export default App;