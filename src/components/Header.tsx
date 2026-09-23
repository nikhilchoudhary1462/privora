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
  Sparkles
} from 'lucide-react';
import { MasterKeySession } from '../core/crypto/webauthn';

interface HeaderProps {
  activeTab: 'scan' | 'vault' | 'policy' | 'assistant' | 'p2p' | 'audit';
  setActiveTab: (tab: 'scan' | 'vault' | 'policy' | 'assistant' | 'p2p' | 'audit') => void;
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
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/85 border-b border-slate-200/80 px-4 lg:px-8 py-3.5 transition-all shadow-sm">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        
        {/* Brand & Zero-Cloud Badge */}
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-sky-500 shadow-md shadow-indigo-500/20 text-white">
            <ShieldCheck className="w-5 h-5" />
            <div className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full ring-2 ring-white animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-slate-900 via-indigo-950 to-indigo-800 bg-clip-text text-transparent">
                AegisGuard
              </span>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200/70 font-semibold flex items-center gap-1">
                <Sparkles className="w-2.5 h-2.5" />
                v2.2 Local AI
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
              <WifiOff className="w-3 h-3 text-emerald-600" />
              <span>100% On-Device · Zero Cloud · Web Crypto</span>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="hidden md:flex items-center gap-1 bg-slate-100/90 p-1 rounded-xl border border-slate-200/80">
          <button
            onClick={() => setActiveTab('scan')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'scan'
                ? 'bg-white text-indigo-700 font-semibold shadow-sm border border-slate-200/60'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            Scan & Protect
          </button>

          <button
            onClick={() => setActiveTab('vault')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'vault'
                ? 'bg-white text-indigo-700 font-semibold shadow-sm border border-slate-200/60'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
            }`}
          >
            <FileLock2 className="w-3.5 h-3.5" />
            Vault
            {vaultFileCount > 0 && (
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${
                activeTab === 'vault' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-700'
              }`}>
                {vaultFileCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('policy')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'policy'
                ? 'bg-white text-indigo-700 font-semibold shadow-sm border border-slate-200/60'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            Policy Studio
          </button>

          <button
            onClick={() => setActiveTab('assistant')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'assistant'
                ? 'bg-white text-indigo-700 font-semibold shadow-sm border border-slate-200/60'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
            }`}
          >
            <MessageSquareCode className="w-3.5 h-3.5" />
            AI Assistant
          </button>

          <button
            onClick={() => setActiveTab('p2p')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'p2p'
                ? 'bg-white text-indigo-700 font-semibold shadow-sm border border-slate-200/60'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
            }`}
          >
            <QrCode className="w-3.5 h-3.5" />
            P2P Share
          </button>

          <button
            onClick={() => setActiveTab('audit')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'audit'
                ? 'bg-white text-indigo-700 font-semibold shadow-sm border border-slate-200/60'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            Audit Log
          </button>
        </nav>

        {/* Master Key WebAuthn / Lock State */}
        <div className="flex items-center gap-2">
          {session.unlocked ? (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold">
                {session.authMethod === 'WEBAUTHN' ? (
                  <Fingerprint className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <Unlock className="w-3.5 h-3.5 text-emerald-600" />
                )}
                <span>Master KEK Unlocked</span>
              </div>
              <button
                onClick={onLockVault}
                className="p-1.5 rounded-lg bg-slate-100 hover:bg-rose-50 hover:text-rose-600 border border-slate-200 text-slate-500 text-xs transition-colors"
                title="Lock Master Vault"
              >
                <Lock className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={onOpenAuthModal}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-amber-50 border border-amber-300/80 text-amber-800 text-xs font-semibold hover:bg-amber-100 transition-all shadow-sm"
            >
              <Lock className="w-3.5 h-3.5 text-amber-600" />
              <span>Unlock Master Key</span>
            </button>
          )}
        </div>

      </div>

      {/* Mobile nav */}
      <div className="flex md:hidden items-center justify-around mt-3 pt-2 border-t border-slate-200 overflow-x-auto gap-2">
        <button
          onClick={() => setActiveTab('scan')}
          className={`text-xs px-2.5 py-1 rounded font-medium ${activeTab === 'scan' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-600'}`}
        >
          Scan
        </button>
        <button
          onClick={() => setActiveTab('vault')}
          className={`text-xs px-2.5 py-1 rounded font-medium ${activeTab === 'vault' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-600'}`}
        >
          Vault ({vaultFileCount})
        </button>
        <button
          onClick={() => setActiveTab('policy')}
          className={`text-xs px-2.5 py-1 rounded font-medium ${activeTab === 'policy' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-600'}`}
        >
          Policy
        </button>
        <button
          onClick={() => setActiveTab('assistant')}
          className={`text-xs px-2.5 py-1 rounded font-medium ${activeTab === 'assistant' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-600'}`}
        >
          Assistant
        </button>
        <button
          onClick={() => setActiveTab('p2p')}
          className={`text-xs px-2.5 py-1 rounded font-medium ${activeTab === 'p2p' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-600'}`}
        >
          P2P
        </button>
        <button
          onClick={() => setActiveTab('audit')}
          className={`text-xs px-2.5 py-1 rounded font-medium ${activeTab === 'audit' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-600'}`}
        >
          Audit
        </button>
      </div>
    </header>
  );
};