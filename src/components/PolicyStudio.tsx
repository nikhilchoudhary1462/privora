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
  const [testInput, setTestInput] = useState<string>('national_identity_card_with_photo.png');
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
    <div className="space-y-6 max-w-7xl mx-auto">
      
      {/* Header */}
      <div className="p-5 rounded-2xl bg-white border border-slate-200/90 flex flex-wrap items-center justify-between gap-4 shadow-sm">
        <div>
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Sliders className="w-5 h-5 text-indigo-600" />
            <span>Natural-Language Policy Studio</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Define custom security directives in plain English (Workflow 5). Applied locally by the Policy Agent.
          </p>
        </div>

        <button
          onClick={loadData}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 hover:bg-slate-100 text-xs text-slate-700 border border-slate-200 transition-all font-medium"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {notification && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="font-semibold">{notification}</span>
        </div>
      )}

      {/* Grid: Rule Builder & Self-Correction */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Natural Language Rule Builder */}
        <div className="lg:col-span-7 space-y-6">
          
          <div className="p-5 rounded-2xl bg-white border border-slate-200/90 space-y-4 shadow-sm">
            <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-600" />
              <span>Define New Policy in Plain English</span>
            </h4>

            <form onSubmit={handleAddRule} className="space-y-3">
              <div className="relative">
                <input
                  type="text"
                  value={ruleInput}
                  onChange={(e) => setRuleInput(e.target.value)}
                  placeholder="e.g. Always encrypt anything with a face or Aadhaar..."
                  className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                />
                <button
                  type="submit"
                  disabled={!ruleInput.trim()}
                  className="absolute right-2 top-2 bottom-2 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs flex items-center gap-1.5 transition-all disabled:opacity-40 shadow-sm"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Rule</span>
                </button>
              </div>

              {/* Quick Sample Prompts */}
              <div className="space-y-1.5">
                <span className="text-[11px] text-slate-500 font-medium">Quick Suggestions:</span>
                <div className="flex flex-wrap gap-1.5">
                  {sampleRules.map((sample, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setRuleInput(sample)}
                      className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-50 hover:bg-indigo-50 hover:text-indigo-700 text-slate-600 border border-slate-200 transition-all text-left"
                    >
                      "{sample}"
                    </button>
                  ))}
                </div>
              </div>

              {/* Live Structured Parsing Preview */}
              {parsedPreview && (
                <div className="p-3.5 rounded-xl bg-indigo-50 border border-indigo-200 text-xs space-y-1.5 text-indigo-950 animate-fadeIn">
                  <div className="font-bold text-indigo-700 flex items-center gap-1.5">
                    <BrainCircuit className="w-3.5 h-3.5" />
                    <span>Agent Parser Interpretation:</span>
                  </div>
                  <div className="font-mono text-[11px] text-slate-700">
                    ➔ Target Action: <strong className="text-indigo-700 font-bold">[{parsedPreview.action}]</strong>
                  </div>
                  <div className="font-mono text-[11px] text-slate-700">
                    ➔ Conditions: {JSON.stringify(parsedPreview.condition)}
                  </div>
                </div>
              )}
            </form>
          </div>

          {/* Active Policies List */}
          <div className="p-5 rounded-2xl bg-white border border-slate-200/90 space-y-4 shadow-sm">
            <h4 className="text-sm font-bold text-slate-900 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-600" />
                Active Directives ({policies.length})
              </span>
            </h4>

            {policies.length === 0 ? (
              <p className="text-xs text-slate-400">No active policies configured.</p>
            ) : (
              <div className="space-y-2.5">
                {policies.map((policy) => (
                  <div
                    key={policy.id}
                    className={`p-3.5 rounded-xl border transition-all flex items-start justify-between gap-3 ${
                      policy.enabled
                        ? 'bg-slate-50 border-slate-200'
                        : 'bg-slate-50/50 border-slate-200 opacity-60'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${policy.enabled ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                        <h5 className="text-xs font-bold text-slate-900">
                          "{policy.naturalLanguage}"
                        </h5>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-slate-500 font-mono">
                        <span>Action: <strong className="text-indigo-700 font-bold">[{policy.action}]</strong></span>
                        <span>·</span>
                        <span>{policy.id.startsWith('rule_default') ? 'Built-in Default' : 'User Defined'}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => handleToggleRule(policy)}
                        className={`text-xs px-2.5 py-1 rounded-lg border font-semibold transition-all ${
                          policy.enabled
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-slate-100 text-slate-500 border-slate-200'
                        }`}
                      >
                        {policy.enabled ? 'Enabled' : 'Disabled'}
                      </button>

                      {!policy.id.startsWith('rule_default') && (
                        <button
                          onClick={() => handleDeleteRule(policy.id)}
                          className="p-1.5 rounded-lg bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-400 text-xs transition-colors"
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
          <div className="p-5 rounded-2xl bg-white border border-slate-200/90 space-y-4 shadow-sm">
            
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-purple-50 border border-purple-200 text-purple-600">
                <BrainCircuit className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900">
                  Self-Correction Heuristics (B5)
                </h4>
                <p className="text-[11px] text-slate-500">
                  Adaptive sensitivity learned from manual user overrides
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 leading-relaxed">
              When you override the agent's recommended decision during scan confirmation, the system records your preference locally without retraining, adapting future confidence offsets for that file category.
            </div>

            <div>
              <span className="text-xs font-bold text-slate-700 mb-2 block">
                Recorded Overrides ({overrides.length}):
              </span>

              {overrides.length === 0 ? (
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-center text-xs text-slate-400">
                  No overrides recorded yet. The system is operating on standard security directives.
                </div>
              ) : (
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {overrides.map((ovr) => (
                    <div
                      key={ovr.id}
                      className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1"
                    >
                      <div className="flex justify-between font-mono text-[11px]">
                        <span className="text-purple-700 font-bold">{ovr.fileCategory}</span>
                        <span className="text-slate-400">{new Date(ovr.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-slate-700">
                        <span className="line-through text-slate-400">[{ovr.recommendedAction}]</span>
                        <span>➔</span>
                        <span className="font-bold text-indigo-700">[{ovr.chosenAction}]</span>
                      </div>
                      {ovr.justification && (
                        <p className="text-[11px] text-slate-500 italic mt-0.5">
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
