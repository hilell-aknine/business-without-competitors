'use client';

import { AgentType } from '@/types';

interface Agent {
  id: AgentType;
  name: string;
  description: string;
  icon: string;
}

const agents: Agent[] = [
  {
    id: 'coach',
    name: 'מאמן אישי',
    description: 'צביקה - מנחה ושואל שאלות',
    icon: '🎯',
  },
  {
    id: 'accelerator',
    name: 'מאיץ 10X',
    description: 'מבצע משימות ויוצר תוכן',
    icon: '🚀',
  },
  {
    id: 'tools',
    name: 'ארסנל כלים',
    description: 'כלים מוכנים לשימוש',
    icon: '🛠️',
  },
];

interface AgentSelectorProps {
  selected: AgentType;
  onSelect: (agent: AgentType) => void;
}

export default function AgentSelector({ selected, onSelect }: AgentSelectorProps) {
  return (
    <div className="flex gap-2">
      {agents.map((agent) => (
        <button
          key={agent.id}
          onClick={() => onSelect(agent.id)}
          className={`flex-1 p-3 rounded-lg transition-all duration-200 text-right ${
            selected === agent.id
              ? 'bg-primary-500 text-white shadow-md'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="text-xl">{agent.icon}</span>
            <div>
              <div className="font-medium text-sm">{agent.name}</div>
              <div
                className={`text-xs ${
                  selected === agent.id ? 'text-primary-100' : 'text-gray-500'
                }`}
              >
                {agent.description}
              </div>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
