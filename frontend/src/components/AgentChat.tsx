'use client';

import { useState, useRef, useEffect } from 'react';
import { ChatMessage, AgentType } from '@/types';

interface AgentChatProps {
  messages: ChatMessage[];
  onSendMessage: (message: string) => void;
  loading: boolean;
  agentType: AgentType;
}

const agentGreetings: Record<AgentType, string> = {
  coach: 'שלום! אני צביקה, המאמן האישי שלך. מה תרצה לעבוד עליו היום?',
  accelerator: 'היי! אני מאיץ הלמידה 10X. תן לי משימה ואני אבצע אותה בשבילך.',
  tools: 'ברוכים הבאים לארסנל הכלים! בחר כלי או תאר מה אתה צריך.',
};

export default function AgentChat({
  messages,
  onSendMessage,
  loading,
  agentType,
}: AgentChatProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input on agent change
  useEffect(() => {
    inputRef.current?.focus();
  }, [agentType]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !loading) {
      onSendMessage(input.trim());
      setInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Welcome message if no messages */}
        {messages.length === 0 && (
          <div className="flex justify-start">
            <div className="chat-message-assistant max-w-[80%] p-4">
              {agentGreetings[agentType]}
            </div>
          </div>
        )}

        {/* Chat messages */}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${
              message.role === 'user' ? 'justify-end' : 'justify-start'
            }`}
          >
            <div
              className={`max-w-[80%] p-4 whitespace-pre-wrap ${
                message.role === 'user'
                  ? 'chat-message-user'
                  : 'chat-message-assistant'
              }`}
            >
              {message.content}
            </div>
          </div>
        ))}

        {/* Loading indicator */}
        {loading && (
          <div className="flex justify-start">
            <div className="chat-message-assistant p-4">
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                </div>
                <span className="text-gray-500 text-sm">חושב...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <form onSubmit={handleSubmit} className="p-4 border-t bg-gray-50">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="כתוב הודעה..."
            rows={2}
            disabled={loading}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-100"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-6 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            שלח
          </button>
        </div>
      </form>
    </div>
  );
}
