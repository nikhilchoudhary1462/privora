# Project Specification v2: AI-Powered Local Privacy & Security Platform

## One-Line Pitch
A fully on-device AI platform that detects sensitive data (faces, PII, ID numbers) in any file or web interaction, uses a local agentic AI layer to decide how each item should be protected, and encrypts it with real cryptography — all without a single byte of data, a key, or a log entry ever leaving the user's device.

## Core Philosophy (unchanged, now fully local)
- **AI decides. Cryptography protects.** Detection and reasoning are AI-driven; all actual encryption uses standard primitives (AES-256-GCM, RSA-OAEP) via the browser's native Web Crypto API.
- **Zero cloud, zero server.** Every operation — detection, decision-making, encryption, storage, sharing, and the assistant — runs entirely inside the browser, on the user's own device.
- **Agentic, not just rule-based.** A small local LLM acts as an orchestrator that reasons about each file and decides what should happen to it, rather than the system following rigid hardcoded rules.

---

## SYSTEM OVERVIEW

```
                        ┌───────────────────────────────┐
                        │   LOCAL AGENT LAYER (small LLM) │
                        │  Classifier → Policy → Explainer │
                        └───────────────┬───────────────┘
                                        │ decides pipeline
              ┌─────────────────────────┼─────────────────────────┐
              ▼                                                    ▼
┌───────────────────────────┐                      ┌────────────────────────────┐
│  DETECTION TOOLS (fixed)    │                      │  ENCRYPTION TOOLS (fixed)   │
│  - OCR (Tesseract.js)        │                      │  - AES-256-GCM (region/full)│
│  - Face detection             │                      │  - Envelope encryption      │
│  - Regex PII (PAN/Aadhaar)    │                      │    (DEK/KEK, Web Crypto)    │
│  - Metadata inspection         │                      │  - WebAuthn key unlock      │
└───────────────────────────┘                      └────────────────────────────┘
              │                                                    │
              └─────────────────────────┬─────────────────────────┘
                                        ▼
                        ┌───────────────────────────────┐
                        │   LOCAL DATABASE (IndexedDB)    │
                        │  file_id ↔ filename ↔ key ref    │
                        │  unified local audit log         │
                        └───────────────┬───────────────┘
                                        ▼
                ┌────────────────────────────────────────────┐
                │  LOCAL INTELLIGENCE: anomaly detection,       │
                │  conversational assistant (in-browser LLM)    │
                └────────────────────────────────────────────┘

  ENTRY POINTS: Browser Extension (paste/drop, any site) + Local Web App (manual file upload)
  SHARING: Direct browser-to-browser (WebRTC), already-encrypted file, no server relay
```

---

## COMPLETE FEATURE LIST

### A. Detection (deterministic tools)
- A1. Face detection in images
- A2. OCR text extraction with bounding boxes
- A3. Regex-based structured PII detection (PAN, Aadhaar, phone, email, card numbers)
- A4. File metadata inspection (EXIF: GPS, device, timestamp)
- A5. File integrity hashing (generate a hash at encryption time, verify at decryption time to detect tampering)

### B. Agentic Decision Layer (local small LLM, multi-agent)
- B1. **Classifier Agent** — looks at raw detection output and determines what kind of file this is and what it contains (e.g., "government ID card," "casual photo," "financial screenshot")
- B2. **Policy Agent** — takes the classification and applies the user's rules (either default rules or natural-language rules the user has defined) to decide the required action: no action / warn / redact / encrypt region / encrypt full file
- B3. **Explainer Agent** — generates a short, plain-language explanation of the decision for the user ("Encrypting the face and ID number because this looks like a government ID")
- B4. **Natural-language policy definition** — user can type rules in plain English (e.g., "always encrypt anything with a face" or "don't touch my work documents") which the Policy Agent parses and applies to future files
- B5. **Self-correction from user overrides** — when a user overrides a decision, the system records this locally and adjusts future thresholds/behavior for similar cases (a simple local heuristic adjustment, not full model retraining)
- B6. **Fixed action set + fallback rule** — the agent may only choose from a predefined list of valid actions; if its output doesn't match a valid action, the system defaults to the safest option (full encryption) rather than doing nothing

### C. Encryption & Key Management
- C1. Selective region encryption (face/ID number only) with a live blurred preview before any action is finalized
- C2. Full-file encryption for high-risk cases, as decided by the Policy Agent
- C3. Envelope encryption: unique Data Encryption Key (DEK) per file, wrapped by a master Key Encryption Key (KEK)
- C4. Per-recipient key wrapping for sharing (a separate wrapped DEK copy per recipient's public key)
- C5. WebAuthn-based unlock for the master key (fingerprint/Face ID via the browser's native WebAuthn API, instead of a password)
- C6. View-only decrypt mode: sensitive regions can be decrypted into memory for viewing only, without ever writing plaintext back to disk

### D. Local Storage & Retrieval
- D1. Local database (IndexedDB) mapping file ID ↔ original filename ↔ wrapped key reference ↔ pipeline used
- D2. Retrieval flow: user selects a file to "download"/restore → system matches filename/ID against the local database → runs the correct decryption pipeline → restores the file
- D3. File integrity check on retrieval (compare stored hash to current hash before presenting the decrypted file)

### E. Peer-to-Peer Sharing (no server relay)
- E1. Direct browser-to-browser transfer of the already-encrypted file using WebRTC's data channel
- E2. Connection handshake (SDP offer/answer + ICE candidates) and the recipient's public key are exchanged via QR codes scanned between the two devices, using "vanilla ICE" (full candidate gathering before finalizing) so each exchange is a single self-contained blob — no signaling server of any kind is used
- E3. Since the file is already encrypted before it ever touches the transfer channel, the transport itself does not need to be trusted
- E4. A public STUN server may optionally be used for NAT traversal/IP discovery outside a shared local network; it never sees or relays file data or keys — this distinction is called out explicitly rather than claiming zero external contact under all network conditions

### F. Local Intelligence Layer
- F1. Unified local audit log — every detect/decide/encrypt/decrypt/share/override event, stored only on this device
- F2. Local anomaly detection — flags unusual patterns *within this device's own history* (e.g., an unusual burst of decrypt actions, an attempt to decrypt with the wrong key repeatedly)
- F3. Conversational audit assistant — a small in-browser LLM answers natural-language questions about the local log ("what did you protect today?")
- F4. Local privacy dashboard — visual summary of files protected, sensitive items caught, and trends over time, all computed from the local log

### G. Trust & UX Extras
- G1. User confirmation step before any agent decision is executed (human-in-the-loop)
- G2. Manual override control, feeding into the self-correction mechanism (B5)
- G3. Panic/duress unlock (optional, stretch): a secondary unlock credential reveals only decoy/placeholder files instead of real ones
- G4. Compliance tagging (optional, stretch): detected data is tagged against real-world categories (e.g., India's DPDP Act, GDPR) for context in the explanation shown to the user

---

## DETAILED WORKFLOWS

### Workflow 1 — File Upload Through the Local Web App (or Extension drop)
1. User selects or drops a file.
2. Detection tools run locally: face detection, OCR, regex PII matching, metadata inspection (A1–A4).
3. Classifier Agent (B1) reviews the findings and identifies what kind of file this likely is.
4. Policy Agent (B2) checks this classification against default rules and any user-defined natural-language rules (B4), and decides the required action.
5. Explainer Agent (B3) generates a plain-language reason for the decision.
6. User sees the recommended action, the reasoning, and a live preview (blurred/locked regions) — and can accept, override, or manually choose a different action (G1, G2).
7. If overridden, the correction is logged locally and feeds the self-correction mechanism (B5).
8. On confirmation, the correct encryption pipeline runs (C1 or C2), a DEK is generated and wrapped by the KEK (C3), and a file integrity hash is generated (A5).
9. A record is written to the local database: file ID, original filename, wrapped key reference, pipeline used, hash (D1).
10. The event is written to the local audit log (F1).

### Workflow 2 — Retrieving/Decrypting a File
1. User selects the file they want back (by name, from a local list).
2. System looks up the filename in the local database (D2) and retrieves the wrapped key reference and stored hash.
3. Master key is unlocked via WebAuthn (fingerprint/Face ID) (C5).
4. The DEK is unwrapped, the file/region is decrypted, and its hash is verified against the stored hash to confirm no tampering occurred (D3).
5. User can choose to view the decrypted content only in memory (C6) or fully restore the plaintext file to disk.
6. The event is written to the local audit log (F1).

### Workflow 3 — Sharing a File with Another Person (no server, QR-based signaling)

WebRTC's data channel is genuinely peer-to-peer, but establishing that connection requires an initial handshake (exchanging an SDP offer/answer and ICE candidates) through some channel — WebRTC has no built-in discovery mechanism. To avoid any central signaling server, this handshake is done manually via QR codes, so no server ever participates in setting up or carrying the connection.

1. **Sender creates the connection offer**: sender's browser creates an RTCPeerConnection and generates an SDP offer, then waits for ICE candidate gathering to complete fully ("vanilla ICE") so the offer and all its candidates form a single, complete, self-contained blob rather than a stream of messages requiring an ongoing signaling channel.
2. **Offer is rendered as a QR code**: this blob (base64-encoded, lightly compressed to keep it scannable) is displayed on the sender's screen as a QR code.
3. **Receiver scans the QR code** (via the device camera and an in-browser QR-decoding library) to reconstruct the offer, sets it as the remote description, and generates its own SDP answer the same way — gathering ICE candidates fully before finalizing a second QR code.
4. **Sender scans the receiver's QR code**, sets it as the remote description, completing the handshake. The WebRTC data channel now opens directly between the two browsers.
5. Recipient's public key (for key-wrapping, see C4) is exchanged as part of this same QR handshake payload, avoiding any separate key-exchange step.
6. A wrapped copy of the file's DEK is created using the recipient's public key (C4).
7. The encrypted file plus this wrapped key are transferred directly browser-to-browser over the now-open WebRTC data channel (E1) — no server ever holds or relays the file.
8. On the recipient's side, the same retrieval flow (Workflow 2) applies using their own key to unwrap the DEK.

**Caveats to design for:**
- For devices on the same local network (the expected demo condition), no external server of any kind is needed — local ICE candidates are sufficient.
- For NAT traversal in other network conditions, a public STUN server may be used for IP/port discovery only — it never sees or relays file data or keys, unlike a TURN relay or a true signaling server. This distinction should be stated plainly if asked, rather than claiming zero external contact of any kind.
- QR payload size is a practical constraint: a full SDP blob with several ICE candidates can approach the reliable capacity of a single QR code. Mitigate by restricting the ICE candidate pool and preferring local-network candidates, keeping the encoded blob small.

### Workflow 4 — Real-Time Protection via the Browser Extension (any website)
1. User pastes text or drops a file into any website's input field.
2. The extension's content script intercepts the event before the page can process it.
3. Local detection tools scan the content (A2, A3).
4. The same agentic decision layer (B1–B3) is invoked to decide the action for this content.
5. If action is required, the content is encrypted or redacted in-browser using the Web Crypto API before the underlying network request is dispatched.
6. A brief in-page notification shows the user what was detected and what was done.
7. The event is logged to the same local audit log as the web app (F1), so both entry points share one unified local history.

### Workflow 5 — Defining a Natural-Language Policy Rule
1. User types a rule in plain English into a settings/policy panel (e.g., "always encrypt anything with a face").
2. The Policy Agent (B2/B4) parses this into a structured rule it can apply consistently going forward.
3. The new rule is stored locally and takes effect immediately for all future files processed by either entry point.
4. User can view, edit, or delete their active rules at any time from the same panel.

### Workflow 6 — Asking the Local Assistant About Activity
1. User opens the assistant panel and asks a question in plain language (e.g., "What did you protect today?").
2. The in-browser LLM (F3) retrieves relevant entries from the local audit log.
3. The LLM composes a natural-language answer sourced only from this device's own log — no data or query ever leaves the browser.

---

## SUMMARY TABLE — WHAT RUNS WHERE

| Component | Runs | Data ever leaves device? |
|---|---|---|
| Detection (OCR, face, regex, metadata) | Browser (JS/WASM) | No |
| Agent layer (Classifier/Policy/Explainer) | Browser (local small LLM) | No |
| Encryption/decryption | Browser (Web Crypto API) | No |
| Key unlock | Browser (WebAuthn) | No |
| File/key database | Browser (IndexedDB) | No |
| Audit log + anomaly detection | Browser (IndexedDB, local logic) | No |
| Conversational assistant | Browser (local small LLM) | No |
| Sharing transport | Browser-to-browser (WebRTC) | Only the already-encrypted file, direct to the intended recipient — no server in between |

---

## PHASE-BY-PHASE IMPLEMENTATION PLAN WITH VERIFICATION CHECKS

### PHASE 0 — Foundation Setup
**Goal:** project skeleton, shared local data model, and dev environment ready for both the web app and the extension.
- Set up project structure (web app + extension as separate build targets sharing a common core library for detection/encryption logic)
- Define the local database schema (file_id, filename, wrapped_key_ref, pipeline_used, hash, timestamp) in IndexedDB
- Define the audit log event schema (shared by both entry points)

**Verification checks:**
- [ ] Can write and read a dummy record to/from IndexedDB from both the web app and a test extension page
- [ ] Confirm no network requests fire during any of this (check browser Network tab — should be empty)

### PHASE 1 — Detection Tools
**Goal:** all deterministic detection working reliably in isolation, before any AI reasoning or encryption is layered on.
- Integrate Tesseract.js for OCR with bounding boxes
- Integrate a face detection library (e.g., face-api.js or similar) for face bounding boxes
- Implement regex matchers for PAN, Aadhaar, phone, email, card numbers
- Implement EXIF metadata extraction

**Verification checks:**
- [ ] Test OCR on 5+ sample images (clear text, blurry text, angled text) and confirm bounding boxes are reasonably accurate
- [ ] Test face detection on images with 0, 1, and multiple faces
- [ ] Test regex matchers against known-valid and known-invalid PAN/Aadhaar formats (including edge cases like partial numbers)
- [ ] Confirm metadata extraction correctly reads GPS/device data from a sample photo with EXIF data present
- [ ] Confirm all of the above run with zero network calls

### PHASE 2 — Encryption & Key Management
**Goal:** real, working cryptography before any AI decision-making is wired in.
- Implement AES-256-GCM encryption/decryption for both full-file and region-based content using Web Crypto API
- Implement envelope encryption: DEK generation, KEK wrapping/unwrapping
- Implement per-recipient key wrapping (RSA-OAEP)
- Implement WebAuthn registration and unlock flow for the master key
- Implement file hashing (e.g., SHA-256) at encryption time and verification at decryption time

**Verification checks:**
- [ ] Encrypt a test file, confirm the output is unreadable/garbled when opened directly
- [ ] Decrypt it back and confirm byte-for-byte match with the original (checksum comparison)
- [ ] Encrypt a region of an image (e.g., a face), confirm only that region is altered and the rest of the image is untouched
- [ ] Test key wrapping/unwrapping with two different simulated "recipients" and confirm each can only unwrap their own copy
- [ ] Test WebAuthn unlock on a supported device/browser; confirm the master key cannot be unlocked without it
- [ ] Deliberately corrupt one byte of an encrypted file and confirm the integrity check correctly flags it as tampered on decryption attempt

### PHASE 3 — Agentic Decision Layer
**Goal:** the local LLM reliably reasons over detection output and produces valid, actionable decisions.
- Set up the local LLM runtime (WebLLM or equivalent WASM/WebGPU-based small model)
- Implement the Classifier Agent prompt/logic (input: detection findings → output: file type/classification)
- Implement the Policy Agent prompt/logic (input: classification + active rules → output: one of the fixed valid actions)
- Implement the Explainer Agent prompt/logic (input: decision → output: short plain-language reason)
- Implement the fixed action set validation and safe-default fallback

**Verification checks:**
- [ ] Run the agent on 10+ varied test cases (ID card photo, casual selfie, screenshot of a bank statement, random landscape, document with no PII) and manually confirm each decision is sensible
- [ ] Deliberately feed the agent an ambiguous/edge case and confirm it still returns one of the valid fixed actions, not free-form/invalid output
- [ ] Simulate a malformed or unparseable model output and confirm the fallback rule (default to full encryption) correctly triggers
- [ ] Confirm the Explainer Agent's output is understandable to a non-technical user (have someone outside the team read a few explanations)
- [ ] Confirm the entire agent layer runs with zero network calls (model loads and runs fully in-browser)

### PHASE 4 — Local Web App Integration (Workflow 1 & 2)
**Goal:** the full upload → detect → decide → encrypt → store → retrieve → decrypt loop works end-to-end in the web app.
- Wire together Phases 1–3 into the upload flow
- Build the live preview UI (blurred/locked regions before confirmation)
- Build the retrieval/download flow matching filename against the local database

**Verification checks:**
- [ ] Full round-trip test: upload a test ID photo → confirm correct detection → confirm agent recommends selective encryption → confirm live preview shows blurred regions → confirm after encryption the stored file is unreadable → retrieve it → confirm it decrypts back to the original with regions restored correctly
- [ ] Test the override flow: manually reject the agent's recommendation and confirm the correct alternate action is applied and logged
- [ ] Test with a completely non-sensitive file (e.g., a plain landscape photo) and confirm the agent correctly recommends "no action"
- [ ] Confirm the local database correctly persists across a browser restart (close and reopen the browser, confirm previously encrypted files can still be retrieved)

### PHASE 5 — Natural-Language Policy Rules (Workflow 5)
**Goal:** users can define and see their own rules enforced.
- Build the rule input panel
- Wire user-defined rules into the Policy Agent's decision context
- Build rule view/edit/delete UI

**Verification checks:**
- [ ] Define a rule ("always encrypt anything with a face") and confirm it is consistently applied across multiple different test files
- [ ] Define a conflicting/ambiguous rule and confirm the system handles it gracefully (doesn't crash, applies a sensible priority, or asks for clarification)
- [ ] Delete a rule and confirm behavior reverts to default for subsequent files

### PHASE 6 — Self-Correction from Overrides (B5)
**Goal:** repeated user overrides visibly shift future agent behavior.
- Implement local tracking of override patterns
- Implement a simple local heuristic/threshold adjustment based on repeated overrides

**Verification checks:**
- [ ] Override the same type of decision 3-5 times in test runs and confirm the agent's behavior for similar future cases shifts accordingly
- [ ] Confirm this adjustment is stored locally and persists across sessions

### PHASE 7 — Local Intelligence Layer (Workflow 6, F1–F4)
**Goal:** the audit log, anomaly detection, assistant, and dashboard all work from local data only.
- Implement the unified local audit log writer (used by both web app and extension)
- Implement local anomaly detection logic over this device's own history
- Implement the in-browser conversational assistant over the local log
- Build the local privacy dashboard UI

**Verification checks:**
- [ ] Confirm every action from Phases 4–6 correctly produces a log entry with accurate details
- [ ] Simulate an anomalous pattern (e.g., many rapid decrypt attempts) and confirm it gets flagged
- [ ] Ask the assistant several natural-language questions about test log data and confirm answers are accurate and sourced only from the local log
- [ ] Confirm the dashboard numbers match the actual log contents (manually count and cross-check)

### PHASE 8 — Browser Extension (Workflow 4)
**Goal:** the same detection/agent/encryption core, applied to live paste/drop events on real websites.
- Build the Manifest V3 content script with paste/drop listeners
- Wire the shared detection + agent + encryption core into the extension context
- Build the in-page notification UI
- Point extension events at the same local audit log used by the web app

**Verification checks:**
- [ ] Test paste of a known PAN/Aadhaar-format string into a test page and confirm it is intercepted and encrypted before the network request fires (verify via browser dev tools Network tab)
- [ ] Test drop of a sensitive image into a test page and confirm the same
- [ ] Test on your 2-3 pre-selected target sites specifically (not random sites) and confirm reliable behavior on each
- [ ] Confirm extension events appear correctly in the same local audit log/dashboard as web app events
- [ ] Test a non-sensitive paste/drop and confirm nothing is blocked or altered unnecessarily

### PHASE 9 — Peer-to-Peer Sharing (Workflow 3)
**Goal:** direct browser-to-browser transfer of encrypted files with per-recipient key wrapping, using QR-code-based signaling with no central server.
- Implement RTCPeerConnection setup using vanilla ICE (wait for full candidate gathering before finalizing the offer/answer)
- Implement QR code generation (offer/answer blob) and QR scanning (via device camera) to complete the handshake
- Implement per-recipient key wrapping and transfer alongside the encrypted file over the resulting data channel

**Verification checks:**
- [ ] Test a full share between two separate browser instances (e.g., two browser profiles or two devices on the same network): sender generates and displays a QR code, receiver scans it, receiver's QR is scanned back by sender, connection completes, sender encrypts and shares, receiver decrypts successfully
- [ ] Confirm the file and the entire handshake are never routed through any server — inspect network traffic on both devices to confirm no signaling server request appears, and (if on the same local network) no STUN request is needed either
- [ ] Test what happens if the wrong recipient's key is used (should fail to decrypt, not silently produce garbage that looks valid)
- [ ] Confirm the QR-encoded offer/answer blob reliably fits within a scannable QR code size for a typical ICE candidate count on your test devices; if not, confirm the candidate-pool restriction keeps it within a scannable size
- [ ] If testing across different networks (not the same Wi-Fi), confirm the optional STUN fallback correctly enables connection and note this explicitly as the one case where an external (non-file-holding) server is contacted

### PHASE 10 — Optional/Stretch Features (WebAuthn refinement, panic mode, compliance tagging)
**Goal:** polish items, only after the core (Phases 0–9) is fully stable.
- Refine WebAuthn UX if not already smooth
- Implement panic/duress decoy unlock (G3) if time allows
- Implement compliance tagging in the Explainer Agent's output (G4) if time allows

**Verification checks:**
- [ ] If implemented, confirm panic mode reliably shows only decoy content and never accidentally exposes real files
- [ ] If implemented, confirm compliance tags shown are accurate for the sample PII types you're detecting (don't overstate legal claims)

### PHASE 11 — Full Demo Rehearsal
**Goal:** one coherent, reliable demo narrative across every phase.
- Script a single-file/single-scenario journey touching as many features as possible without feeling forced
- Rehearse on the exact machine/browser/network setup you'll use for the actual demo
- Prepare a backup screen recording of each major flow, in case of live failure

**Verification checks:**
- [ ] Full dry run, timed, on the actual demo hardware
- [ ] Confirm the demo works with Wi-Fi/network disabled entirely (this is your strongest proof point — literally turn off the network and show everything still works)
- [ ] Have a teammate who wasn't involved in building a specific feature try the demo flow once, to catch any assumptions or rough edges the builders no longer notice

---

## PERFORMANCE & FALLBACK STRATEGY

Since this entire system runs client-side in JavaScript/WASM, performance must be designed in from the start rather than fixed afterward. Different components carry different levels of risk.

### Low-risk components (no special handling needed)
- Web Crypto API operations (encryption/decryption) — native browser code, fast even on large files
- IndexedDB reads/writes — lightweight for the small metadata records being stored
- Regex-based PII matching — effectively instant
- WebAuthn prompts — no meaningful performance cost
- WebRTC data transfer — a short one-time connection setup delay, then fast transfer

### Moderate-risk components (require standard mitigations)
- **OCR (Tesseract.js)**: a full scan can take multiple seconds on large or low-quality images.
  - Run OCR inside a Web Worker (background thread) so the UI never freezes during a scan.
  - Downscale large images before running OCR — full resolution is rarely needed for text detection.
  - Show a clear loading indicator during the scan so the delay reads as expected behavior, not a bug.
- **Face detection**: per-image detection is generally fast, but initial model loading has a one-time cost.
  - Run detection inside a Web Worker as well.
  - Load the detection model once per session and cache it, rather than reloading it for every file.

### High-risk component: the local LLM agent (WebLLM or equivalent)
This is the heaviest part of the system and the most likely source of visible lag, especially during a live demo on unfamiliar hardware.
- Use the smallest model that still produces coherent output for this narrow task (classification, policy decisions, and short explanations) — a large general-purpose chat model is unnecessary overhead here.
- Pre-warm/load the model once when the extension installs or the app first opens, not at the moment a file is dropped — so the one-time load delay happens upfront, outside the critical interaction path.
- Cache the loaded model so it does not re-download or re-initialize on every use within a session.
- Test model load time and inference speed specifically on the machine that will be used for the live demo, well before the deadline — performance varies significantly depending on whether the device has WebGPU support or falls back to CPU/WASM.

### Required fallback: rule-based agent mode
Because the local LLM's performance depends on hardware that may be unpredictable on demo day, implement a deterministic, rule-based version of the same three-stage agent (Classifier → Policy → Explainer) as a fallback:
- The rule-based version uses the same fixed action set and the same input (structured detection findings), but applies simple conditional logic instead of LLM reasoning to reach a decision.
- This should be a drop-in replacement for the LLM-based agent, not a separate code path bolted on — both should implement the same interface so switching between them requires no other code changes.
- If the local LLM fails to load, times out, or performs too slowly during testing, switch to the rule-based fallback for the live demo without changing anything else about the system's behavior or the pitch narrative.
- This is the same "safe default" philosophy already applied to malformed agent output (see B6) — extended here to cover the case where the AI component itself is too slow or unavailable, not just producing an invalid answer.

**Verification checks for this section:**
- [ ] Confirm OCR and face detection run in Web Workers and the UI remains responsive (can still scroll/click) while a scan is in progress
- [ ] Measure and record local LLM load time and per-decision inference time on the actual demo machine
- [ ] Confirm the rule-based fallback agent produces sensible decisions on the same test cases used to verify the LLM-based agent in Phase 3
- [ ] Confirm switching between the LLM-based agent and the rule-based fallback requires no changes outside the agent module itself

---

## KEY TECHNICAL PRINCIPLES TO PRESERVE THROUGHOUT

1. AI (agent layer) is used only for classification, policy decisions, and explanation — never for the actual cryptographic operations.
2. All encryption/decryption uses standard, established primitives via the Web Crypto API — no custom cryptography.
3. Nothing — not files, not keys, not logs, not assistant queries — is ever transmitted off the device, except the already-encrypted file during a deliberate peer-to-peer share.
4. The agent's decision space is constrained to a fixed set of valid actions, with a safe default fallback, to prevent unreliable or unsafe behavior from an inherently non-deterministic component.
5. Every decision the agent makes is shown to the user with a plain-language explanation before being acted on (human-in-the-loop).
6. Both entry points (web app and extension) write to one shared local audit log, so the system behaves as one integrated platform.
7. Anomaly detection and the assistant operate strictly on this device's own local history — this should be stated transparently in the pitch, not implied to be broader cross-device monitoring.
