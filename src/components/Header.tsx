import React from 'react';
import { 
  ShieldCheck, 
  Lock, 
  Unlock, 
  Cpu, 
  FileLock2, 
  Sliders, 
  Activity, 
  MessageSquareCode, 
  QrCode, 
  Fingerprint,
  WifiOff,
  Sparkles,
  Home,
  Building2
} from 'lucide-react';
import { MasterKeySession } from '../core/crypto/webauthn';

interface HeaderProps {
  activeTab: 'landing' | 'scan' | 'enterprise' | 'vault' | 'policy' | 'assistant' | 'p2p' | 'audit';
  setActiveTab: (tab: 'landing' | 'scan' | 'enterprise' | 'vault' | 'policy' | 'assistant' | 'p2p' | 'audit') => void;
  session: MasterKeySession;
  onOpenAuthModal: () => void;
  onLockVault: () => void;
  vaultFileCount: number;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  session,
  onOpenAuthModal,
  onLockVault,
  vaultFileCount,
}) => {
  return (
    <header className="sticky top-0 z-50 backdrop-blur-xl bg-[#F1F3F5]/85 border-b border-black/5 px-4 lg:px-8 py-2.5 transition-all">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
        
        {/* Brand Logo & Tag */}
        <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => setActiveTab('landing')}>
          <div className="w-8 h-8 rounded-full bg-[#9C8DD4] text-white flex items-center justify-center font-bold text-sm shadow-minimal">
            P
          </div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-base tracking-tight text-[#212529]">
              Privora<span className="text-[#E77A73]">.</span>
            </span>
            <div className="w-[1px] h-3.5 bg-black/10 mx-0.5 hidden sm:block" />
            <span className="font-mono text-[9px] text-[#757575] bg-[#E2E1E6] px-2.5 py-0.5 rounded-full hidden sm:inline-block">
              v2.2 on-device
            </span>
          </div>
        </div>

        {/* Navigation Tabs (Minimalist Rounded Pills) */}
        <nav className="hidden lg:flex items-center gap-1 bg-[#E2E1E6]/70 p-1 rounded-full border border-black/5">
          <button
            onClick={() => setActiveTab('landing')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all ${
              activeTab === 'landing'
                ? 'bg-white text-[#212529] font-semibold shadow-minimal'
                : 'text-[#757575] hover:text-[#212529]'
            }`}
          >
            <Home className="w-3.5 h-3.5 text-[#9C8DD4]" />
            Overview
          </button>

          <button
            onClick={() => setActiveTab('scan')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all ${
              activeTab === 'scan'
                ? 'bg-white text-[#212529] font-semibold shadow-minimal'
                : 'text-[#757575] hover:text-[#212529]'
            }`}
          >
            <Cpu className="w-3.5 h-3.5 text-[#9C8DD4]" />
            Scan & Protect
          </button>

          <button
            onClick={() => setActiveTab('enterprise')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all ${
              activeTab === 'enterprise'
                ? 'bg-white text-[#212529] font-semibold shadow-minimal'
                : 'text-[#757575] hover:text-[#212529]'
            }`}
          >
            <Building2 className="w-3.5 h-3.5 text-[#9C8DD4]" />
            <span>Bank KYC</span>
            <span className="px-1.5 py-0.2 rounded-full text-[9px] font-mono font-bold bg-[#FAF9F6] text-[#9C8DD4] border border-[#9C8DD4]/30">
              B2B
            </span>
          </button>

          <button
            onClick={() => setActiveTab('vault')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all ${
              activeTab === 'vault'
                ? 'bg-white text-[#212529] font-semibold shadow-minimal'
                : 'text-[#757575] hover:text-[#212529]'
            }`}
          >
            <FileLock2 className="w-3.5 h-3.5 text-[#9C8DD4]" />
            Vault
            {vaultFileCount > 0 && (
              <span className={`px-1.5 py-0.2 rounded-full text-[9px] font-mono font-bold ${
                activeTab === 'vault' ? 'bg-[#9C8DD4]/20 text-[#9C8DD4]' : 'bg-[#E2E1E6] text-[#757575]'
              }`}>
                {vaultFileCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('policy')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all ${
              activeTab === 'policy'
                ? 'bg-white text-[#212529] font-semibold shadow-minimal'
                : 'text-[#757575] hover:text-[#212529]'
            }`}
          >
            <Sliders className="w-3.5 h-3.5 text-[#9C8DD4]" />
            Policy Studio
          </button>

          <button
            onClick={() => setActiveTab('assistant')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all ${
              activeTab === 'assistant'
                ? 'bg-white text-[#212529] font-semibold shadow-minimal'
                : 'text-[#757575] hover:text-[#212529]'
            }`}
          >
            <MessageSquareCode className="w-3.5 h-3.5 text-[#9C8DD4]" />
            Assistant
          </button>

          <button
            onClick={() => setActiveTab('p2p')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all ${
              activeTab === 'p2p'
                ? 'bg-white text-[#212529] font-semibold shadow-minimal'
                : 'text-[#757575] hover:text-[#212529]'
            }`}
          >
            <QrCode className="w-3.5 h-3.5 text-[#9C8DD4]" />
            P2P Share
          </button>

          <button
            onClick={() => setActiveTab('audit')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all ${
              activeTab === 'audit'
                ? 'bg-white text-[#212529] font-semibold shadow-minimal'
                : 'text-[#757575] hover:text-[#212529]'
            }`}
          >
            <Activity className="w-3.5 h-3.5 text-[#9C8DD4]" />
            Audit
          </button>
        </nav>

        {/* Master Key Biometric Auth Status */}
        <div className="flex items-center gap-2">
          {session.unlocked ? (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#FAF9F6] border border-black/5 text-[#4ADE80] font-mono text-[11px] shadow-minimal">
                <span className="w-2 h-2 rounded-full bg-[#4ADE80] animate-pulse" />
                <span className="text-[#212529] font-medium hidden sm:inline">Vault Unlocked</span>
              </div>
              <button
                onClick={onLockVault}
                className="p-1.5 rounded-full bg-white hover:bg-[#E77A73]/10 text-[#757575] hover:text-[#E77A73] border border-black/5 transition-colors shadow-minimal"
                title="Lock Master Vault"
              >
                <Lock className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={onOpenAuthModal}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#A99DD8] hover:bg-[#8A7BC7] text-white font-semibold text-xs transition-all shadow-minimal hover:shadow-purple-glow transform hover:-translate-y-0.5"
            >
              <Fingerprint className="w-3.5 h-3.5" />
              <span>Unlock Key</span>
            </button>
          )}

          {activeTab === 'landing' && (
            <button
              onClick={() => setActiveTab('scan')}
              className="hidden sm:flex items-center gap-1 px-3.5 py-1.5 rounded-full bg-[#212529] hover:bg-black text-white font-medium text-xs transition-all shadow-minimal"
            >
              <span>App</span>
              <span>→</span>
            </button>
          )}
        </div>

      </div>

      {/* Mobile Nav Tabs */}
      <div className="flex lg:hidden items-center justify-start mt-2 pt-2 border-t border-black/5 overflow-x-auto gap-1.5 pb-1">
        {[
          { tab: 'landing' as const, label: 'Home' },
          { tab: 'scan' as const, label: 'Scan' },
          { tab: 'enterprise' as const, label: 'Bank KYC' },
          { tab: 'vault' as const, label: `Vault (${vaultFileCount})` },
          { tab: 'policy' as const, label: 'Policy' },
          { tab: 'assistant' as const, label: 'Assistant' },
          { tab: 'p2p' as const, label: 'P2P' },
          { tab: 'audit' as const, label: 'Audit' },
        ].map((item) => (
          <button
            key={item.tab}
            onClick={() => setActiveTab(item.tab)}
            className={`text-[11px] px-3 py-1 rounded-full font-medium whitespace-nowrap transition-all ${
              activeTab === item.tab
                ? 'bg-[#A99DD8] text-white font-semibold shadow-minimal'
                : 'bg-white text-[#757575] border border-black/5'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </header>
  );
};