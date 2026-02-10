'use client';

import { useState } from 'react';
import ReactPlayer from 'react-player/youtube';

interface VideoPlayerProps {
  url: string;
  onProgress?: (progress: { played: number; playedSeconds: number }) => void;
  onEnded?: () => void;
}

export default function VideoPlayer({ url, onProgress, onEnded }: VideoPlayerProps) {
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);

  return (
    <div className="relative aspect-video bg-black">
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-white"></div>
        </div>
      )}
      <ReactPlayer
        url={url}
        width="100%"
        height="100%"
        playing={playing}
        controls={true}
        onReady={() => setReady(true)}
        onProgress={onProgress}
        onEnded={onEnded}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        config={{
          youtube: {
            playerVars: {
              hl: 'he',
              cc_lang_pref: 'he',
            },
          },
        }}
      />
    </div>
  );
}
