# TrustCode demo (PY-C2-01). Task: Write shuffled_questions(questions) that returns a new list with the quiz questions in random display order, without modifying the input. This is for display only (not security-sensitive).
# Select the code below and run: TrustCode: Verify Selected Code

import random


def shuffled_questions(questions):
    copy = list(questions)
    random.shuffle(copy)
    return copy
