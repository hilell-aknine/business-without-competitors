'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authApi, lessonsApi } from '@/lib/api';
import { User, Lesson } from '@/types';
import CourseMap from '@/components/CourseMap';

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
      return;
    }

    const fetchData = async () => {
      try {
        const userData = await authApi.getMe();
        setUser(userData);

        if (!userData.has_profile) {
          router.push('/onboarding');
          return;
        }

        const lessonsData = await lessonsApi.getAll();
        setLessons(lessonsData.lessons);
      } catch (error) {
        console.error('Failed to fetch data:', error);
        localStorage.removeItem('token');
        router.push('/login');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    router.push('/login');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  const completedCount = lessons.filter(l => l.is_completed).length;
  const progressPercent = lessons.length > 0 ? (completedCount / lessons.length) * 100 : 0;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-900">עסק ללא מתחרים</h1>
          <div className="flex items-center gap-4">
            <span className="text-gray-600">{user?.email}</span>
            <button
              onClick={handleLogout}
              className="text-gray-500 hover:text-gray-700"
            >
              התנתק
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Progress Bar */}
        <div className="bg-white rounded-xl p-6 shadow-sm mb-8">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-lg font-semibold">ההתקדמות שלך</h2>
            <span className="text-sm text-gray-500">
              {completedCount} מתוך {lessons.length} שיעורים
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div
              className="bg-accent-500 h-3 rounded-full transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            ></div>
          </div>
        </div>

        {/* Course Map */}
        <div className="bg-white rounded-xl p-6 shadow-sm">
          <h2 className="text-xl font-bold mb-6">מפת הקורס</h2>
          <CourseMap lessons={lessons} />
        </div>
      </main>
    </div>
  );
}
