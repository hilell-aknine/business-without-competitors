'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { lessonsApi, chatApi } from '@/lib/api';
import { Lesson, ChatHistory, AgentType, ChatMessage } from '@/types';
import VideoPlayer from '@/components/VideoPlayer';
import AgentChat from '@/components/AgentChat';
import AgentSelector from '@/components/AgentSelector';

export default function LessonPage() {
  const router = useRouter();
  const params = useParams();
  const lessonId = Number(params.id);

  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [selectedAgent, setSelectedAgent] = useState<AgentType>('coach');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [chatLoading, setChatLoading] = useState(false);

  // Fetch lesson data
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
      return;
    }

    const fetchLesson = async () => {
      try {
        const data = await lessonsApi.getOne(lessonId);
        setLesson(data);
      } catch (err: any) {
        if (err.response?.status === 403) {
          setError('השיעור נעול. יש להשלים את השיעורים הקודמים');
        } else {
          setError('לא ניתן לטעון את השיעור');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchLesson();
  }, [lessonId, router]);

  // Load chat history when agent changes
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const histories = await chatApi.getHistory(lessonId, selectedAgent);
        if (histories.length > 0) {
          const latest = histories[0];
          setMessages(latest.messages);
          setSessionId(latest.session_id);
        } else {
          setMessages([]);
          setSessionId(null);
        }
      } catch (err) {
        console.error('Failed to load chat history:', err);
      }
    };

    if (lesson) {
      loadHistory();
    }
  }, [lessonId, selectedAgent, lesson]);

  const handleSendMessage = useCallback(async (message: string) => {
    if (!message.trim()) return;

    // Add user message to UI immediately
    const userMessage: ChatMessage = {
      id: Date.now(),
      role: 'user',
      content: message,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setChatLoading(true);

    try {
      const response = await chatApi.sendMessage({
        message,
        agent_type: selectedAgent,
        lesson_id: lessonId,
        session_id: sessionId || undefined,
      });

      // Add AI response
      const assistantMessage: ChatMessage = {
        id: Date.now() + 1,
        role: 'assistant',
        content: response.message,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
      setSessionId(response.session_id);
    } catch (err) {
      console.error('Failed to send message:', err);
      // Remove the user message on error
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setChatLoading(false);
    }
  }, [selectedAgent, lessonId, sessionId]);

  const handleComplete = async () => {
    try {
      await lessonsApi.updateProgress(lessonId, true);
      router.push('/');
    } catch (err) {
      console.error('Failed to mark as complete:', err);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-500 text-lg mb-4">{error}</p>
          <button
            onClick={() => router.push('/')}
            className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600"
          >
            חזרה לדף הבית
          </button>
        </div>
      </div>
    );
  }

  if (!lesson) return null;

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-full px-4 py-3 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/')}
              className="text-gray-500 hover:text-gray-700"
            >
              &rarr; חזרה
            </button>
            <h1 className="text-xl font-bold text-gray-900">{lesson.title}</h1>
          </div>
          <button
            onClick={handleComplete}
            disabled={lesson.is_completed}
            className={`px-4 py-2 rounded-lg font-medium ${
              lesson.is_completed
                ? 'bg-accent-100 text-accent-700 cursor-default'
                : 'bg-accent-500 text-white hover:bg-accent-600'
            }`}
          >
            {lesson.is_completed ? 'הושלם!' : 'סיימתי את השיעור'}
          </button>
        </div>
      </header>

      {/* Split Screen Layout */}
      <div className="flex h-[calc(100vh-60px)]">
        {/* Video Section - Right side (RTL) */}
        <div className="w-1/2 p-4 border-l border-gray-200">
          <div className="bg-white rounded-xl shadow-sm h-full overflow-hidden">
            <VideoPlayer url={lesson.youtube_url} />
            {lesson.description && (
              <div className="p-4 border-t">
                <p className="text-gray-600">{lesson.description}</p>
              </div>
            )}
          </div>
        </div>

        {/* Chat Section - Left side (RTL) */}
        <div className="w-1/2 p-4 flex flex-col">
          <div className="bg-white rounded-xl shadow-sm flex-1 flex flex-col overflow-hidden">
            {/* Agent Selector */}
            <div className="p-4 border-b">
              <AgentSelector
                selected={selectedAgent}
                onSelect={setSelectedAgent}
              />
            </div>

            {/* Chat Area */}
            <AgentChat
              messages={messages}
              onSendMessage={handleSendMessage}
              loading={chatLoading}
              agentType={selectedAgent}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
