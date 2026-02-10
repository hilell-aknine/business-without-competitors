"""
Course Ingestion Script
Downloads YouTube videos, transcribes with Whisper, and saves to database
"""

import os
import sys
import tempfile
import argparse
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

import whisper
import yt_dlp
from sqlmodel import Session, select

from app.database import engine, init_db
from app.models.lesson import Lesson
from app.services.transcript import chunk_transcript


def download_audio(youtube_url: str, output_path: str) -> str:
    """Download audio from YouTube video"""
    ydl_opts = {
        'format': 'bestaudio/best',
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
        }],
        'outtmpl': output_path,
        'quiet': True,
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(youtube_url, download=True)
        return info.get('title', 'Untitled')


def transcribe_audio(audio_path: str, model_name: str = "base") -> str:
    """Transcribe audio file using Whisper"""
    print(f"Loading Whisper model: {model_name}")
    model = whisper.load_model(model_name)

    print("Transcribing audio...")
    result = model.transcribe(audio_path, language="he")

    return result["text"]


def ingest_lesson(
    youtube_url: str,
    title: str = None,
    description: str = None,
    order: int = 0,
    whisper_model: str = "base"
) -> Lesson:
    """
    Ingest a single lesson from YouTube

    Args:
        youtube_url: YouTube video URL
        title: Lesson title (auto-detected if not provided)
        description: Lesson description
        order: Lesson order in course
        whisper_model: Whisper model to use (tiny, base, small, medium, large)

    Returns:
        Created Lesson object
    """
    with tempfile.TemporaryDirectory() as temp_dir:
        audio_path = os.path.join(temp_dir, "audio")

        # Download audio
        print(f"Downloading: {youtube_url}")
        video_title = download_audio(youtube_url, audio_path)

        # Use video title if not provided
        if not title:
            title = video_title

        # Find the actual audio file (yt-dlp adds extension)
        audio_file = None
        for f in os.listdir(temp_dir):
            if f.startswith("audio"):
                audio_file = os.path.join(temp_dir, f)
                break

        if not audio_file:
            raise Exception("Failed to download audio")

        # Transcribe
        transcript = transcribe_audio(audio_file, whisper_model)

        # Chunk transcript
        chunks = chunk_transcript(transcript)

        # Save to database
        with Session(engine) as session:
            lesson = Lesson(
                title=title,
                description=description,
                youtube_url=youtube_url,
                transcript=transcript,
                order=order
            )
            lesson.transcript_chunks = chunks

            session.add(lesson)
            session.commit()
            session.refresh(lesson)

            print(f"Created lesson: {lesson.title} (ID: {lesson.id})")
            print(f"Transcript length: {len(transcript)} chars")
            print(f"Chunks created: {len(chunks)}")

            return lesson


def ingest_course_from_file(file_path: str, whisper_model: str = "base"):
    """
    Ingest multiple lessons from a text file

    File format (one per line):
    youtube_url|title|description

    Example:
    https://youtube.com/watch?v=xxx|שיעור 1 - מבוא|מבוא לקורס
    """
    init_db()

    with open(file_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    for order, line in enumerate(lines):
        line = line.strip()
        if not line or line.startswith('#'):
            continue

        parts = line.split('|')
        youtube_url = parts[0].strip()
        title = parts[1].strip() if len(parts) > 1 else None
        description = parts[2].strip() if len(parts) > 2 else None

        try:
            ingest_lesson(
                youtube_url=youtube_url,
                title=title,
                description=description,
                order=order,
                whisper_model=whisper_model
            )
        except Exception as e:
            print(f"Error ingesting {youtube_url}: {e}")
            continue


def main():
    parser = argparse.ArgumentParser(description="Ingest course from YouTube")
    parser.add_argument("--url", help="Single YouTube URL to ingest")
    parser.add_argument("--file", help="File with list of YouTube URLs")
    parser.add_argument("--title", help="Lesson title (for single URL)")
    parser.add_argument("--description", help="Lesson description (for single URL)")
    parser.add_argument("--order", type=int, default=0, help="Lesson order (for single URL)")
    parser.add_argument("--model", default="base", help="Whisper model (tiny/base/small/medium/large)")

    args = parser.parse_args()

    init_db()

    if args.url:
        ingest_lesson(
            youtube_url=args.url,
            title=args.title,
            description=args.description,
            order=args.order,
            whisper_model=args.model
        )
    elif args.file:
        ingest_course_from_file(args.file, args.model)
    else:
        print("Please provide --url or --file")
        parser.print_help()


if __name__ == "__main__":
    main()
