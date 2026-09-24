import React, { useState } from 'react';
import { Send, Bot, User, RefreshCw, Sparkles } from 'lucide-react';
import { LocalIntelligenceEngine } from '../core/intelligence';

interface Message {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

export const ChatAssistant: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'init_1',
      sender: 'assistant',
      text: `👋 Welcome to your Privora Local Privacy Assistant.\n\nI run 100% inside your browser and query only this device's on-device audit logs and local vault records.\n\nYou can ask questions like:\n- "What files did I protect today?"\n- "Are there any suspicious anomalies or failed attempts?"\n- "What types of personal identifiers (PII) were caught recently?"\n- "Show my active privacy policy rules"`,
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState<string>('');
  const [isThinking, setIsThinking] = useState<boolean>(false);

  const handleSendMessage = async (textToSend?: string) => {
    if (isThinking) return;

    const query = (textToSend || input).trim();
    if (!query) return;

    const userMsg: Message = {
      id: 'usr_' + Date.now(),
      sender: 'user',
      text: query,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsThinking(true);

    try {
      const answer = await LocalIntelligenceEngine.queryAssistant(query);
      const assistantMsg: Message = {
        id: 'ast_' + Date.now(),
        sender: 'assistant',
        text: answer,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: 'err_' + Date.now(),
          sender: 'assistant',
          text: `Error analyzing local audit log: ${err.message || 'Unknown error'}`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setIsThinking(false);
    }
  };

  const quickPrompts = [
    'What did you protect today?',
    'Are there any security anomalies?',
    'What PII types were detected?',
    'Show active policy directives',
  ];

  return (
    <div className="space-y-4 max-w-4xl mx-auto h-[calc(100vh-170px)] flex flex-col font-sans">
      {/* Header Banner */}
      <div className="p-4 rounded-2xl bg-white border border-black/5 shadow-minimal flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#9C8DD4]/15 border border-[#9C8DD4]/30 text-[#9C8DD4] flex items-center justify-center font-bold text-sm">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-[#212529]">Local Audit Assistant (F3)</h3>
              <span className="font-mono text-[9px] text-[#4ADE80] bg-[#4ADE80]/10 border border-[#4ADE80]/20 px-2 py-0.5 rounded-full uppercase tracking-wider font-semibold">
                100% In-Browser
              </span>
            </div>
            <p className="text-xs text-[#757575]">Zero cloud API calls · Queries on-device IndexedDB logs only</p>
          </div>
        </div>
      </div>

      {/* Messages Thread */}
      <div className="flex-1 bg-white border border-black/5 rounded-2xl p-5 overflow-y-auto space-y-4 shadow-minimal">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex items-start gap-3 ${
              msg.sender === 'user' ? 'flex-row-reverse' : 'flex-row'
            }`}
          >
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                msg.sender === 'user'
                  ? 'bg-[#A99DD8] text-white font-bold'
                  : 'bg-[#9C8DD4]/15 text-[#9C8DD4] border border-[#9C8DD4]/30'
              }`}
            >
              {msg.sender === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
            </div>

            <div
              className={`p-4 rounded-2xl max-w-xl text-xs leading-relaxed space-y-2 ${
                msg.sender === 'user'
                  ? 'bg-[#A99DD8] text-white font-medium shadow-minimal'
                  : 'bg-[#FAF9F6] border border-black/5 text-[#212529] shadow-minimal'
              }`}
            >
              <div className="whitespace-pre-wrap font-sans">{msg.text}</div>
              <div
                className={`text-[10px] text-right font-mono ${
                  msg.sender === 'user' ? 'text-white/70' : 'text-[#757575]'
                }`}
              >
                {new Date(msg.timestamp).toLocaleTimeString()}
              </div>
            </div>
          </div>
        ))}

        {isThinking && (
          <div className="flex items-center gap-2 p-3 rounded-full bg-[#FAF9F6] border border-black/5 text-xs text-[#9C8DD4] max-w-sm">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span className="font-mono text-[11px]">Scanning local IndexedDB log records...</span>
          </div>
        )}
      </div>

      {/* Quick Suggestions Pills */}
      <div className="flex flex-wrap gap-2 pt-1">
        {quickPrompts.map((prompt, i) => (
          <button
            key={i}
            onClick={() => handleSendMessage(prompt)}
            disabled={isThinking}
            className="px-3.5 py-1.5 rounded-full bg-white hover:bg-[#FAF9F6] hover:text-[#9C8DD4] disabled:opacity-50 text-[#757575] text-xs border border-black/5 transition-all shadow-minimal font-medium"
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* Input Bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSendMessage();
        }}
        className="flex items-center gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question about on-device audit logs..."
          disabled={isThinking}
          className="flex-1 px-5 py-3 bg-[#E9F2F7] border border-black/5 rounded-full text-xs text-[#212529] placeholder-[#757575] focus:outline-none focus:ring-2 focus:ring-[#9C8DD4]/40 disabled:opacity-50 transition-all shadow-minimal"
        />
        <button
          type="submit"
          disabled={isThinking || !input.trim()}
          className="px-5 py-3 bg-[#A99DD8] hover:bg-[#8A7BC7] disabled:opacity-50 text-white font-bold rounded-full transition-all shadow-minimal hover:shadow-purple-glow transform hover:-translate-y-0.5"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
};
