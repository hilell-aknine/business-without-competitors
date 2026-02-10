'use client';

import { useState } from 'react';

interface OnboardingFormProps {
  onSubmit: (data: {
    niche: string;
    target_audience: string;
    business_goal: string;
  }) => void;
  loading: boolean;
}

export default function OnboardingForm({ onSubmit, loading }: OnboardingFormProps) {
  const [niche, setNiche] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [businessGoal, setBusinessGoal] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      niche,
      target_audience: targetAudience,
      business_goal: businessGoal,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          מה התחום של העסק שלך?
        </label>
        <input
          type="text"
          value={niche}
          onChange={(e) => setNiche(e.target.value)}
          required
          placeholder='לדוגמה: "קואצ׳ינג עסקי", "עיצוב גרפי", "יועץ פיננסי"'
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          מי קהל היעד שלך?
        </label>
        <input
          type="text"
          value={targetAudience}
          onChange={(e) => setTargetAudience(e.target.value)}
          required
          placeholder='לדוגמה: "בעלי עסקים קטנים", "נשים עצמאיות", "סטארטאפים"'
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          מה המטרה העסקית שלך?
        </label>
        <textarea
          value={businessGoal}
          onChange={(e) => setBusinessGoal(e.target.value)}
          required
          rows={3}
          placeholder='לדוגמה: "להגדיל הכנסות ב-50%", "למשוך 100 לקוחות חדשים", "להשיק קורס דיגיטלי"'
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 bg-primary-500 text-white font-medium rounded-lg hover:bg-primary-600 transition disabled:opacity-50"
      >
        {loading ? (
          <span className="flex items-center justify-center">
            <svg className="animate-spin h-5 w-5 ml-2" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            שומר...
          </span>
        ) : (
          'בואו נתחיל!'
        )}
      </button>
    </form>
  );
}
