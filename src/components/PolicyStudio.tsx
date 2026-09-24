import React, { useState, useEffect } from 'react';
import { 
  Sliders, 
  Plus, 
  Trash2, 
  Check, 
  Sparkles, 
  BrainCircuit, 
  ShieldCheck, 
  Layers, 
  CheckCircle2,
  RefreshCw
} from 'lucide-react';
import { PolicyRule, UserOverride } from '../types';
import { vaultDB } from '../core/storage/db';
import { AgentLayer } from '../core/agents';

export const PolicyStudio: React.FC = () => {
  const [policies, setPolicies] = useState<PolicyRule[]>([]);
  const [overrides, setOverrides] = useState<UserOverride[]>([]);
  const [ruleInput, setRuleInput] = useState<string>('');
  const [parsedPreview, setParsedPreview] = useState<PolicyRule | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [notification, setNotification] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const p = await vaultDB.getPolicies();
      const o = await vaultDB.getOverrides();
      setPolicies(p);
      setOverrides(o);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Update parsed preview as user types
  useEffect(() => {
    if (ruleInput.trim().length > 3) {
      const parsed = AgentLayer.parseNaturalLanguagePolicy(ruleInput);
      setParsedPreview(parsed);
    } else {
      setParsedPreview(null);
    }
  }, [ruleInput]);

  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ruleInput.trim()) return;

    const newRule = AgentLayer.parseNaturalLanguagePolicy(ruleInput);
    await vaultDB.savePolicy(newRule);
    await vaultDB.logEvent({
      eventType: 'POLICY_CREATED',
      severity: 'SUCCESS',
      source: 'WEB_APP',
      actionTaken: `Created custom policy: "${ruleInput}"`,
      details: { ruleId: newRule.id, action: newRule.action, condition: newRule.condition },
    });

    setRuleInput('');
    setParsedPreview(null);
    setNotification(`Rule added and active for all future scans!`);
    setTimeout(() => setNotification(null), 4000);
    await loadData();
  };

  const handleToggleRule = async (policy: PolicyRule) => {
    const updated = { ...policy, enabled: !policy.enabled };
    await vaultDB.savePolicy(updated);
    await loadData();
  };

  const handleDeleteRule = async (id: string) => {
    await vaultDB.deletePolicy(id);
    await loadData();
  };

  const sampleRules = [
    'Always selectively blur and encrypt anything with a face',
    'Always fully encrypt documents containing PAN or Aadhaar',
    'Always strip and redact GPS coordinates from all image metadata',
    'Always encrypt files containing API keys or private tokens',
    'Do not touch casual vacation photos',
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto font-sans">
      
      {/* Header Banner */}
      <div className="p-5 rounded-2xl bg-white border border-black/5 flex flex-wrap items-center justify-between gap-4 shadow-minimal">
        <div>
          <h3 className="text-base font-bold text-[#212529] flex items-center gap-2">
            <Sliders className="w-5 h-5 text-[#9C8DD4]" />
            <span>Natural-Language Policy Studio</span>
          </h3>
          <p className="text-xs text-[#757575] mt-0.5">
            Define custom security directives in plain English (Workflow 5). Applied locally by the Policy Agent.
          </p>
        </div>

        <button
          onClick={loadData}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-[#FAF9F6] hover:bg-[#E2E1E6] text-xs text-[#212529] border border-black/5 transition-all font-medium shadow-minimal"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh</span>
        </button>
      </div>

      {notification && (
        <div className="p-4 rounded-2xl bg-[#4ADE80]/15 border border-[#4ADE80]/30 text-[#212529] text-xs flex items-center gap-2 shadow-minimal">
          <CheckCircle2 className="w-4 h-4 text-[#4ADE80] shrink-0" />
          <span className="font-semibold">{notification}</span>
        </div>
      )}

      {/* Grid: Rule Builder & Self-Correction */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Natural Language Rule Builder */}
        <div className="lg:col-span-7 space-y-6">
          
          <div className="p-6 rounded-2xl bg-white border border-black/5 space-y-4 shadow-minimal">
            <h4 className="text-sm font-bold text-[#212529] flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#9C8DD4]" />
              <span>Define New Policy in Plain English</span>
            </h4>

            <form onSubmit={handleAddRule} className="space-y-3">
              <div className="relative">
                <input
                  type="text"
                  value={ruleInput}
                  onChange={(e) => setRuleInput(e.target.value)}
                  placeholder="e.g. Always encrypt anything with a face or Aadhaar..."
                  className="w-full pl-5 pr-28 py-3 rounded-full bg-[#E9F2F7] border border-black/5 text-xs text-[#212529] placeholder-[#757575] focus:outline-none focus:ring-2 focus:ring-[#9C8DD4]/40 transition-all shadow-minimal"
                />
                <button
                  type="submit"
                  disabled={!ruleInput.trim()}
                  className="absolute right-1.5 top-1.5 bottom-1.5 px-4 rounded-full bg-[#A99DD8] hover:bg-[#8A7BC7] text-white font-bold text-xs flex items-center gap-1.5 transition-all disabled:opacity-40 shadow-minimal"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Rule</span>
                </button>
              </div>

              {/* Quick Sample Prompts */}
              <div className="space-y-1.5 pt-1">
                <span className="text-[11px] text-[#757575] font-medium">Quick Suggestions:</span>
                <div className="flex flex-wrap gap-1.5">
                  {sampleRules.map((sample, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setRuleInput(sample)}
                      className="text-[11px] px-3 py-1 rounded-full bg-[#FAF9F6] hover:bg-[#E2E1E6] hover:text-[#9C8DD4] text-[#757575] border border-black/5 transition-all text-left shadow-minimal"
                    >
                      "{sample}"
                    </button>
                  ))}
                </div>
              </div>

              {/* Live Structured Parsing Preview */}
              {parsedPreview && (
                <div className="p-4 rounded-2xl bg-[#9C8DD4]/10 border border-[#9C8DD4]/20 text-xs space-y-1.5 text-[#212529] shadow-minimal">
                  <div className="font-bold text-[#9C8DD4] flex items-center gap-1.5">
                    <BrainCircuit className="w-3.5 h-3.5" />
                    <span>Agent Parser Interpretation:</span>
                  </div>
                  <div className="font-mono text-[11px] text-[#212529]">
                    ➔ Target Action: <strong className="text-[#9C8DD4] font-bold">[{parsedPreview.action}]</strong>
                  </div>
                  <div className="font-mono text-[11px] text-[#757575]">
                    ➔ Conditions: {JSON.stringify(parsedPreview.condition)}
                  </div>
                </div>
              )}
            </form>
          </div>

          {/* Active Policies List */}
          <div className="p-6 rounded-2xl bg-white border border-black/5 space-y-4 shadow-minimal">
            <h4 className="text-sm font-bold text-[#212529] flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#9C8DD4]" />
                <span>Active Directives ({policies.length})</span>
              </span>
            </h4>

            {policies.length === 0 ? (
              <p className="text-xs text-[#757575]">No active policies configured.</p>
            ) : (
              <div className="space-y-2.5">
                {policies.map((policy) => (
                  <div
                    key={policy.id}
                    className={`p-4 rounded-2xl border transition-all flex items-start justify-between gap-3 ${
                      policy.enabled
                        ? 'bg-[#FAF9F6] border-black/5 shadow-minimal'
                        : 'bg-[#FAF9F6]/50 border-black/5 opacity-60'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${policy.enabled ? 'bg-[#4ADE80]' : 'bg-slate-300'}`} />
                        <h5 className="text-xs font-bold text-[#212529]">
                          "{policy.naturalLanguage}"
                        </h5>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-[#757575] font-mono">
                        <span>Action: <strong className="text-[#9C8DD4] font-bold">[{policy.action}]</strong></span>
                        <span>·</span>
                        <span>{policy.id.startsWith('rule_default') ? 'Built-in Default' : 'User Defined'}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => handleToggleRule(policy)}
                        className={`text-xs px-3 py-1 rounded-full border font-semibold transition-all ${
                          policy.enabled
                            ? 'bg-[#4ADE80]/15 text-[#212529] border-[#4ADE80]/30'
                            : 'bg-white text-[#757575] border-black/5'
                        }`}
                      >
                        {policy.enabled ? 'Enabled' : 'Disabled'}
                      </button>

                      {!policy.id.startsWith('rule_default') && (
                        <button
                          onClick={() => handleDeleteRule(policy.id)}
                          className="p-1.5 rounded-full bg-white hover:bg-[#E77A73]/10 text-[#757575] hover:text-[#E77A73] border border-black/5 text-xs transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

        {/* Right Column: Self-Correction from Overrides (B5) */}
        <div className="lg:col-span-5 space-y-6">
          <div className="p-6 rounded-2xl bg-white border border-black/5 space-y-4 shadow-minimal">
            
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-full bg-[#9C8DD4]/15 border border-[#9C8DD4]/30 text-[#9C8DD4] flex items-center justify-center font-bold text-sm">
                <BrainCircuit className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-[#212529]">
                  Self-Correction Heuristics (B5)
                </h4>
                <p className="text-[11px] text-[#757575]">
                  Adaptive sensitivity learned from manual user overrides
                </p>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-[#FAF9F6] border border-black/5 text-xs text-[#757575] leading-relaxed">
              When you override the agent's recommended decision during scan confirmation, the system records your preference locally without retraining, adapting future confidence offsets for that file category.
            </div>

            <div>
              <span className="text-xs font-bold text-[#212529] mb-2 block">
                Recorded Overrides ({overrides.length}):
              </span>

              {overrides.length === 0 ? (
                <div className="p-4 rounded-2xl bg-[#FAF9F6] border border-black/5 text-center text-xs text-[#757575]">
                  No overrides recorded yet. The system is operating on standard security directives.
                </div>
              ) : (
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {overrides.map((ovr) => (
                    <div
                      key={ovr.id}
                      className="p-3.5 rounded-2xl bg-[#FAF9F6] border border-black/5 text-xs space-y-1 shadow-minimal"
                    >
                      <div className="flex justify-between font-mono text-[11px]">
                        <span className="text-[#9C8DD4] font-bold">{ovr.fileCategory}</span>
                        <span className="text-[#757575]">{new Date(ovr.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[#212529]">
                        <span className="line-through text-[#757575]">[{ovr.recommendedAction}]</span>
                        <span>➔</span>
                        <span className="font-bold text-[#9C8DD4]">[{ovr.chosenAction}]</span>
                      </div>
                      {ovr.justification && (
                        <p className="text-[11px] text-[#757575] italic mt-0.5">
                          "{ovr.justification}"
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>

      </div>

    </div>
  );
};
