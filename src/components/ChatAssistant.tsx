import React, { useState } from 'react';
import { Send, Bot, User, RefreshCw } from 'lucide-react';
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
      text: `👋 Welcome to your Aegis Local Privacy Assistant.\n\nI run 100% inside your browser and query only this device's on-device audit logs and local vault records.\n\nYou can ask questions like:\n- "What files did I protect today?"\n- "Are there any suspicious anomalies or failed attempts?"\n- "What types of personal identifiers (PII) were caught recently?"\n- "Show my active privacy policy rules"`,
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
    <div className="space-y-4 max-w-4xl mx-auto h-[calc(100vh-180px)] flex flex-col">
      {/* Header */}
      <div className="p-4 rounded-2xl bg-white border border-slate-200/90 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-600 shadow-sm">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <span>Local Audit Assistant (F3)</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold">
                100% In-Browser
              </span>
            </h3>
            <p className="text-xs text-slate-500">Zero cloud API calls · Queries on-device IndexedDB logs only</p>
          </div>
        </div>
      </div>

      {/* Messages Thread */}
      <div className="flex-1 bg-white border border-slate-200/90 rounded-2xl p-5 overflow-y-auto space-y-4 shadow-sm">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex items-start gap-3 ${
              msg.sender === 'user' ? 'flex-row-reverse' : 'flex-row'
            }`}
          >
            <div
              className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                msg.sender === 'user'
                  ? 'bg-indigo-600 text-white font-bold'
                  : 'bg-indigo-50 text-indigo-600 border border-indigo-100'
              }`}
            >
              {msg.sender === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
            </div>

            <div
              className={`p-4 rounded-2xl max-w-xl text-xs leading-relaxed space-y-2 ${
                msg.sender === 'user'
                  ? 'bg-indigo-600 text-white font-medium shadow-sm'
                  : 'bg-slate-50 border border-slate-200 text-slate-800 shadow-sm'
              }`}
            >
              <div className="whitespace-pre-wrap font-sans">{msg.text}</div>
              <div
                className={`text-[10px] text-right font-mono ${
                  msg.sender === 'user' ? 'text-indigo-200' : 'text-slate-400'
                }`}
              >
                {new Date(msg.timestamp).toLocaleTimeString()}
              </div>
            </div>
          </div>
        ))}

        {isThinking && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-indigo-50/60 border border-indigo-200 text-xs text-indigo-700">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span>Scanning local IndexedDB log records...</span>
          </div>
        )}
      </div>

      {/* Quick Suggestions */}
      <div className="flex flex-wrap gap-2 pt-1">
        {quickPrompts.map((prompt, i) => (
          <button
            key={i}
            onClick={() => handleSendMessage(prompt)}
            disabled={isThinking}
            className="px-3 py-1.5 rounded-xl bg-white hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-50 text-slate-700 text-xs border border-slate-200 transition-colors shadow-sm font-medium"
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
          className="flex-1 px-4 py-3 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 disabled:opacity-50 transition-colors shadow-sm"
        />
        <button
          type="submit"
          disabled={isThinking || !input.trim()}
          className="px-4 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-xl transition-all shadow-md shadow-indigo-500/20"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
};
