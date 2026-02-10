'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/lib/api';
import OnboardingForm from '@/components/OnboardingForm';

export default function OnboardingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (data: {
    niche: string;
    target_audience: string;
    business_goal: string;
  }) => {
    setError('');
    setLoading(true);

    try {
      await authApi.createProfile({
        niche: data.niche,
        target_audience: data.target_audience,
        business_goal: data.business_goal,
      });
      router.push('/');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'אירעה שגיאה, נסה שוב');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
      <div className="max-w-xl w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">ברוכים הבאים!</h1>
          <p className="mt-2 text-gray-600">
            לפני שנתחיל, ספר לנו קצת על העסק שלך
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-8">
          <OnboardingForm onSubmit={handleSubmit} loading={loading} />
          {error && (
            <div className="mt-4 text-red-500 text-sm text-center">{error}</div>
          )}
        </div>
      </div>
    </div>
  );
}
