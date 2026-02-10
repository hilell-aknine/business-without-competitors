// User types
export interface User {
  id: number;
  email: string;
  created_at: string;
  has_profile: boolean;
}

export interface UserProfile {
  id: number;
  niche: string;
  target_audience: string;
  business_goal: string;
  created_at: string;
}

// Auth types
export interface LoginRequest {
  username: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
}

export interface Token {
  access_token: string;
  token_type: string;
}

// Profile types
export interface ProfileCreate {
  niche: string;
  target_audience: string;
  business_goal: string;
}

// Lesson types
export interface Lesson {
  id: number;
  title: string;
  description: string | null;
  youtube_url: string;
  order: number;
  is_completed: boolean;
  is_locked: boolean;
}

export interface LessonListResponse {
  lessons: Lesson[];
  total: number;
}

// Chat types
export type AgentType = 'coach' | 'accelerator' | 'tools';

export interface ChatRequest {
  message: string;
  agent_type: AgentType;
  lesson_id?: number;
  session_id?: number;
}

export interface ChatResponse {
  message: string;
  session_id: number;
  agent_type: AgentType;
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface ChatHistory {
  session_id: number;
  agent_type: AgentType;
  messages: ChatMessage[];
}

// Tools types
export interface Tool {
  id: string;
  name: string;
  description: string;
  icon: string;
}
