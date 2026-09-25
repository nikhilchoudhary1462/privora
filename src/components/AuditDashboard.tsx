import React, { useState, useEffect } from 'react';
import { 
  Activity, 
  ShieldAlert, 
  ShieldCheck, 
  Download, 
  RefreshCw, 
  Clock, 
  Layers, 
  Lock, 
  Zap
} from 'lucide-react';
import { AuditLogEvent, AnomalyReport, EncryptedFileRecord } from '../types';
import { vaultDB } from '../core/storage/db';
import { LocalIntelligenceEngine } from '../core/intelligence';

export const AuditDashboard: React.FC = () => {
  const [logs, setLogs] = useState<AuditLogEvent[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyReport[]>([]);
  const [files, setFiles] = useState<EncryptedFileRecord[]>([]);
  const [filterType, setFilterType] = useState<string>('ALL');
  const [loading, setLoading] = useState<boolean>(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const [l, a, f] = await Promise.all([
        vaultDB.getAuditLogs(200),
        LocalIntelligenceEngine.detectAnomalies(),
        vaultDB.getAllFiles(),
      ]);
      setLogs(l);
      setAnomalies(a);
      setFiles(f);
    } catch (e) {
      console.error('Audit load error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const unsubscribe = vaultDB.onAuditLog(() => {
      loadData();
    });
    return unsubscribe;
  }, []);

  const filteredLogs = logs.filter((log) => {
    if (filterType === 'ALL') return true;
    return log.eventType === filterType;
  });

  const exportAuditLogJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(logs, null, 2));
    const a = document.createElement('a');
    a.href = dataStr;
    a.download = `privora_local_audit_log_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
  };

  // Compute analytics from local logs
  const totalEncrypted = logs.filter(l => l.eventType === 'ENCRYPT').length;
  const totalScanned = logs.filter(l => l.eventType === 'DETECT').length;
  const totalOverrides = logs.filter(l => l.eventType === 'OVERRIDE').length;
  const totalTamperEvents = logs.filter(l => l.eventType === 'TAMPER_ALERT' || l.tamperDetected).length;

  return (
    <div className="space-y-6 w-full font-sans">
      
      {/* Header */}
      <div className="p-5 rounded-2xl bg-white border border-black/5 shadow-minimal flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-bold text-[#212529] flex items-center gap-2">
            <Activity className="w-5 h-5 text-[#9C8DD4]" />
            <span>Local Privacy & Audit Dashboard (F1, F4)</span>
          </h3>
          <p className="text-xs text-[#757575] mt-0.5">
            100% On-Device Audit Trail · Zero Telemetry Sent Outside This Browser
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={exportAuditLogJson}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#FAF9F6] hover:bg-[#E2E1E6] text-xs text-[#212529] border border-black/5 transition-all font-medium shadow-minimal"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export JSON</span>
          </button>
          <button
            onClick={loadData}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#FAF9F6] hover:bg-[#E2E1E6] text-xs text-[#212529] border border-black/5 transition-all font-medium shadow-minimal"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Analytics Summary Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        
        <div className="p-5 rounded-2xl bg-white border border-black/5 shadow-minimal flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#757575]">
            <span className="text-xs font-bold">Files in Vault</span>
            <Lock className="w-4 h-4 text-[#9C8DD4]" />
          </div>
          <div className="text-3xl font-light text-[#212529] font-mono mt-3">{files.length}</div>
          <span className="font-mono text-[9px] text-[#9C8DD4] uppercase tracking-wider font-semibold mt-2">AES-256-GCM Wrapped</span>
        </div>

        <div className="p-5 rounded-2xl bg-white border border-black/5 shadow-minimal flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#757575]">
            <span className="text-xs font-bold">Total Scans</span>
            <Zap className="w-4 h-4 text-[#9C8DD4]" />
          </div>
          <div className="text-3xl font-light text-[#212529] font-mono mt-3">{totalScanned}</div>
          <span className="font-mono text-[9px] text-[#9C8DD4] uppercase tracking-wider font-semibold mt-2">OCR / Face / Checksum</span>
        </div>

        <div className="p-5 rounded-2xl bg-white border border-black/5 shadow-minimal flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#757575]">
            <span className="text-xs font-bold">User Overrides</span>
            <Layers className="w-4 h-4 text-[#9C8DD4]" />
          </div>
          <div className="text-3xl font-light text-[#212529] font-mono mt-3">{totalOverrides}</div>
          <span className="font-mono text-[9px] text-[#9C8DD4] uppercase tracking-wider font-semibold mt-2">Self-Correction Feed</span>
        </div>

        <div className="p-5 rounded-2xl bg-white border border-black/5 shadow-minimal flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#757575]">
            <span className="text-xs font-bold">Integrity State</span>
            <ShieldCheck className="w-4 h-4 text-[#4ADE80]" />
          </div>
          <div className="text-3xl font-light text-[#4ADE80] font-mono mt-3">
            {totalTamperEvents === 0 ? '100% OK' : `${totalTamperEvents} ALERTS`}
          </div>
          <span className="font-mono text-[9px] text-[#4ADE80] uppercase tracking-wider font-semibold mt-2">SHA-256 Verified</span>
        </div>

      </div>

      {/* Anomaly Alerts Section (F2) */}
      {anomalies.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-[#E77A73]">
            <ShieldAlert className="w-4 h-4" />
            <span>Active Local Anomaly Alerts ({anomalies.length}):</span>
          </div>

          <div className="space-y-2.5">
            {anomalies.map((anom) => (
              <div
                key={anom.id}
                className="p-4 rounded-2xl bg-[#E77A73]/10 border border-[#E77A73]/25 text-[#212529] text-xs space-y-1.5 shadow-minimal"
              >
                <div className="flex justify-between items-center font-bold">
                  <span className="text-[#E77A73] font-bold">🚨 {anom.type.replace(/_/g, ' ')}</span>
                  <span className="px-2.5 py-0.5 rounded-full bg-[#E77A73]/15 text-[10px] font-mono text-[#E77A73] font-bold border border-[#E77A73]/30">
                    {anom.severity}
                  </span>
                </div>
                <p className="text-[#212529]">{anom.description}</p>
                <p className="text-[#757575] text-[11px]">
                  <strong className="text-[#E77A73]">Action:</strong> {anom.recommendedAction}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Audit Log Stream (F1) */}
      <div className="p-6 rounded-2xl bg-white border border-black/5 space-y-4 shadow-minimal">
        
        {/* Filter Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-black/5">
          <div className="flex items-center gap-2 text-xs font-bold text-[#212529]">
            <Clock className="w-4 h-4 text-[#9C8DD4]" />
            <span>Unified Chronological Event Feed ({filteredLogs.length})</span>
          </div>

          <div className="flex flex-wrap items-center gap-1 text-xs">
            {['ALL', 'DETECT', 'CLASSIFY', 'ENCRYPT', 'DECRYPT', 'VIEW_MEMORY', 'OVERRIDE', 'AUTH_UNLOCK', 'TAMPER_ALERT'].map((type) => (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={`px-3 py-1 rounded-full font-mono text-[10px] transition-all ${
                  filterType === type
                    ? 'bg-[#A99DD8] text-white font-bold shadow-minimal'
                    : 'bg-[#FAF9F6] text-[#757575] hover:text-[#212529] border border-black/5'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        {/* Log Entries List */}
        {filteredLogs.length === 0 ? (
          <div className="p-8 text-center text-xs text-[#757575] bg-[#FAF9F6] rounded-2xl border border-black/5">
            No audit events found for selected filter.
          </div>
        ) : (
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {filteredLogs.map((log) => {
              const isAlert = log.severity === 'DANGER' || log.severity === 'ALERT';
              return (
                <div
                  key={log.id}
                  className={`p-3.5 rounded-2xl border text-xs transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-minimal ${
                    isAlert
                      ? 'bg-[#E77A73]/10 border-[#E77A73]/25'
                      : 'bg-[#FAF9F6] border-black/5'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-white border border-black/5 text-[#212529] font-bold">
                        {log.eventType}
                      </span>
                      <span className="text-[#212529] font-semibold">{log.actionTaken}</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-[10px] text-[#757575] font-mono">
                      <span>Source: <strong className="text-[#212529]">{log.source}</strong></span>
                      {log.fileName && <span>· File: <strong className="text-[#212529]">{log.fileName}</strong></span>}
                      {log.riskScore !== undefined && (
                        <span>· Risk: <strong className="text-[#9C8DD4]">{log.riskScore}/100</strong></span>
                      )}
                    </div>
                  </div>

                  <div className="text-[10px] font-mono text-[#757575] whitespace-nowrap self-start sm:self-center">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              );
            })}
          </div>
        )}

      </div>

    </div>
  );
};