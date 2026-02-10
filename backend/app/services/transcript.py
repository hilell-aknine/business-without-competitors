"""
Transcript & RAG Logic
Simple chunking and retrieval for lesson context
"""

from typing import Optional
import re


def chunk_transcript(transcript: str, chunk_size: int = 500, overlap: int = 50) -> list[str]:
    """
    Split transcript into overlapping chunks for RAG

    Args:
        transcript: Full transcript text
        chunk_size: Target size of each chunk (in words)
        overlap: Number of words to overlap between chunks

    Returns:
        List of transcript chunks
    """
    if not transcript:
        return []

    # Split into sentences (basic Hebrew/English sentence detection)
    sentences = re.split(r'[.!?。]\s+', transcript)

    chunks = []
    current_chunk = []
    current_word_count = 0

    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue

        word_count = len(sentence.split())

        if current_word_count + word_count > chunk_size and current_chunk:
            # Save current chunk
            chunks.append(' '.join(current_chunk))

            # Start new chunk with overlap
            overlap_words = []
            overlap_count = 0
            for s in reversed(current_chunk):
                s_words = len(s.split())
                if overlap_count + s_words <= overlap:
                    overlap_words.insert(0, s)
                    overlap_count += s_words
                else:
                    break

            current_chunk = overlap_words
            current_word_count = overlap_count

        current_chunk.append(sentence)
        current_word_count += word_count

    # Add final chunk
    if current_chunk:
        chunks.append(' '.join(current_chunk))

    return chunks


def get_relevant_chunks(
    query: str,
    chunks: list[str],
    top_k: int = 3
) -> list[str]:
    """
    Simple keyword-based retrieval (can be upgraded to embeddings later)

    Args:
        query: User's message
        chunks: List of transcript chunks
        top_k: Number of chunks to return

    Returns:
        Most relevant chunks
    """
    if not chunks:
        return []

    # Simple scoring based on keyword overlap
    query_words = set(query.lower().split())

    scored_chunks = []
    for chunk in chunks:
        chunk_words = set(chunk.lower().split())
        overlap = len(query_words & chunk_words)
        scored_chunks.append((overlap, chunk))

    # Sort by score (descending) and return top_k
    scored_chunks.sort(key=lambda x: x[0], reverse=True)

    return [chunk for score, chunk in scored_chunks[:top_k] if score > 0]


def format_context_for_prompt(chunks: list[str]) -> str:
    """Format retrieved chunks as context for the AI prompt"""
    if not chunks:
        return ""

    context_parts = ["הקשר רלוונטי מהשיעור:"]
    for i, chunk in enumerate(chunks, 1):
        context_parts.append(f"\n[קטע {i}]\n{chunk}")

    return '\n'.join(context_parts)
