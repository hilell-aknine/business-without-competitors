"""
Seed Data Script - Creates sample lessons for testing
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from sqlmodel import Session
from app.database import engine, init_db
from app.models.lesson import Lesson


def create_sample_lessons():
    """Create sample lessons for testing"""
    init_db()

    sample_lessons = [
        {
            "title": "שיעור 1: מבוא - מהו עסק ללא מתחרים?",
            "description": "בשיעור זה נלמד את העקרונות הבסיסיים של בניית עסק ייחודי שאין לו תחרות ישירה.",
            "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",  # Replace with real URL
            "order": 0,
            "transcript": "שלום לכולם, ברוכים הבאים לקורס עסק ללא מתחרים. היום נדבר על איך ליצור עסק שאין לו תחרות ישירה...",
        },
        {
            "title": "שיעור 2: זיהוי הנישה המושלמת",
            "description": "איך למצוא את הנישה שבה תוכל להיות מספר 1 ולא להתחרות על מחיר.",
            "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "order": 1,
            "transcript": "בשיעור הזה נלמד איך לזהות נישה רווחית שמתאימה בדיוק לכישורים שלכם...",
        },
        {
            "title": "שיעור 3: בניית הצעת ערך ייחודית",
            "description": "יצירת הצעת ערך שגורמת ללקוחות לבחור בך באופן אוטומטי.",
            "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "order": 2,
            "transcript": "הצעת ערך ייחודית היא המפתח להצלחה עסקית. נלמד איך לבנות אחת...",
        },
        {
            "title": "שיעור 4: אסטרטגיית תוכן שמושכת לקוחות",
            "description": "איך ליצור תוכן שמושך את הלקוחות האידיאליים שלך באופן אורגני.",
            "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "order": 3,
            "transcript": "תוכן איכותי הוא הדרך הטובה ביותר למשוך לקוחות. בואו נלמד איך...",
        },
        {
            "title": "שיעור 5: בניית מערכת מכירות",
            "description": "יצירת תהליך מכירה שעובד 24/7 ומביא לקוחות באופן אוטומטי.",
            "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "order": 4,
            "transcript": "מערכת מכירות אוטומטית היא החלום של כל בעל עסק. נלמד איך לבנות אחת...",
        },
    ]

    with Session(engine) as session:
        for lesson_data in sample_lessons:
            # Check if lesson already exists
            existing = session.query(Lesson).filter(
                Lesson.order == lesson_data["order"]
            ).first()

            if existing:
                print(f"Lesson {lesson_data['order']} already exists, skipping...")
                continue

            lesson = Lesson(**lesson_data)
            session.add(lesson)
            print(f"Created: {lesson.title}")

        session.commit()
        print("\nSample lessons created successfully!")


if __name__ == "__main__":
    create_sample_lessons()
