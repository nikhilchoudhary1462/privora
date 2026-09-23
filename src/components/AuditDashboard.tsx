import React, { useState, useEffect } from 'react';
import { 
  Activity, 
  ShieldAlert, 
  ShieldCheck, 
  AlertTriangle, 
  Download, 
  Filter, 
  RefreshCw, 
  Clock, 
  Layers, 
  Lock, 
  Eye, 
  Zap, 
  FileCheck2 
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
    a.download = `aegis_local_audit_log_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
  };

  // Compute analytics from local logs
  const totalEncrypted = logs.filter(l => l.eventType === 'ENCRYPT').length;
  const totalScanned = logs.filter(l => l.eventType === 'DETECT').length;
  const totalOverrides = logs.filter(l => l.eventType === 'OVERRIDE').length;
  const totalTamperEvents = logs.filter(l => l.eventType === 'TAMPER_ALERT' || l.tamperDetected).length;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      
      {/* Header */}
      <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Activity className="w-5 h-5 text-indigo-600" />
            <span>Local Privacy & Audit Dashboard (F1, F4)</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            100% On-Device Audit Trail · Zero Telemetry Sent Outside This Browser
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={exportAuditLogJson}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 hover:bg-slate-100 text-xs text-slate-700 border border-slate-200 transition-all font-medium"
          >
            <Download className="w-3.5 h-3.5" />
            Export JSON
          </button>
          <button
            onClick={loadData}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 hover:bg-slate-100 text-xs text-slate-700 border border-slate-200 transition-all font-medium"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {/* Analytics Summary Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        
        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold">Files in Vault</span>
            <Lock className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="text-2xl font-black text-slate-900 font-mono mt-2">{files.length}</div>
          <span className="text-[10px] text-indigo-600 font-mono font-bold mt-1">AES-256-GCM Wrapped</span>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold">Total Scans</span>
            <Zap className="w-4 h-4 text-purple-600" />
          </div>
          <div className="text-2xl font-black text-slate-900 font-mono mt-2">{totalScanned}</div>
          <span className="text-[10px] text-purple-600 font-mono font-bold mt-1">OCR / Face / Regex / EXIF</span>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold">User Overrides</span>
            <Layers className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-black text-slate-900 font-mono mt-2">{totalOverrides}</div>
          <span className="text-[10px] text-amber-600 font-mono font-bold mt-1">Self-Correction Feed</span>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold">Integrity State</span>
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-black text-emerald-600 font-mono mt-2">
            {totalTamperEvents === 0 ? '100% OK' : `${totalTamperEvents} ALERTS`}
          </div>
          <span className="text-[10px] text-emerald-600 font-mono font-bold mt-1">SHA-256 Verified</span>
        </div>

      </div>

      {/* Anomaly Alerts Section (F2) */}
      {anomalies.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-rose-600">
            <ShieldAlert className="w-4 h-4" />
            <span>Active Local Anomaly Alerts ({anomalies.length}):</span>
          </div>

          <div className="space-y-2.5">
            {anomalies.map((anom) => (
              <div
                key={anom.id}
                className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 text-xs space-y-1.5 shadow-sm"
              >
                <div className="flex justify-between items-center font-bold">
                  <span className="text-rose-700 font-extrabold">🚨 {anom.type.replace(/_/g, ' ')}</span>
                  <span className="px-2 py-0.5 rounded bg-rose-100 text-[10px] font-mono text-rose-800 font-bold border border-rose-300">
                    {anom.severity}
                  </span>
                </div>
                <p className="text-slate-700">{anom.description}</p>
                <p className="text-rose-700 text-[11px]">
                  <strong>Action:</strong> {anom.recommendedAction}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Audit Log Stream (F1) */}
      <div className="p-5 rounded-2xl bg-white border border-slate-200/90 space-y-4 shadow-sm">
        
        {/* Filter Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
            <Clock className="w-4 h-4 text-indigo-600" />
            <span>Unified Chronological Event Feed ({filteredLogs.length})</span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {['ALL', 'DETECT', 'CLASSIFY', 'ENCRYPT', 'DECRYPT', 'VIEW_MEMORY', 'OVERRIDE', 'AUTH_UNLOCK', 'TAMPER_ALERT'].map((type) => (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={`px-2.5 py-1 rounded-lg font-mono text-[11px] transition-all ${
                  filterType === type
                    ? 'bg-indigo-600 text-white font-bold shadow-sm'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        {/* Logs Table / Cards */}
        {loading ? (
          <div className="p-8 text-center text-xs text-slate-400">Loading audit records...</div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">No audit events match current filter.</div>
        ) : (
          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
            {filteredLogs.map((log) => (
              <div
                key={log.id}
                className="p-3 rounded-xl bg-slate-50 border border-slate-200/90 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs hover:border-indigo-300 transition-all"
              >
                <div className="flex items-start sm:items-center gap-2.5">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold shrink-0 ${
                      log.eventType === 'ENCRYPT'
                        ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                        : log.eventType === 'DECRYPT' || log.eventType === 'VIEW_MEMORY'
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : log.eventType === 'TAMPER_ALERT' || log.severity === 'ALERT'
                        ? 'bg-rose-50 text-rose-700 border border-rose-200'
                        : log.eventType === 'OVERRIDE'
                        ? 'bg-amber-50 text-amber-800 border border-amber-200'
                        : 'bg-slate-100 text-slate-700 border border-slate-200'
                    }`}
                  >
                    {log.eventType}
                  </span>

                  <div>
                    <span className="font-semibold text-slate-900">{log.actionTaken}</span>
                    {log.fileName && (
                      <span className="ml-2 font-mono text-[11px] text-indigo-600 font-bold">
                        [{log.fileName}]
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0 text-slate-500 font-mono text-[11px]">
                  <span className="px-1.5 py-0.5 rounded bg-white text-[10px] text-slate-600 border border-slate-200">
                    {log.source}
                  </span>
                  <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>

    </div>
  );
};