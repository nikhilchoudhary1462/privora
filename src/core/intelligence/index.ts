import { vaultDB } from '../storage/db';
import { AnomalyReport } from '../../types';

// Named configuration constants for anomaly detection thresholds
const DECRYPTION_WINDOW_MS = 60_000; // 60 seconds
const DECRYPTION_BURST_THRESHOLD = 4;

const AUTH_WINDOW_MS = 120_000; // 2 minutes
const AUTH_FAILURE_THRESHOLD = 2;

const TAMPER_LOOKBACK_MS = 24 * 60 * 60 * 1000; // 24 hours
const HIGH_RISK_OVERRIDE_LOOKBACK_MS = 24 * 60 * 60 * 1000; // 24 hours
const HIGH_RISK_OVERRIDE_THRESHOLD = 2;

export class LocalIntelligenceEngine {
  // -------------------------------------------------------------
  // 1. Local Anomaly Detection (F2)
  // Scans device's own audit logs to detect abnormal bursts, wrong keys, or tamper flags
  // -------------------------------------------------------------
  static async detectAnomalies(): Promise<AnomalyReport[]> {
    const logs = await vaultDB.getAuditLogs(200);
    const anomalies: AnomalyReport[] = [];
    const now = Date.now();

    // A. Rapid Decryption Burst (> 4 decrypt actions within 60 seconds)
    const recentDecrypts = logs.filter(
      (l) => (l.eventType === 'DECRYPT' || l.eventType === 'VIEW_MEMORY') && now - l.timestamp < DECRYPTION_WINDOW_MS
    );
    if (recentDecrypts.length >= DECRYPTION_BURST_THRESHOLD) {
      anomalies.push({
        id: 'anom_burst_' + Date.now(),
        timestamp: now,
        type: 'RAPID_DECRYPTION_BURST',
        severity: 'CRITICAL',
        description: `Unusual decryption burst detected: ${recentDecrypts.length} decrypt operations occurred within 60 seconds.`,
        metricDetails: { count: recentDecrypts.length, windowMs: DECRYPTION_WINDOW_MS },
        recommendedAction: 'Verify if automated mass-extraction is occurring. Consider locking the master vault.',
      });
    }

    // B. Repeated Failed Key / Auth Attempts (> 2 failed auth in 2 mins)
    const failedAuths = logs.filter(
      (l) => l.eventType === 'AUTH_UNLOCK' && l.severity === 'DANGER' && now - l.timestamp < AUTH_WINDOW_MS
    );
    if (failedAuths.length >= AUTH_FAILURE_THRESHOLD) {
      anomalies.push({
        id: 'anom_auth_' + Date.now(),
        timestamp: now,
        type: 'WRONG_KEY_ATTEMPT',
        severity: 'CRITICAL',
        description: `Multiple incorrect master passphrase/biometric attempts detected (${failedAuths.length} failures).`,
        metricDetails: { failedCount: failedAuths.length },
        recommendedAction: 'Potential unauthorized access attempt on this browser. Confirm your identity.',
      });
    }

    // C. File Integrity Tamper Alerts (Lookback limited to last 24h to avoid perpetual alarms)
    const recentTamperLogs = logs.filter(
      (l) => (l.eventType === 'TAMPER_ALERT' || l.tamperDetected) && now - l.timestamp < TAMPER_LOOKBACK_MS
    );
    if (recentTamperLogs.length > 0) {
      anomalies.push({
        id: 'anom_tamper_' + Date.now(),
        timestamp: now,
        type: 'INTEGRITY_TAMPER',
        severity: 'CRITICAL',
        description: `${recentTamperLogs.length} file integrity SHA-256 checksum mismatch event(s) recorded in the last 24 hours.`,
        metricDetails: { tamperEvents: recentTamperLogs.map((t) => t.fileName || t.fileId) },
        recommendedAction: 'Ciphertext or storage record modified outside the cryptographic pipeline.',
      });
    }

    // D. High-Risk Policy Overrides (User chose NO_ACTION on files with risk >= 80 in the last 24h)
    const highRiskOverrides = logs.filter(
      (l) =>
        l.eventType === 'OVERRIDE' &&
        (l.riskScore || 0) >= 80 &&
        l.details?.chosenAction === 'NO_ACTION' &&
        now - l.timestamp < HIGH_RISK_OVERRIDE_LOOKBACK_MS
    );
    if (highRiskOverrides.length >= HIGH_RISK_OVERRIDE_THRESHOLD) {
      anomalies.push({
        id: 'anom_override_' + Date.now(),
        timestamp: now,
        type: 'HIGH_RISK_OVERRIDE',
        severity: 'WARNING',
        description: `Multiple high-risk files (risk score >= 80) were overridden to plaintext in the last 24 hours.`,
        metricDetails: { count: highRiskOverrides.length },
        recommendedAction: 'Review custom policies to ensure credentials and government IDs are not exposed.',
      });
    }

    // If newly discovered anomalies exist, persist ANOMALY_DETECTED audit event (debounced to 60s)
    if (anomalies.length > 0) {
      const recentAnomalyLog = logs.find((l) => l.eventType === 'ANOMALY_DETECTED' && now - l.timestamp < 60000);
      if (!recentAnomalyLog) {
        try {
          await vaultDB.logEvent({
            eventType: 'ANOMALY_DETECTED',
            severity: 'ALERT',
            source: 'WEB_APP',
            actionTaken: `Security Anomaly Alert: ${anomalies.map((a) => a.type).join(', ')}`,
            details: {
              anomalyTypes: anomalies.map((a) => a.type),
              count: anomalies.length,
              descriptions: anomalies.map((a) => a.description),
            },
          });
        } catch (error) {
          console.error('Failed to persist anomaly audit event:', error);
        }
      }
    }

    return anomalies;
  }

  // -------------------------------------------------------------
  // 2. Conversational Audit Assistant (F3)
  // In-browser intelligent assistant answering questions directly from local audit logs (READ ONLY)
  // -------------------------------------------------------------
  static async queryAssistant(prompt: string): Promise<string> {
    const logs = await vaultDB.getAuditLogs(200);
    const files = await vaultDB.getAllFiles();
    const policies = await vaultDB.getPolicies();
    const overrides = await vaultDB.getOverrides();
    const anomalies = await this.detectAnomalies();

    const lower = prompt.toLowerCase();

    // Query: What did you protect today? (Strictly filtered to today's midnight timestamp)
    if (
      lower.includes('protect') ||
      lower.includes('today') ||
      lower.includes('what did you') ||
      lower.includes('summary') ||
      lower.includes('status')
    ) {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const todayStart = startOfDay.getTime();

      const todayLogs = logs.filter((l) => l.timestamp >= todayStart);
      const todayEncryptEvents = todayLogs.filter((l) => l.eventType === 'ENCRYPT');
      const todayPiiFound = todayLogs.filter((l) => l.eventType === 'DETECT' && l.details?.itemTypes?.length > 0);
      const totalProtectedFiles = files.length;

      let reply = `🔒 On-Device Protection Summary for Today:\n\n`;
      reply += `• Total Encrypted Files in Vault: ${totalProtectedFiles}\n`;
      reply += `• Encryption Operations Performed Today: ${todayEncryptEvents.length}\n`;
      reply += `• Sensitive Scans Triggered Today: ${todayPiiFound.length}\n`;
      if (files.length > 0) {
        reply += `\nRecent Vaulted Files:\n`;
        files.slice(0, 3).forEach((f) => {
          reply += `- ${f.fileName} (${f.metadata.category}, Risk: ${f.metadata.riskScore}/100, Pipeline: ${f.pipelineUsed})\n`;
        });
      } else {
        reply += `\nNo files have been vaulted yet. Drop a file above to test automatic detection and encryption!`;
      }
      return reply;
    }

    // Query: Anomalies / Security alerts
    if (lower.includes('anomal') || lower.includes('alert') || lower.includes('threat') || lower.includes('suspicious')) {
      if (anomalies.length === 0) {
        return `✅ Zero Security Anomalies Detected.\n\nAll cryptographic operations, unlocks, and file integrity checks on this device are operating normally within standard thresholds.`;
      } else {
        let reply = `⚠️ ${anomalies.length} Security Anomaly(ies) Found:\n\n`;
        anomalies.forEach((a, i) => {
          reply += `${i + 1}. ${a.type.replace(/_/g, ' ')} [${a.severity}]\n${a.description}\nRecommendation: ${a.recommendedAction}\n\n`;
        });
        return reply;
      }
    }

    // Query: Policies / Rules
    if (lower.includes('rule') || lower.includes('policy') || lower.includes('policies')) {
      let reply = `📋 Active Privacy Policies (${policies.length}):\n\n`;
      policies.forEach((p) => {
        reply += `• ${p.enabled ? '🟢' : '⚪'} "${p.naturalLanguage}" -> Action: ${p.action}\n`;
      });
      return reply;
    }

    // Query: PII specific questions (Aadhaar, PAN, Face, etc. in the last 24 hours)
    if (
      lower.includes('aadhaar') ||
      lower.includes('pan') ||
      lower.includes('face') ||
      lower.includes('card') ||
      lower.includes('pii')
    ) {
      const now = Date.now();
      const recentDetectEvents = logs.filter(
        (l) => l.eventType === 'DETECT' && now - l.timestamp < 24 * 60 * 60 * 1000
      );

      const piiScanCount: Record<string, number> = {};
      recentDetectEvents.forEach((e) => {
        const types: string[] = e.details?.itemTypes || [];
        types.forEach((t) => {
          piiScanCount[t] = (piiScanCount[t] || 0) + 1;
        });
      });

      let reply = `🔍 Personal Identifiers (PII) Detected in the Last 24 Hours:\n\n`;
      const entries = Object.entries(piiScanCount);
      if (entries.length === 0) {
        reply += `No PII instances detected in recent file scans.`;
      } else {
        entries.forEach(([type, count]) => {
          reply += `• ${type.replace(/_/g, ' ')}: flagged across ${count} scan event(s)\n`;
        });
      }
      return reply;
    }

    // Query: Overrides & Justifications ("why did you allow this", "why was this allowed", "override", "reasons")
    if (
      lower.includes('override') ||
      lower.includes('why did you allow') ||
      lower.includes('why was this allowed') ||
      lower.includes('why was it allowed') ||
      lower.includes('why allowed') ||
      lower.includes('justification') ||
      lower.includes('self-correct') ||
      lower.includes('learning')
    ) {
      if (overrides.length === 0) {
        return `💡 Self-Correction Status: No manual user overrides recorded yet. The agent is currently using standard security defaults and active natural-language policy rules.`;
      }
      let reply = `🧠 User Policy Overrides & Justifications (${overrides.length} Recorded):\n\n`;
      overrides.slice(-5).forEach((o, idx) => {
        const fileInfo = o.fileName ? ` "${o.fileName}"` : '';
        const risk = o.riskScore ? ` [Risk: ${o.riskScore}/100]` : '';
        const just = o.justification
          ? `\n  ↳ Documented Justification: "${o.justification}"`
          : `\n  ↳ Justification: Standard user preference adjustment`;
        reply += `${idx + 1}. [${o.fileCategory}]${fileInfo}${risk}: User changed ${o.recommendedAction} ➔ ${o.chosenAction}${just}\n\n`;
      });
      return reply.trim();
    }

    // General fallback contextual assistant response
    return `🤖 Aegis Local Privacy Assistant\n\nI analyze only this device's on-device IndexedDB logs (zero telemetry leaves your browser).\n\nYou can ask me:\n- "What did you protect today?"\n- "Are there any anomalies or security alerts?"\n- "What PII types have been detected?"\n- "Show my active privacy policy rules"`;
  }
}
