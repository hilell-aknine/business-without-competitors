import axios from 'axios';
import type {
  Token,
  User,
  UserProfile,
  ProfileCreate,
  Lesson,
  LessonListResponse,
  ChatRequest,
  ChatResponse,
  ChatHistory,
  AgentType,
  Tool,
} from '@/types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authApi = {
  register: async (email: string, password: string): Promise<User> => {
    const { data } = await api.post('/api/auth/register', { email, password });
    return data;
  },

  login: async (email: string, password: string): Promise<Token> => {
    const formData = new URLSearchParams();
    formData.append('username', email);
    formData.append('password', password);
    const { data } = await api.post('/api/auth/login', formData, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return data;
  },

  getMe: async (): Promise<User> => {
    const { data } = await api.get('/api/auth/me');
    return data;
  },

  createProfile: async (profile: ProfileCreate): Promise<UserProfile> => {
    const { data } = await api.post('/api/auth/onboarding', profile);
    return data;
  },

  getProfile: async (): Promise<UserProfile> => {
    const { data } = await api.get('/api/auth/profile');
    return data;
  },
};

// Lessons API
export const lessonsApi = {
  getAll: async (): Promise<LessonListResponse> => {
    const { data } = await api.get('/api/lessons/');
    return data;
  },

  getOne: async (id: number): Promise<Lesson> => {
    const { data } = await api.get(`/api/lessons/${id}`);
    return data;
  },

  updateProgress: async (
    lessonId: number,
    completed: boolean,
    watchProgress?: number
  ): Promise<void> => {
    await api.post(`/api/lessons/${lessonId}/progress`, {
      completed,
      watch_progress_seconds: watchProgress,
    });
  },
};

// Chat API
export const chatApi = {
  sendMessage: async (request: ChatRequest): Promise<ChatResponse> => {
    const { data } = await api.post('/api/chat/', request);
    return data;
  },

  getHistory: async (
    lessonId: number,
    agentType?: AgentType
  ): Promise<ChatHistory[]> => {
    const params = agentType ? { agent_type: agentType } : {};
    const { data } = await api.get(`/api/chat/history/${lessonId}`, { params });
    return data;
  },

  getAllSessions: async (): Promise<ChatHistory[]> => {
    const { data } = await api.get('/api/chat/sessions');
    return data;
  },
};

// Tools API
export const toolsApi = {
  getAll: async (): Promise<Tool[]> => {
    const { data } = await api.get('/api/tools/');
    return data;
  },

  execute: async (toolId: string, inputData?: string): Promise<string> => {
    const { data } = await api.post('/api/tools/execute', {
      tool_id: toolId,
      input_data: inputData,
    });
    return data.result;
  },
};

export default api;
